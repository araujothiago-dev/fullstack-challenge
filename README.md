# Crash Game 🎮

Implementação do **backend** do desafio Crash Game da Jungle Gaming — um jogo de
cassino multiplayer em tempo real. Um multiplicador sobe a partir de `1.00x` e
pode "crashar" a qualquer momento; o jogador aposta antes da rodada e precisa
sacar (cash out) antes do crash para ganhar. Se não sacar a tempo, perde a aposta.

**Stack:** NestJS + Bun + TypeScript, PostgreSQL (TypeORM), RabbitMQ, WebSocket
(socket.io), Keycloak (autenticação) e Kong (API gateway) — tudo sobe via Docker
Compose.

> **Escopo desta entrega: backend.** Os serviços **Game** e **Wallet** estão
> funcionando (rodadas, apostas, cash out, provably fair, comunicação via
> RabbitMQ, tempo real e autenticação por JWT). O **frontend** (Vite + React)
> ainda não foi feito — é o próximo passo.

---

## Regras do jogo

1. **Fase de apostas** — janela de alguns segundos para apostar. Cada jogador faz
   no máximo **uma aposta por rodada**.
2. **Início da rodada** — o multiplicador começa em `1.00x` e sobe.
3. **Cash out** — dá para sacar a qualquer momento durante a rodada; o pagamento é
   `aposta × multiplicador atual`. Depois de sacar, não dá para apostar de novo.
4. **Crash** — o multiplicador para num ponto pré-determinado. Quem não sacou perde.
5. **Fim da rodada** — resultados revelados, saldos atualizados e começa outra.

Aposta mínima `1.00` / máxima `1000.00`. Saldo insuficiente rejeita a aposta.

---

## Como rodar

Pré-requisitos: **Bun ≥ 1.x** e **Docker + Docker Compose**.

```bash
bun run docker:up      # sobe tudo: Postgres, RabbitMQ, Keycloak, Kong, Game e Wallet
bun run docker:down    # para os containers
bun run docker:prune   # remove containers, volumes e imagens
```

Não precisa de nenhum passo manual: o realm do Keycloak é importado, o Kong é
configurado, os bancos são criados e o schema é gerado no boot dos serviços. As
variáveis ficam em `services/<serviço>/.env` (valores de desenvolvimento, já
versionados).

### Endpoints

| O quê           | URL                                            |
| --------------- | ---------------------------------------------- |
| API (via Kong)  | `http://localhost:8000`                        |
| Game (direto)   | `http://localhost:4001` — Swagger em `/docs`   |
| Wallet (direto) | `http://localhost:4002` — Swagger em `/docs`   |
| WebSocket       | `ws://localhost:8000` (socket.io)              |
| Keycloak        | `http://localhost:8080` (`admin`/`admin`)      |
| RabbitMQ UI     | `http://localhost:15672` (`admin`/`admin`)     |

**Usuário de teste:** `player` / `player123`. A carteira é criada automaticamente
com **R$ 10.000,00** no primeiro acesso a `GET /wallets/me`.

### Testes

```bash
cd services/games   && bun test
cd services/wallets && bun test
```

Os testes (unitários e e2e) rodam **sem precisar do Docker** — usam implementações
em memória no lugar do banco/broker, então são rápidos e previsíveis.

---

## Como o projeto está organizado

Tentei seguir **DDD com separação em camadas** em cada serviço:

```
domain/          regras de negócio puras (entidades, value objects), sem framework
application/     casos de uso e as interfaces (portas) que o domínio usa
infrastructure/  implementações concretas: TypeORM, RabbitMQ, WebSocket, auth
presentation/    controllers HTTP, DTOs e tratamento de erros
```

A ideia é o domínio não depender de NestJS/TypeORM/RabbitMQ: a camada de
aplicação declara interfaces (ex.: `WalletRepository`, `RoundRepository`) e a
infraestrutura fornece a implementação.

São **dois serviços separados**, cada um com seu próprio banco:

- **Game** — rodadas, apostas, lógica do crash, provably fair e WebSocket.
- **Wallet** — saldo do jogador, créditos e débitos.

Entidades principais:

- **Wallet** — garante saldo nunca negativo. Guarda cada movimento num histórico
  de transações (ledger).
- **Round** — controla o ciclo da rodada (`BETTING → RUNNING → CRASHED`) e as
  regras (uma aposta por jogador, só apostar na fase de apostas, etc.).
- **Bet** — uma aposta (`PENDING → ACTIVE → CASHED_OUT/LOST`, ou `REJECTED`).
- Valores de dinheiro usam um value object `Money` em centavos inteiros.

---

## Comunicação entre os serviços

Game e Wallet **não se chamam diretamente** — eles conversam por mensagens no
RabbitMQ. O fluxo de uma aposta é mais ou menos assim:

```
1. Jogador faz POST /games/bet
2. Game cria a aposta (PENDING) e manda  wallet.debit.requested ──▶ Wallet
3. Wallet debita o saldo e responde:
      wallet.debit.succeeded ──▶ Game marca a aposta como ACTIVE
      wallet.debit.failed    ──▶ Game marca como REJECTED (ex.: saldo insuficiente)
4. Cash out: Game calcula o pagamento e manda wallet.credit.requested ──▶ Wallet credita
5. Crash: quem ainda estava ACTIVE perde (o dinheiro já tinha sido debitado)
```

Cuidados que tomei nessa parte:

- **Idempotência:** cada débito/crédito tem uma referência única
  (`debit:<betId>` / `credit:<betId>`). Se a mesma mensagem chegar duas vezes, o
  Wallet não aplica de novo.
- **Não perder mensagem:** filas duráveis, mensagens persistentes e confirmação
  (ack) manual — se o serviço cair no meio do processamento, a mensagem volta.
- **Estorno:** se o débito for confirmado só depois da rodada já ter crashado
  (caso raro), o Game devolve o valor pra não cobrar uma aposta que não jogou.

---

## Provably fair

O crash point de cada rodada é sorteado **antes** das apostas e pode ser conferido
depois pelo jogador.

- Cada rodada tem um `serverSeed`. Antes das apostas, o servidor publica só o
  **hash** dele (`serverSeedHash = sha256(serverSeed)`).
- Quando a rodada crasha, o `serverSeed` é revelado. Aí qualquer um pode conferir
  que `sha256(serverSeed)` bate com o hash que foi mostrado antes e que o crash
  point realmente sai daquele seed.

O cálculo é determinístico (mesma seed → mesmo resultado):

```
X          = int( HMAC_SHA256(serverSeed, "crash:<nonce>")[0..13] ) / 2^52
crashPoint = floor( (1 - houseEdge) / (1 - X) * 100 ) / 100   (mínimo 1.00x)
```

Endpoint de verificação: `GET /games/rounds/:id/verify`.

---

## Eventos WebSocket

A conexão é só do **servidor para o cliente** (as ações do jogador são por REST).
Eventos emitidos:

| Evento          | Quando                                                     |
| --------------- | ---------------------------------------------------------- |
| `round.betting` | nova rodada abriu para apostas (manda o hash da seed)      |
| `round.started` | apostas fecharam, multiplicador começou a subir            |
| `round.tick`    | atualização do multiplicador (a cada ~100ms)               |
| `round.crashed` | a rodada crashou (revela a seed e o crash point)           |
| `bet.placed`    | alguém fez uma aposta                                      |
| `bet.settled`   | uma aposta mudou de status (confirmada, sacada, perdida…)  |

O multiplicador é controlado pelo servidor (fonte da verdade). O cliente recebe os
`ticks` e anima a curva entre eles.

---

## API REST

Tudo passa pelo Kong em `http://localhost:8000`. Os endpoints com **Auth** pedem
`Authorization: Bearer <token do Keycloak>`.

| Método | Endpoint                   | Auth | Descrição                         |
| ------ | -------------------------- | ---- | --------------------------------- |
| POST   | `/wallets`                 | Sim  | Cria/retorna a carteira           |
| GET    | `/wallets/me`              | Sim  | Carteira e saldo                  |
| GET    | `/games/rounds/current`    | Não  | Rodada atual com as apostas       |
| GET    | `/games/rounds/history`    | Não  | Histórico paginado                |
| GET    | `/games/rounds/:id/verify` | Não  | Dados do provably fair            |
| GET    | `/games/bets/me`           | Sim  | Apostas do jogador (paginado)     |
| POST   | `/games/bet`               | Sim  | Apostar (`{ "amount": "10.00" }`) |
| POST   | `/games/bet/cashout`       | Sim  | Sacar no multiplicador atual      |

Crédito e débito não têm endpoint REST — acontecem só via RabbitMQ.

---

## Decisões que tomei

- **Dinheiro em centavos inteiros (`bigint`), nunca `float`** — evita erros de
  arredondamento. Tem um teste mostrando que `0.10 + 0.20` dá certinho `0.30`.
- **Ledger na carteira** — em vez de só mudar o saldo, gravo cada movimento numa
  tabela. Isso dá histórico e ajuda na idempotência.
- **TypeORM com `synchronize: true`** — gera o schema automático no boot, então o
  `docker:up` funciona em um comando só. Em produção eu usaria migrations.
- **Engine mantém a rodada atual em memória** e persiste no banco — como só existe
  uma rodada ativa por vez, ficou mais simples de controlar.
- **Credenciais de dev versionadas** nos `.env` — são valores locais, sem segredo
  de verdade, pra `docker:up` funcionar sem configuração extra.

Uma dificuldade que tive: rodando NestJS no Bun, as interfaces injetadas
precisaram ser importadas com `import type` (por causa do `emitDecoratorMetadata`),
senão os serviços quebravam ao subir. Levei um tempo até achar isso.

---

## O que faria com mais tempo

- **Frontend** (Vite + React): tela de login, gráfico do crash animado, controles
  de aposta/cash out, lista de apostas em tempo real e histórico.
- Trocar `synchronize` por **migrations**.
- **Outbox pattern** e **dead-letter queue** no RabbitMQ para deixar a mensageria
  mais robusta.
- Testes e2e com a infra real (containers) e um **CI** rodando os testes.

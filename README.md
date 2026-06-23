# Crash Game 🎮

Implementação **full-stack** do desafio Crash Game da Jungle Gaming — um jogo de
cassino multiplayer em tempo real. Um multiplicador sobe a partir de `1.00x` e
pode "crashar" a qualquer momento; o jogador aposta antes da rodada e precisa
sacar (cash out) antes do crash para ganhar. Se não sacar a tempo, perde a aposta.

**Stack:** no backend, NestJS + Bun + TypeScript, PostgreSQL (TypeORM), RabbitMQ,
WebSocket (socket.io), Keycloak (autenticação) e Kong (API gateway); no frontend,
**Vite + React + TypeScript** (socket.io-client e keycloak-js) — tudo sobe via
Docker Compose.

> **Escopo desta entrega: backend + frontend.** Os serviços **Game** e **Wallet**
> estão funcionando (rodadas, apostas, cash out, provably fair, comunicação via
> RabbitMQ, tempo real e autenticação por JWT) e o **frontend** consome tudo:
> login no Keycloak, gráfico do crash animado, apostas/cash out, apostas ao vivo,
> histórico e verificação provably fair.

---

## Arquitetura

```
                 Frontend (React)
                        |
                        v
                      Kong  (API Gateway)
                        |
              +---------+---------+
              |                   |
            Game                Wallet
              |                   |
         PostgreSQL          PostgreSQL
              |                   |
              +---- RabbitMQ -----+   (comunicação assíncrona)

         Keycloak (IdP / OIDC) valida os JWTs dos dois serviços
```

---

## Regras do jogo

1. **Fase de apostas** — janela de alguns segundos; no máximo **uma aposta por
   jogador por rodada**.
2. **Rodada** — o multiplicador começa em `1.00x` e sobe.
3. **Cash out** — saca a qualquer momento; o pagamento é `aposta × multiplicador`.
4. **Crash** — o multiplicador para num ponto pré-determinado; quem não sacou perde.

Aposta mínima `1.00` / máxima `1000.00`. Saldo insuficiente rejeita a aposta.

---

## Como rodar

Pré-requisitos: **Bun ≥ 1.x** e **Docker + Docker Compose**.

```bash
bun run docker:up      # sobe tudo: Postgres, RabbitMQ, Keycloak, Kong, Game, Wallet e Frontend
bun run docker:down    # para os containers
bun run docker:prune   # remove containers, volumes e imagens
```

Não precisa de passo manual: o realm do Keycloak é importado, o Kong é
configurado, os bancos são criados e o schema é gerado no boot dos serviços.

| O quê           | URL                                            |
| --------------- | ---------------------------------------------- |
| Frontend (web)  | `http://localhost:3000`                        |
| API (via Kong)  | `http://localhost:8000`                        |
| Game (direto)   | `http://localhost:4001` — Swagger em `/docs`   |
| Wallet (direto) | `http://localhost:4002` — Swagger em `/docs`   |
| WebSocket       | `ws://localhost:8000` (socket.io)              |
| Keycloak        | `http://localhost:8080` (`admin`/`admin`)      |
| RabbitMQ UI     | `http://localhost:15672` (`admin`/`admin`)     |

**Usuário de teste:** `player` / `player123`. A carteira é criada automaticamente
com **R$ 10.000,00** no primeiro acesso a `GET /wallets/me`.

Abra `http://localhost:3000`, entre com o usuário de teste e jogue.

```bash
cd frontend
npm install
npm run dev            # Vite em http://localhost:5173 (já é redirect URI do Keycloak)
```

### Testes

```bash
# Backend
cd services/games   && bun test
cd services/wallets && bun test

# Frontend
cd frontend && bun test
```

Os testes (unitários e e2e) rodam **sem precisar do Docker** — usam implementações
em memória no lugar do banco/broker, então são rápidos e previsíveis.

---

## Como o projeto está organizado

```
domain/          regras de negócio puras (entidades, value objects), sem framework
application/     casos de uso e as interfaces (portas) que o domínio usa
infrastructure/  implementações concretas: TypeORM, RabbitMQ, WebSocket, auth
presentation/    controllers HTTP, DTOs e tratamento de erros
```

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

## Endpoints

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

## Frontend

SPA em **Vite + React + TypeScript** que consome a API pelo Kong e escuta os
eventos do jogo pelo WebSocket. Sem biblioteca de estado nem de gráfico: o estado
ao vivo é um `useReducer` e a curva do crash é desenhada num `<canvas>`.

```
frontend/src/
  auth/         keycloak-js + AuthProvider (OIDC Authorization Code + PKCE)
  api/          client REST tipado (anexa o Bearer token) e os DTOs
  realtime/     contrato dos eventos do WebSocket (espelha o backend)
  game/         estado ao vivo (reducer + socket) e o hook da carteira
  components/    gráfico, palco, controles de aposta, apostas ao vivo, histórico…
  utils/        formatação de dinheiro/multiplicador
```

Como funciona:

- **Login** — `keycloak-js` faz Authorization Code + PKCE (S256) contra o realm
  `crash-game`. O token é renovado sozinho e injetado nas chamadas autenticadas.
- **Estado ao vivo** — ao abrir, faz o *seed* com `GET /games/rounds/current` e o
  histórico; daí um `reducer` aplica os eventos (`round.*`, `bet.*`) conforme
  chegam pelo socket. O servidor é a fonte da verdade do multiplicador.
- **Gráfico** — a curva sobe de `1.00x` até o multiplicador atual, suavizada entre
  os `ticks` com `requestAnimationFrame`; fica verde subindo e vermelha no crash.
- **Apostar / sacar** — são chamadas REST (`POST /games/bet` e `/bet/cashout`); o
  resultado volta pelos eventos e atualiza a lista de apostas e o saldo.
- **Provably fair** — clicar numa rodada do histórico abre a verificação e o
  navegador **recalcula `sha256(serverSeed)`** (Web Crypto) para conferir, de forma
  independente, que bate com o hash publicado antes das apostas.

O frontend é containerizado (build com Vite, servido por nginx) e sobe junto no
`docker:up` na porta `3000`. As URLs de API/WS/Keycloak vêm de variáveis `VITE_*`
(ver `frontend/.env.example`), com valores padrão apontando para o stack local.


# Frontend — Crash Game

SPA em **Vite + React + TypeScript** do Crash Game. Consome a API REST pelo Kong
(`:8000`), escuta os eventos do jogo por WebSocket (socket.io) e autentica no
Keycloak via OIDC (Authorization Code + PKCE).

## Rodar

Junto com todo o stack (recomendado):

```bash
bun run docker:up
```

Em modo de desenvolvimento, com hot reload (precisa do backend no ar):

```bash
npm install
npm run dev
```

Outros scripts:

```bash
npm run build
npm run preview
npm run typecheck
```

## Configuração

As variáveis ficam em `.env` (use o `.env.example` como base). Os padrões já
apontam para o stack local:

| Variável                  | Padrão                  | Para quê                          |
| ------------------------- | ----------------------- | --------------------------------- |
| `VITE_API_URL`            | `http://localhost:8000` | API REST (via Kong)               |
| `VITE_WS_URL`             | `http://localhost:8000` | WebSocket (socket.io)             |
| `VITE_KEYCLOAK_URL`       | `http://localhost:8080` | Servidor Keycloak                 |
| `VITE_KEYCLOAK_REALM`     | `crash-game`            | Realm                             |
| `VITE_KEYCLOAK_CLIENT_ID` | `crash-game-client`     | Client público (PKCE)             |

**Usuário de teste:** `player` / `player123`.

## Estrutura

```
src/
  auth/         keycloak-js + AuthProvider (contexto de autenticação)
  api/          client REST tipado e os DTOs (espelham o backend)
  realtime/     contrato dos eventos do WebSocket
  game/         estado ao vivo (reducer + socket) e o hook da carteira
  components/   gráfico (canvas), palco, controles de aposta, apostas, histórico…
  utils/        formatação de dinheiro/multiplicador
```

A documentação completa da solução está em `../README_ATUALIZADO.md`.

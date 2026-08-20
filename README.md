# Shadow Cipher

A zero-knowledge codebreaker game on the [Midnight](https://midnight.network) blockchain.

Shadow Cipher is a Mastermind variant: crack a hidden **4-position, 6-colour** secret code
within **10 attempts**. The secret is committed on-chain at game start (as a hash of the
code plus a per-game salt, computed inside a Compact circuit), and the winning guess is
verified by a **ZK proof** against that commitment — the code itself never appears
on-chain and is never sent to the browser.

- **Gameplay rules:** [docs/gameplay.md](./docs/gameplay.md)
- **Chain & wallet integration:** [docs/midnight-integration.md](./docs/midnight-integration.md)
- **Deployment pipeline:** [DEPLOYMENT_PROCEDURE.md](./DEPLOYMENT_PROCEDURE.md)

## The sponsor-server model

Players never touch the chain and never pay fees:

- The **server holds the wallet** (`WALLET_SEED`) and sponsors every transaction with its
  own DUST. The browser talks only HTTP to the sponsor server.
- The **server is authoritative for game logic**: the secret code lives in a server-side
  session, peg feedback is computed server-side, and the 10-attempt cap is enforced
  server-side. Intermediate guesses are answered off-chain; only game creation and the
  final declared guess produce transactions.
- A background **pool worker** pre-creates on-chain games (commitments) so a new player
  can start instantly; if the pool is empty the game is created on demand, or the session
  falls back to a demo (off-chain) mode.
- Scores are recorded server-side when a game is declared (`POST /api/declare`); the
  arcade name-entry overlay afterwards only attaches initials to that recorded row.

The app targets **Midnight mainnet**.

## Repository layout

npm workspaces orchestrated with Turbo:

| Path | What it is |
|---|---|
| `shadowcipher-contract/` | The Compact contract (`src/shadowcipher.compact`) with circuits `create_game`, `submit_guess`, `delete_game`, plus compiled artifacts in `src/managed/shadowcipher/` |
| `server/` | The sponsor server (Express, TypeScript, SQLite): wallet, providers, game sessions, pool worker, leaderboard API |
| `frontend-vite-react/` | Vite 7 + React 19 frontend — canvas-based terminal/arcade UI (`src/pages/shadowcipher/`), wallet-connect widget, sponsor API client |
| `docs/` | Accurate gameplay and integration documentation |
| `.github/workflows/deploy.yml` | CI deploy to EC2 (see `DEPLOYMENT_PROCEDURE.md`) |

## Prerequisites

- Node.js 22 (root `engines` allows >= 18; CI uses 22) and npm
- [Compact tools](https://docs.midnight.network/relnotes/compact-tools) (`compactc`) — only
  needed to recompile the contract; compiled artifacts are checked in
- A Midnight **proof server** reachable at `PROOF_SERVER_URL` (default
  `http://127.0.0.1:6300`) for on-chain mode
- A funded sponsor wallet (NIGHT for DUST generation) for on-chain mode

## Install, build, run

```bash
npm install

# (Optional) recompile the contract circuits
npm run compact

# Build contract + frontend (also copies ZK keys into frontend/public)
npm run build

# Run the sponsor server (reads .env at the repo root)
cd server && npm start          # listens on PORT (default 3002; production uses 3003)

# Run the frontend dev server (proxies /api → http://localhost:3003)
npm run dev:frontend
```

The server builds its wallet and syncs DUST on startup — this can take several minutes
before the HTTP port is bound. Without `SHADOWCIPHER_CONTRACT_ADDRESS` set, it deploys a
fresh contract and prints the address to add to `.env`.

`npm run build-production` builds the contract and the frontend (as used by CI).
The server itself runs from TypeScript source via ts-node/tsx; `server/` also has
`npm run typecheck` and `npm run build`.

## Environment variables

The server loads `.env` from the repo root (and falls back to `server/.env`). Never commit
this file — it holds the mainnet wallet seed.

| Variable | Required | Purpose |
|---|---|---|
| `WALLET_SEED` | yes | Sponsor wallet mnemonic or hex seed. **Secret.** |
| `MIDNIGHT_NETWORK` | recommended | `preview` \| `preprod` \| `mainnet`. **Defaults to `preprod` when unset** — set it to `mainnet` explicitly, since that is the network the app targets. |
| `SHADOWCIPHER_CONTRACT_ADDRESS` | no | Reuse an existing deployed contract; if unset a new one is deployed on startup. |
| `PROOF_SERVER_URL` | no | Proof server endpoint (default `http://127.0.0.1:6300`). |
| `PORT` | no | Sponsor server port (default `3002`; production runs on `3003`). |
| `SQLITE_PATH` | no | SQLite database file (default `./data.db` in the server cwd). |
| `POOL_TARGET_SIZE` | no | Pre-created game pool size (default `20`). |
| `VITE_SPONSOR_URL` | no | Frontend build-time: sponsor server base URL. Leave blank for same-origin (nginx reverse proxy / Vite dev proxy). |
| `VITE_CONTRACT_ADDRESS` | no | Frontend build-time: contract address shown in the UI top bar. |

## License

Apache-2.0 (contract and server packages).

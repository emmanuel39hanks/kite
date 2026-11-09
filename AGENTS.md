# Working in this repository

Kite is an npm-workspaces monorepo plus a Rust workspace. What it is and what it claims: `README.md`. Design detail: `docs/DESIGN.md`.

## Layout

| Path | What |
|---|---|
| `contracts/vault` | The vault contract (Rust, near-sdk). Core logic: `src/lib.rs`. Tests: `src/tests.rs`. |
| `contracts/factory` | Creates vaults; embeds the vault wasm. |
| `contracts/integration-tests` | Sandbox tests (near-workspaces) against the shipped wasm. `contracts/mock-intents` stands in for NEAR Intents there. |
| `packages/keeper` | The keeper: drift check, 1Click quotes, `rebalance` / `settle` calls. CLI in `src/cli.ts`; attack demo in `scripts/attack.ts`. |
| `apps/web` | Next.js app (console, landing page, API routes, daily cron route). |
| `apps/film` | Remotion sources for explainer clips. Not part of the product. |
| `apps/web/public/vault/*.wasm` | The shipped contract binaries. Do not rebuild or replace them: the mainnet factory has no keys and embeds this exact vault file. |

## Commands

| Command | Needs | Notes |
|---|---|---|
| `node scripts/verify.mjs` | Node 22.9+; public NEAR RPC for the mainnet part | Read-only. No install needed. `--offline` skips the network; `--strict` treats an unreachable network as failure. |
| `npm ci` | npm registry | Installs all workspaces. |
| `npm test` | – | Web tests, then keeper tests (Node's test runner). |
| `npm run test:contracts` | Rust 1.95+ | Unit tests for vault and factory. |
| `npm run test:integration` | wasm32 target, cargo-near 0.22, downloads the NEAR sandbox (about 70 MB) | Linux or Apple-silicon macOS. About 5 minutes cold. Builds into `contracts/target`. |
| `npm run typecheck`, `npm run lint`, `npm run build` | The build fetches Google Fonts | |
| `npm run dev` | – | http://localhost:3000; `/console?preview=1` runs without a wallet. |
| `npm run keeper -- --vault <vault> --dry` | NEAR RPC, 1Click | Reads a vault and prints what the keeper would do. Runs dry when `KITE_AGENT_KEY` is unset. |
| `npm run attack -- --vault <vault>` | NEAR RPC, 1Click | View calls only. Requests unfunded 1Click quotes, some naming `attacker.near`; they expire unused. |

## Commands with side effects

These sign mainnet transactions with the keeper key (`KITE_AGENT_KEY`) or deploy contracts: `npm run attack -- … --send`, `npm run keeper` without `--dry` when the key is set, `scripts/deploy-factory.sh`, and `GET /api/cron` (needs `CRON_SECRET`).

## Conventions

- Env files (`.env*`) are never committed; examples are in `apps/web/.env.example` and `packages/keeper/.env.example`.
- TypeScript is strict; no `any`. Rust passes `cargo clippy -- -D warnings`.
- Contract source changes don't reach deployed vaults (no upgrade path), so behaviour notes about mainnet belong in docs and tests, not in `contracts/vault/src/lib.rs`.

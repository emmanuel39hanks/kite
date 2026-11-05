# Security

Kite is experimental, unaudited software. Use small amounts.

## Reporting a problem

Open a private report with GitHub's "Report a vulnerability" button on this repository's Security tab. Please don't open a public issue for anything that could move funds.

## Who can do what

| Party | Can | Cannot |
|---|---|---|
| **Owner** (your wallet) | Everything on your vault: change the plan and limits, pause, withdraw, revoke or restore Kite's key, close the vault. Each call needs a full-access signature (1 yoctoNEAR attached). | Change the vault's code. The vault account has no full-access key, so nobody can redeploy it. |
| **Kite's key** (held by the keeper) | Call `rebalance` and `settle` on your vault, and spend at most 0.25 NEAR of gas. | Call any other method, or any other contract. NEAR's protocol enforces this, not Kite's code. |
| **A `rebalance` call** | Swap inside your plan through a quote signed by NEAR Intents 1Click that pays your vault, within your limits. | Pick the deposit address, the payout or the prices of the traded pair. These come from 1Click's signature, which the vault checks on-chain. |
| **Anyone** | Call `settle`. It only reads balances and confirms or refunds the pending swap. | Clear a pending swap early, or make it look settled with a stale balance read. Tests `a26` and `a28` cover this. |
| **Kite's server** | Run the daily keeper and relay encrypted AI requests. | Sign for your wallet. Its only chain key is Kite's key above. |

## What a stolen Kite key can cost you

Kite's key can only do what the table above allows. Someone holding it can make trades you didn't need, inside your limits. Each trade can lose up to your price limit on at most your max trade size. At the defaults that is up to about 0.2% of the portfolio per trade, and about 0.8% a day at 4 trades a day. It lasts until you pause the vault or revoke the key, each one click in the console. The README's threat model gives the full derivation.

## If something goes wrong

| Situation | Who acts | What to do |
|---|---|---|
| Kite's key may be leaked | Operator | Make a new key pair and set `KITE_AGENT_KEY` and `NEXT_PUBLIC_KITE_AGENT_PK`. Each owner turns Kite's key off and on in **Guardrails** to install the new one. Until then, owners can revoke it. |
| A swap went missing | Nobody needs to act | After the settle window (30 minutes) `settle` trips the breaker and pauses the vault. The owner reviews, then unpauses. |
| The daily run fails | Operator | `/api/cron` answers 500 and logs one JSON line per vault (`cron: vault-failed`). It also fails when Kite's gas is under 0.05 NEAR: send the vault NEAR and renew the key. |
| You want out | Owner | Pause, then `withdraw` every balance. Then `close_vault`: it refuses while any balance is left, so nothing is stranded, and then deletes the vault account and returns its NEAR, including the storage deposit. |

The vault emits events for everything that matters, so an indexer or NearBlocks can watch for them: `rebalance_started`, `rebalance_settled`, `rebalance_refunded`, `rebalance_failed`, `breaker_tripped`, `paused`, `unpaused`, `agent_set`, `agent_revoked`, `limits_updated`, `plan_updated`, `withdraw`, `vault_closed`.

## How it is tested

- **75 contract unit tests**, 37 of them attacks a key thief might try (`npm run test:contracts`).
- **Mutation checks.** We removed each security check from the code, one at a time, and confirmed that a named test fails.
- **4 sandbox tests** (`npm run test:integration`) run the shipped wasm on a local NEAR node with real access keys and receipts. They cover: protocol-level key limits, no full-access key on the vault, code hash = sha256 of the file, a full rebalance and settle, a failed transfer, and a refused quote. They also measure gas: a whole rebalance costs about 0.0017 NEAR.
- **Keeper and web tests** (`npm test`) cover the pre-signing checks on every 1Click address field, the checks on AI output and the trade sizing.
- **Not audited.** Findings from review are fixed or written down below.

## NEAR security checklist

Checked against [docs.near.org/smart-contracts/security/checklist](https://docs.near.org/smart-contracts/security/checklist). Code is in `contracts/vault/src/lib.rs`.

| Checklist item | Kite |
|---|---|
| Every public method is meant to be public | Owner methods call `assert_owner`. `rebalance` calls `assert_agent` (the vault itself, signed by Kite's key). `settle` is public on purpose. The rest are views. |
| Callbacks are `#[private]` | `on_rebalance_balances`, `on_rebalance_sent`, `on_settle_balances`, `on_close_balances` |
| Admin changes need a deposit-capable key | Every owner method requires 1 yoctoNEAR (sandbox test: `pause` without it fails) |
| Inputs have bounds | Plan 2 to 8 assets, no duplicates. Allocate at most 8 transfers. Quote at most 4 KB, signature at most 128 characters. At most one reported price per plan asset, no repeats (`a29`, `a30`). Limits validated. |
| Overflow checks in release | `overflow-checks = true` in `contracts/Cargo.toml` |
| Funds locked before a transfer is scheduled | `pending` is set before `mt_transfer`. While a swap is pending, `withdraw` of either token and new trades are refused. |
| Callbacks handle failure and keep state consistent | A failed transfer clears `pending` (unit test and sandbox test). A late or stale balance read can't judge a swap (`a26`, `a28`). An unconfirmed swap is still judged after the window. |
| Another method may run before the callback | Tested for `settle` racing the transfer (`a26`, `a28`) and for a replayed quote |
| Gas sized for callbacks | Static gas per callback. Measured in the sandbox: rebalance 10.6 Tgas, settle 5.7 Tgas, against 200 and 150 attached. |
| Contract keeps enough liquid balance | 2.6 NEAR covers storage for about 233 KB, with about 0.24 left for gas. The keeper refuses to trade under 0.05 NEAR. |
| Reproducible artifacts and a verified code hash | The build command strips local paths. The sandbox test asserts that the code hash equals the sha256 of the shipped file. Not done: a Docker reproducible build (`cargo near build reproducible-wasm`) and SourceScan verification. |
| Monitoring and a response plan | Events above, a cron that fails loudly, a breaker, and the response table above |
| Upgrade path | None by design. There is no full-access key and no upgrade method; to change code you close the vault and create a new one. |

## Known gaps

- **Prices of assets outside the trade are reported by the keeper**, not signed. With three or more holdings, a stolen key could fake them to make drift look bigger, forcing trades that each cost up to the price limit. This is inside the loss bound above and the rate limits.
- **App fees aren't covered by 1Click's signature**, so the vault can't see them. A fee still has to fit inside the price limit.
- **One keeper key serves every vault.** Each owner can revoke it in one click. Deriving per-vault keys from one secret wouldn't help against a keeper breach. Running the keeper in an attested TEE would, but NEAR's Shade Agent framework for that is deprecated.
- **Browser wallet SDKs carry npm audit advisories** with no compatible upstream fix: denial-of-service issues in client-side dependencies of the Meteor and HOT adapters. Server routes import none of them.
- **Rate limits in the code are per server instance.** Vercel firewall rules would make them global.
- **No mainnet run yet,** and no external audit.

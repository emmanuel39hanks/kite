# Kite: design notes

The detail behind the [README](../README.md): how the vault works on mainnet, every check and the attack that tests it, the DAO flow, earning assets, the private AI features, how to operate it, and what we learned building on NEAR. Start with the README; come here for depth.

---

## Status

| | Status |
|---|---|
| Contract: plan, guardrails, signed-quote checks, settle and breaker, close | Built. 95 unit tests and 8 sandbox tests pass. |
| Keeper and web app | Built and deployed at usekite.xyz. |
| Preview mode with real quotes | Works. Simulated vault, real prices and quotes. |
| **End-to-end runs on NEAR mainnet with real funds** | **Done, for a personal vault and for a DAO vault.** **Unattended on the live DAO vault:** the hourly run of Nov 11, 2026, 22:00 UTC rebalanced `kite-dao-2.kitevaults.near` after the DAO voted a new mix ([`Ck1NVbN…`](https://nearblocks.io/txns/Ck1NVbN6R12bpr4r4sppsE2MFXb7fMJ6rvNGUPpkukC), settled in [`7BGF6rf…`](https://nearblocks.io/txns/7BGF6rfhjbdW9BQmttAqKM3BQjeiuYJaduRxaRDArQBt)). **Personal vault** `emmanuelhaanks.kitevaults.near`, created from Meteor: create [`AV6EWVg…`](https://nearblocks.io/txns/AV6EWVgcgg4bnRVkaUE5Z3od7a7eKPUWruoFaV7xAV8N), invest (two swaps) [`Bc7fta4…`](https://nearblocks.io/txns/Bc7fta43DEHtty1XU9qnRu246ThkwYBD913CjSTdZjR2), new target 90/10 [`J5c8Uis…`](https://nearblocks.io/txns/J5c8UisBE4N4U4gmrB45CDHy7DZvAXbo3zU2SvaPbjKc), limits [`Nx2mGiE…`](https://nearblocks.io/txns/Nx2mGiEmYM3usw9YqNBEmd9EKc2vQi4yJi8K6G9R7tw), **Kite's key rebalanced** (sold $1.15 of ETH for BTC at 0.33% cost, signed 1Click quote checked on-chain) [`EWkADR5…`](https://nearblocks.io/txns/EWkADR59cwwnYLspLUAmrjbqQaWKFvWSV79oHJfCc8f7) and settled [`4RbnhSF…`](https://nearblocks.io/txns/4RbnhSFQSBwueYMagQGfKyxvPNg1dgbMm9EeSYtzGP2n), withdraw [`72UQTsw…`](https://nearblocks.io/txns/72UQTswvkV5nUdgHQn3P9fEwUMMehdLWqhi3mSq53ngv), close [`7cPBbUv…`](https://nearblocks.io/txns/7cPBbUvrhn1RA9UF1VQdw5BpPRtHThjdGNRMDnnEgzJM). **DAO vault** `kite-demo.kitevaults.near`, owned by the Trezu-made `kite-demo.sputnik-dao.near`, every step a vote: create [`Af3Wqkj…`](https://nearblocks.io/txns/Af3Wqkj4djSeD63wt98MJod3QsyfkqFYNtAZqpy41Wdj), move 3 USDC in [`BbJyZvv…`](https://nearblocks.io/txns/BbJyZvva6cc1D1Gb4pVtg2gYbR5CEXufWdxc3h9u9smy), invest [`GbhmNKy…`](https://nearblocks.io/txns/GbhmNKyKFodcGXJL8i4vyq15Ud6pUd8z7FM1rp6cNKje), withdraw everything back to the DAO as USDC [`CbWbKsu…`](https://nearblocks.io/txns/CbWbKsuXiHxCgRZE3CNGUfadKviun3S5ghvHL9U3RNSg) (2.981 of 3 USDC came back after the round trip), close and return the 2.6 NEAR deposit [`GRoLMGD…`](https://nearblocks.io/txns/GRoLMGDxAL46PdzUGb4Dk4v7J5L5ZC2W9QTqMcrncDiT). |
| Vault factory (DAO creates its own vault) | Built and tested against the real SputnikDAO v3.2 in the sandbox (17 unit tests, 2 sandbox tests). **Live and locked on mainnet** at [`kitevaults.near`](https://nearblocks.io/address/kitevaults.near): deployed in [`4WX2i7p…`](https://nearblocks.io/txns/4WX2i7p4oAx86AmkrEX5QNX8xJ89nY2y2MqWYgsFn4hJ), its only key deleted in [`JrAZuKD…`](https://nearblocks.io/txns/JrAZuKDyaTppVTjjG3eVBCUJw1yFmPDS6g9MfGASTAm), so it has no access keys. Its code hash on chain equals the sha256 of `kite_factory.wasm` (`cb670574…`), and `get_config` reports the vault hash of `kite_vault.wasm` (`484f929b…`). The DAO view re-checks both before anyone proposes. |
| Private AI features (NEAR AI Cloud) | Work in a browser. The model, the number checks and the clamps were tested against the live API. |

---

## Try the preview (no wallet, no funds)

NEAR Intents has no testnet, so Kite has a **preview mode**: live prices, **real 1Click quotes requested with `dry: true`**, a vault simulated in your browser, nothing signed or sent.

1. Open https://www.usekite.xyz/console?preview=1 (or run `npm run dev` and open http://localhost:3000/console?preview=1).
2. **Explore** → **Steady** or **Bitcoin Plus** → **Start this plan** → **Create vault (preview)**. The panel lists exactly what the real signature grants.
3. **Add money:** **Bitcoin** → **Get a real quote** shows a live 1Click quote (BTC in, USDC out, cost and time). Or **USDC in my NEAR wallet** → `1000` → **Send**. The preview wallet starts with 1,000 USDC and 5 NEAR.
4. **Invest:** **Invest at today's real quotes** prices each slice with a dry 1Click quote. Or pick **1 year ago**, which replays Kite's check on real daily closes with your guardrails. **Activity** lists every rebalance and the drift that triggered it.
5. **Home** shows value, a chart of the vault's own history, profit and loss on what you put in, return per holding, drift against your band, and what the earning parts make.
6. **Check now** runs Kite's rule on live prices (a dry check in the real app; in the preview it applies the trade to your simulated vault). If something is past your band it gets a real dry quote and applies the vault's checks. It trades only inside your price limit, otherwise it logs the refusal the contract would give (`ERR_SLIPPAGE`, `ERR_RATE`, …). Lower the band on **Guardrails** to see it trade.
7. **Review your plan** (Home): numbers from real price history, explained privately. See [Private AI](#private-ai-on-near-ai-cloud).
8. **Guardrails:** change limits by slider or by typing "be more careful". Switch Kite's key off and checks log `ERR_NO_AGENT`. **Withdraw** everything, then **Close** to get the 2.6 NEAR deposit back.

| Real | Simulated |
|---|---|
| Prices: 1Click `/v0/tokens` | The vault and its balances, kept in `localStorage` |
| Every swap amount: 1Click `/v0/quote` with `dry: true` (`apps/web/src/app/api/preview/quote`) | The wallet: 1,000 USDC and 5 NEAR |
| Daily price history: Kraken, CoinGecko as fallback | Back-dated swap cost: a flat 0.3%, about what live quotes show |
| Yields: Meta Pool, Lido, Morpho, Kamino APIs | |
| The rebalance rule: `apps/web/src/lib/preview/engine.ts` mirrors `packages/keeper/src/drift.ts` and the contract | |

---

## How it works on mainnet

Connect a NEAR wallet (HOT, Meteor, Intear, Sender, Nightly or OKX).

| Step | What happens on chain |
|---|---|
| Create your vault | One function call from your wallet to Kite's locked vault factory: `kitevaults.near.create_vault(name, plan, limits, agent)` with 2.6 NEAR attached (storage and gas, refunded on close). The factory creates `<name>.kitevaults.near`, deploys this repo's vault code (compiled into the factory, so it can't differ), calls `new` with **you** as owner, and adds Kite's keeper key: `FunctionCall` only, receiver = your vault, methods `rebalance, settle`, 0.25 NEAR allowance. The name comes from your account (`alice.near` → `alice.kitevaults.near`; `-2`, `-3` once a name is used). The app waits for the vault to exist before calling it created, because a failed creation is refunded inside a transaction that still succeeds. **Why the factory:** wallets such as Meteor refuse to let an app deploy contract code to your account, which the first version did (`kite.<you>`, deployed from your wallet). Vaults made that way still work and the app still finds them. **Several vaults per account:** the account menu lists every open vault and switches between them (remembered in the browser), and **New vault** starts another, each with its own deposit. Closed ones stay listed under **Past vaults** on Profile, rebuilt from their transactions: what went in, Kite's trades and what came out. |
| Add money | Send USDC from your NEAR wallet (`ft_transfer_call` to `intents.near`, `msg = vault`). Or `/api/deposit/quote` gets a 1Click deposit address on Base, Arbitrum, Ethereum, Bitcoin or Solana, and what you send lands in your vault as USDC inside `intents.near`. |
| Invest | You sign `vault.allocate(transfers)`: slices of USDC go to 1Click deposit addresses that swap into each plan asset and pay **back to the vault**. |
| Hourly check | `/api/cron` (Vercel Cron, needs `CRON_SECRET`, needs `KITE_AGENT_KEY` to send real transactions; checks the vaults in `KITE_VAULTS` first, then every factory vault that carries Kite's key) or the keeper CLI runs `runOnce`: reads balances and drift, gets a 1Click quote, checks it locally, calls `vault.rebalance(quote, signature, prices)` with the keeper key, waits up to two minutes for the swap to land, then calls `vault.settle()`. One run is therefore a whole rebalance; if the swap is slow, the next run settles it. **Check now** in the app is always a dry run that shows what Kite would do. |
| Guardrails | Owner calls `set_limits`, `revoke_agent`, `set_agent`, `pause`, `unpause`, `set_quote_signer`. Each needs 1 yocto attached, so only your full-access key can call them. |
| Leave | **Withdraw** brings everything back to your NEAR wallet **as USDC**: each holding goes by `withdraw` to a 1Click address (checked with NEAR Intents first: swaps into USDC, delivered to your wallet, refunds to you) and the vault's USDC goes on to your wallet through `intents.near` `ft_withdraw`. Then `close_vault`: it refuses while anything is left, then deletes the account and returns its NEAR to you. Anything already in your own NEAR Intents account (a refund, an older withdrawal) shows on Profile with one button to bring it back as USDC. A **DAO** takes money out the same way, by one proposal: every holding (USDC too) goes to a 1Click address that delivers USDC to the DAO's own account, quotes good for its voting window; each voter's page checks every address with NEAR Intents before it offers a vote. A second proposal closes the empty vault and returns its NEAR deposit to the DAO. |

### Where your money is at every step

While a rebalance is in flight, **Home** shows a card driven by the vault's pending swap and 1Click's status API (`/v0/status`, no key needed). Three steps: **left your vault → being swapped → back in your vault**, with a plain line on where the money is, and links to the vault transfer, the delivery transaction and the NEAR Intents explorer.

- `SUCCESS`: delivered.
- `REFUNDED`: says the swap did not complete and the money was returned to the vault, with the amount and the reason 1Click gave.
- `FAILED`: says failed, shows a reference, and **never claims delivery or safety**; where the money is must be checked against the vault balance.
- `INCOMPLETE_DEPOSIT`: less arrived than the quote needed; a refund follows.

Code: `apps/web/src/components/console/swap-tracker.tsx`, `apps/web/src/lib/near/swap-status.ts`.

### History, including what the robot did while you were away

**Activity** lists your own actions and also Kite's `rebalance` and `settle` calls **read from the chain** (NearBlocks, via `/api/vault/history`), so trades made while your browser was closed show up with transaction links.

---

## What NEAR does here

- **NEAR Intents:** holds every asset as NEP-245 balances owned by your vault account (nBTC, ETH, SOL, NEAR, XRP, DOGE, ADA, TRX, LINK, LTC, SUI, ZEC, BCH, AAVE, UNI, USDC, USDT, Tether Gold, plus the earning versions stNEAR, wstETH, gtUSDCp, kV-gtSOLb). Each has a live 1Click route (`npm run routes -w packages/keeper` checks the five core ones). A plan holds at most eight assets.
- **NEAR AI Cloud:** the private AI features below, end-to-end encrypted to attested model hardware.
- **Function-call access keys:** limit Kite's keeper to two methods at the protocol level.
- **Auth by predecessor** (default in `intents.near`): the vault contract moves its own Intents balances with no keys registered there. Custody stays with a contract only you control.
- **Account model:** one readable, deletable account per vault (`<name>.kitevaults.near`), owned by your wallet, whose storage deposit is refunded on close.
- **No foreign-chain signing, by design.** A vault that could sign transactions on other chains would let funds leave outside a signed 1Click quote, which is the property Kite is built around. Assets from other chains are held through NEAR Intents instead.

---

## How the vault protects you

Code: `contracts/vault/src/lib.rs`. Every refusal has a named error in `contracts/vault/src/errors.rs`.

**Kite's keeper never decides where money goes.** Every `rebalance` must carry a quote **signed by NEAR Intents 1Click**, and the vault verifies it on-chain:
- **Signature:** ed25519 over `base58(sha256(quote json))`, against 1Click's published key `reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`. The owner can rotate it with `set_quote_signer`.
- **Terms:** what is sold and bought, the amounts, the deposit address, the minimum out and the USD values all come from the signed quote, not from the keeper.
- **Payout and refund:** the quote must pay out to the vault and refund to the vault, inside NEAR Intents.
- **Freshness:** under 5 minutes old and newer than the last one used.

### We tried to rob our own vault

We played an attacker who stole Kite's key and tried everything we could think of. Every attempt is refused, by NEAR itself or by your vault. The first two rows are enforced by the NEAR protocol, so the contract tests can't exercise them; the live `--send` script below does. Every other row has a named error and a test in `contracts/vault/src/tests.rs`.

| The attacker tries to… | Stopped by | Refusal |
|---|---|---|
| Withdraw your money to their own account | NEAR (the key can only call `rebalance`/`settle`) | `MethodNameMismatch` |
| Skip the vault and move funds in `intents.near` directly | NEAR (the key only works on the vault) | `ReceiverMismatch` |
| Loosen your limits, unpause, change the plan, or allocate | NEAR, **and** the contract | `MethodNameMismatch`, `ERR_NOT_OWNER` |
| Use a **real** 1Click quote that pays the attacker | Your vault | `ERR_QUOTE_RECIPIENT` |
| Use a real quote that refunds the attacker, then make the swap fail | Your vault | `ERR_QUOTE_REFUND` |
| Edit a quote, or sign a fake one | Your vault | `ERR_QUOTE_SIG` |
| Save a quote for later, or replay a used one | Your vault | `ERR_QUOTE_STALE`, `ERR_QUOTE_REPLAY` |
| Pass off a dry quote, or one with no deposit address | Your vault | `ERR_QUOTE_TERMS` |
| Lie about prices to sneak a huge trade through | Your vault (traded assets are valued at the signed quote's prices) | `ERR_TOO_BIG` |
| Accept a bad price, or ask for a loose minimum | Your vault (fees included, using 1Click's signed USD values) | `ERR_SLIPPAGE` |
| Buy something that isn't in your plan | Your vault | `ERR_NOT_IN_PLAN` |
| Sell something that isn't over its band, or buy something already over target | Your vault | `ERR_NOT_OVER_BAND`, `ERR_WRONG_DIRECTION` |
| Trade over and over to bleed fees, or overlap swaps | Your vault | `ERR_RATE`, `ERR_PENDING` |
| Put a referral or a redirect field in the quote | Your vault (those fields are covered by 1Click's signature, so the vault can see and refuse them) | `ERR_QUOTE_TERMS` |
| Use some other key that sits on the vault account | Your vault (only the key recorded for Kite works) | `ERR_NOT_AGENT` |
| Burn the daily trade count with dust trades | Your vault (nothing under $1) | `ERR_TOO_SMALL` |
| Ask for a quote that needs a deposit memo, so the swap never starts | Your vault | `ERR_QUOTE_TERMS` |
| Call `settle` before the money has left, so the vault forgets the swap | Your vault (a swap is judged only once the transfer to 1Click is confirmed, or the settle window has passed) | `settle` answers `waiting` |
| Time a `settle` so its balance read misses the transfer out, making the swap look refunded | Your vault (only a read sent after the transfer was confirmed may judge the swap) | `settle` answers `waiting` |
| Sell so much that a holding overshoots its target | Your vault (a trade may not pass the target by more than the band) | `ERR_TOO_BIG` |
| Keep trading after a swap goes missing | `settle` trips a breaker after the settle window, pausing the vault | `ERR_PAUSED` |

**Run the attacks yourself:**
- **Contract tests:** `cargo test --manifest-path contracts/Cargo.toml -p kite-vault attack_` runs the 42 attack tests (95 vault tests in total).
- **Against a live vault, free:** `npm run attack -- --vault <an open vault>` (open vaults are listed at https://www.usekite.xyz/api/status). No key, no funds, no transactions: it asks 1Click for unfunded quotes and hands them to the vault's `check_quote` view. Row Q0 is the control: the honest quote, untouched, must pass.
- **As real transactions:** add `--send` with the keeper key. Calls the vault refuses become failed transactions with a hash (two from our run: [`9vR2buf…`](https://nearblocks.io/txns/9vR2bufkfotztJpuP8Rzdm935YkkPBjzPNBL3a6Ri2vR) `ERR_QUOTE_RECIPIENT`, [`5Q1dQEX…`](https://nearblocks.io/txns/5Q1dQEXK58Jbn3hjteko2sgaMqcrzvJjuSEnDeH5pdcp) `ERR_QUOTE_SIG`). Calls that NEAR itself turns away (wrong method, wrong contract, a deposit attached) never become transactions, so they have no hash. Add `--out file.md` to save the transcript.

**Threat model:** a fully compromised keeper still can't redirect a swap: its output and any refund can only go back to your vault. It can still make trades you didn't need, inside your guardrails and rate limits, and waste swap costs doing it. How much depends on the plan:

- **Plans with two assets: the cost has a number.** Each trade can lose at most your price limit (default 1%) of the amount traded (default at most 10% of the portfolio). The vault checks two things, the quote's output value and its guaranteed minimum, so a fill at the minimum can cost close to twice that. At the defaults that is up to about 0.2% of the portfolio per trade and at most 4 trades a day, so **up to about 0.8% a day**, until you revoke Kite's key or pause the vault. With two assets a trade also can't be undone by the next one: once the mix is back inside the band, the reverse trade is refused (test `two_assets_a_trade_cannot_be_reversed`).
- **Plans with three or more assets.** Each trade is still bound by the price limit on the signed quote, and nothing can be sent anywhere but the vault. The per-day figure above is worked out for two-asset plans; the multi-asset cases are recorded by the `known_limit_…` tests, and the next vault version extends the same bound to them.

1Click's signature does not cover a quote's app fee, so a thief's key could ask for a quote that pays a fee to the thief. The fee comes out of the swap, so it has to fit inside your price limit: it is part of the cost above, not on top of it. Tightening the band, trade size, price limit and trades a day tightens all of the above.

**Defaults:** a holding must drift 5 points before Kite acts, one trade moves at most 10% of the portfolio, a swap may cost at most 1% fees included, at most 4 trades a day (the four-hour gap between trades allows at most 6), and a swap that hasn't landed after 30 minutes pauses the vault. You can change all of these.

**Gaps we found and closed:** (1) the first version took the deposit address and reference prices from the keeper. Writing the attack suite showed a stolen key could have pointed one trade at itself; verifying 1Click's signature on-chain closed it. (2) Review found the vault ignored referral and redirect fields in the signed quote; they are now refused. (3) A zero gas allowance used to mean unlimited, and `rebalance` accepted any key on the vault account; both are fixed. (4) Trades under $1 are refused, so dust can't burn the daily trade count. (5) `settle` called before the transfer out landed could clear a pending swap; the vault now waits for the transfer, and judges the swap anyway once the settle window ends, so it can never be stuck. (6) A `settle` whose balance read was sent before the transfer was confirmed could see stale balances and call the swap refunded; such a read is now ignored.

**Against NEAR's security checklist:**

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
| Gas sized for callbacks | Static gas per callback. Measured in the sandbox: rebalance 10.6 Tgas, settle 5.7 Tgas, against 200 and 150 attached. On mainnet the keeper transactions cited in the README burnt 14.7 to 14.9 Tgas (rebalance) and 7.3 to 7.5 Tgas (settle). |
| Contract keeps enough liquid balance | 2.6 NEAR covers storage for about 239 KB, with about 0.20 left for gas. The keeper refuses to trade under 0.05 NEAR. |
| Reproducible artifacts and a verified code hash | The build command strips local paths. The sandbox test asserts that the code hash equals the sha256 of the shipped file. CI rebuilds both contracts on macOS arm64 with the pinned toolchain on every push and compares them with the shipped files (`.github/workflows/wasm.yml`). Next: a Docker reproducible build (`cargo near build reproducible-wasm`), so any host gives the same bytes, and SourceScan verification. |
| Monitoring and a response plan | Vault events (listed below), a cron that fails loudly, a breaker, and the response plan below |
| Upgrade path | None by design. There is no full-access key and no upgrade method; to change code you close the vault and create a new one. |

**If something goes wrong:**

| Situation | Who acts | What to do |
|---|---|---|
| Kite's key may be leaked | Operator | Make a new key pair and set `KITE_AGENT_KEY` and `NEXT_PUBLIC_KITE_AGENT_PK`. Each owner turns Kite's key off and on in **Guardrails** to install the new one. Until then, owners can revoke it. |
| A swap went missing | Nobody needs to act | After the settle window (30 minutes) `settle` trips the breaker and pauses the vault. The owner reviews, then unpauses. |
| The hourly run fails | Operator | `/api/cron` logs one JSON line per vault (`cron: vault-failed`) and answers 500 if a vault listed in `KITE_VAULTS` failed. It also fails when Kite's gas is under 0.05 NEAR: send the vault NEAR and renew the key. |
| You want out | Owner | Pause, then `withdraw` every balance. Then `close_vault`: it refuses while any balance is left, so nothing is stranded, and then deletes the vault account and returns its NEAR, including the storage deposit. |

The vault emits events for everything that matters, so an indexer or NearBlocks can watch for them: `rebalance_started`, `rebalance_settled`, `rebalance_refunded`, `rebalance_failed`, `breaker_tripped`, `paused`, `unpaused`, `agent_set`, `agent_revoked`, `limits_updated`, `plan_updated`, `withdraw`, `vault_closed`.


---

## Kite for DAO treasuries

A DAO's treasury drifts like anyone's portfolio, but every trade needs a vote, so it rarely gets rebalanced and idle stablecoins earn nothing. A DAO can own a Kite vault instead: it votes once on a plan and guardrails, Kite's keeper rebalances inside them through NEAR Intents, and every later change is another vote.

- **How a DAO gets a vault: one vote.** In the DAO view, a council member fills in the DAO, a vault name and a plan, and files one proposal. When it passes, the DAO calls Kite's **vault factory** (`contracts/factory`, for `kitevaults.near`), which creates `<name>.kitevaults.near` with the DAO as owner from the first block. No person's wallet ever holds it. It costs the DAO 2.6 NEAR, which the vault keeps for its code's storage and gas and returns, less what was spent, when it's closed.
- **The factory can't be changed.** It has no owner, no admin method and no upgrade path, and the deploy script deletes its keys. The vault code is compiled into it, so every vault it makes runs the same file as `apps/web/public/vault/kite_vault.wasm`: `get_config` reports that file's hash, and before anyone proposes, the DAO view checks that the factory has no keys and that the hash matches the file this site serves. A creation that fails anywhere is refunded in full and the DAO's proposal ends **Failed**, not Approved: the factory refunds first, then fails on purpose, because a DAO marks a call that returns quietly as passed. If a refund can't be paid on the spot, it's recorded and the DAO claims it with one proposal (the DAO view offers it).
- **Why not a global contract.** NEAR's global contracts would let every vault share one copy of the code, so a vault would cost cents instead of 2.6 NEAR. Publishing one burns 0.0001 NEAR a byte, about 23.8 NEAR for the vault, which is more than this project has. A vault's 2.6 NEAR is a deposit that comes back; the 23.8 would be gone. It's the obvious next step with funding.
- **Putting money in takes two votes.** A DAO moves its own money only by vote, so the DAO view's **Put money in** shows three steps with live balances. (1) Anyone sends the DAO USDC; from a connected wallet the page does it in one transaction, registering the DAO with the USDC contract first if needed. (2) A proposal calls `ft_transfer_call` on the USDC contract to NEAR Intents with the vault as the receiver, so the money lands in the vault's Intents balance. (3) A proposal calls `vault.allocate` once per swap, with 1Click deposit addresses that swap into the plan and pay back to the vault. Before that proposal is filed, the page checks every address with NEAR Intents itself (`verifyAllocation`): right asset, right amount, paid to this vault, refunded to this vault, no foreign fee. Anyone the DAO allows can file an `allocate`, so the voter's page checks again before it offers **Approve** (`verifyAllocateProposal`): every swap must be live, pay this vault, buy an asset in its plan and carry no foreign fee, and the page lists what each one buys and when its quotes end. A proposal that fails the check gets a warning and no vote button. The quotes last as long as the DAO's voting window, up to 72 hours; if the vote runs late or a price moves past 1%, 1Click refunds the USDC to the vault and the DAO files again. The DAO's proposal list shows these USDC moves alongside the vault's own calls (`touchesVault`), flagged as moving money.
- **Or hand over a vault you already have.** A vault you own can also go to a DAO in two steps: `propose_owner(dao)` from you, then a DAO proposal that calls `accept_owner`. Until the DAO accepts, nothing changes; after, you have no control at all.
- **Every owner action is a proposal.** SputnikDAO (the contract behind most NEAR DAOs, and behind Trezu) executes a `FunctionCall` proposal from the DAO's own account, which is exactly what the vault's owner check needs. Pause, guardrails, plan, Kite's key and withdrawals all work this way.
- **Decisions point at their evidence.** `set_plan` and `set_limits` take an optional `policy_ref`, the sha256 of the analysis behind the change. The vault writes it to its event log, so the chain records which analysis each policy change was voted on.
- **Proved against the real contract.** The sandbox test `a_sputnik_dao_takes_over_the_vault_and_runs_it_by_vote` deploys SputnikDAO v3.2, fetched from mainnet's `sputnik-dao.near` factory and checked against its code hash `DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF`, and runs the whole handover and three votes with real transactions.
- **Verifiable treasury policy (NEAR AI).** In the DAO view, **Verified treasury policy, written by NEAR AI** (**Draft the policy**, then **Propose to the DAO**) turns the guardrails on the sliders into a DAO proposal whose reasoning anyone can check. Code computes every number: the plan's statistics from real price history, the worst case a stolen key could cost under these limits, and the exact `set_limits` / `set_plan` call. A model on NEAR AI writes the rationale with no numbers of its own. NEAR AI's attested gateway signs `model:sha256(request):sha256(response)`, which shows NEAR AI produced exactly these bytes for this model, not which hardware ran it; Kite packs the request, the answer and the signature into the proposal's last line, and puts `policy_ref = sha256(that bundle)` into the vault call itself.
- **Any voter can check it at [/verify](https://www.usekite.xyz/verify)** with the DAO and proposal number, in their own browser: the signature (NEAR AI's SDK), that the signed hashes match the kept bytes, that the signing key is in NEAR AI's current TEE report for its gateway (checked today), that the description wasn't edited, that the proposal calls exactly what was analysed plus that `policy_ref`, and the worst-case figure recomputed from the calls. Anything it can't check shows grey, never green. After the vote, the vault's own log carries the same `policy_ref`.
- **How the model writes without writing numbers.** It cites figures by placeholder (`{band}`, `{worst_day}`, `{mix}`, …) and Kite's code fills them in, so the prose reads naturally while every figure comes from code. A section with an unknown placeholder, a number of its own (digits, number words, fractions) or an echoed title is refused, and Kite retries up to three times before falling back to a fixed template. The policy model is `z-ai/glm-5.3` (answers signed by NEAR AI's attested gateway, about a cent a proposal); the quicker `z-ai/glm-5.3-flash` does everything else.
- **Tested live,** through Kite's relay against NEAR AI: three policies for a DAO asking to "keep at least half in stablecoins", each written by the model on its first try, each **Verified** on every check (signature, hashes, the gateway's TEE report, Kite's own prompt, unedited text, vault owner, calls, `policy_ref`, worst case). Changing one letter of an answer fails the check. The security review's forgeries (a self-signed key, a prompt someone else wrote, a relabelled mix, another owner's vault, a call with a deposit) each fail a named test.
- **On mainnet:** proposal 24 on `kite-demo.sputnik-dao.near` is such a policy for the live vault, approved by vote. It reads Verified on every check at https://www.usekite.xyz/verify?dao=kite-demo.sputnik-dao.near&id=24.

## Earn while you hold

In **Create → Choose how much**, any NEAR, ETH, USDC or SOL slice can be switched to an earning version. It keeps the same price moves and adds a yield. The ready-made **Steady** plan holds its dollars this way, and the **Earn** page shows what your vault makes a year.

| Slice | Held as | Yield from | Live APY source (no API key) |
|---|---|---|---|
| NEAR | stNEAR `nep141:meta-pool.near` | Meta Pool staking | `validators.narwallets.com/metrics_json` (30-day) |
| ETH | wstETH | Lido staking | `eth-api.lido.fi` (median of 7 days; the mean is skewed by spikes) |
| USDC | gtUSDCp (wraps Gauntlet USDC Prime on Morpho, Base) | Morpho lending | Morpho GraphQL `netApy` |
| SOL | kV-gtSOLb | Kamino lending | Kamino `kvaults/…/metrics` (30-day) |

- **Valuation:** at 1Click's price, which tracks each token's exchange rate (checked: stNEAR/NEAR ≈ 1.505, kV-gtSOLb/SOL ≈ 1.056). gtUSDCp's units are tiny (about $0.0000011 each), so the UI shows its price per million.
- **Price limit:** each earning asset carries a 2% limit, stored per asset in the vault plan (`Target.max_slippage_bps`, at most 5%), because a round trip costs about 1–2%. A trade uses the widest of the global limit and its two assets' limits.
- **Backtests:** for earning versions they use the base asset's real history × today's exchange rate, grown back at today's APY. The UI labels this an estimate.
- **Worth knowing:** switching in and back out costs about 1–2%, so earning pays off over months. gtUSDCp and kV-gtSOLb are on NEAR Intents' official [1Click earn list](https://docs.near-intents.org/integration/distribution-channels/1click-api/earn.md), with the same token IDs Kite uses.

---

## Private AI on NEAR AI Cloud

Five features use a model on NEAR AI Cloud. They share one design rule: **the model never computes a number and never decides a trade.** Numbers come from code; the model only says what they mean; every answer is checked before it is shown; and the vault's contract limits are the enforcer.

| Feature | Where | What the model sees | What is checked before you see it |
|---|---|---|---|
| **Plan builder** | Create → Describe your goal | Your sentence, per-asset real-price statistics (yearly swing, worst fall, 30/90-day return, link to Bitcoin), live yields, your current mix as percentages | Assets limited to Kite's six, weights re-normalized to 100, rules clamped. Any cited "basis" fact containing a number we didn't supply is dropped. |
| **Plan review** | Home → Review your plan | Percentages only: no amounts, no wallet | The 10 statistics are computed in the browser from real history. A model sentence that contains any digit is discarded; the app prints each number itself. Suggestions are a fixed list. |
| **Rules in plain words** | Guardrails | The four rule values and your sentence | Clamped to the app's ranges (inside the contract's); "more careful" can never loosen a rule; it only moves sliders, you still press Save |
| **Explain a refund or failure** | The swap card | Status, tickers, 1Click's refund reason (treated as data) | The model's "where is the money" must match what the status implies, or the standard text is used. No digits. |
| **"Why?" on a rebalance** | Activity | Facts read from the vault's own `rebalance_started` log on chain (`/api/vault/why`): what was sold, bought, and how far over target | Numbers in the wording must be ones from those facts, or a fixed template is used |

**How the private call works** (`apps/web/src/lib/ai/private-ai.ts`, `@nearai/inference-sdk` in the browser):
1. The browser verifies NEAR AI's attestation for the model.
2. It encrypts your message to the attested model key (X25519 + XChaCha20-Poly1305).
3. Kite's server relays the encrypted bytes (`apps/web/src/app/api/nearai/v1/[...path]`), adds the API key, allows only Kite's model and the endpoints the SDK needs, and rate-limits visitors.
4. The browser checks the signature on the reply. The panel says which kind it was: **signed by the model's hardware** (`provider_tee`), or only **by NEAR AI's gateway**, a weaker guarantee that it shows as such.

**What we do not claim:** that nothing can ever read your words (this holds as far as you trust the open-source code this page runs), that a signature proves the model's text is *true* (it proves who produced it, so the facts and numbers are checked in code instead), or that signatures stay re-checkable forever (NEAR AI doesn't document how long, so we save the id on your device and say "re-checkable while NEAR AI retains it").

**Model:** `z-ai/glm-5.3-flash`, with reasoning turned off (it cut a draft from about 14 s to about 5 s). A draft costs a fraction of a cent and usually takes 10–15 s end to end in a browser.

---

## Repository

A monorepo: npm workspaces for the TypeScript, one Cargo workspace for the contracts.

```
apps/web/                    Next.js 16 app: landing page, console, API routes, the hourly cron
  src/app/                   pages and API routes
  src/components/            landing/ (marketing page), console/ (product UI), shared logo and charts
  src/lib/                   ai/ (private AI and the checks on its output), market/ (prices, history, yields),
                             near/ (wallet, vault calls, swap status), preview/ (no-wallet engine),
                             server/ (route guards, 1Click client), shared assets, plans, mix, store
  public/vault/              kite_vault.wasm: the exact contract the app deploys; kite_factory.wasm: the vault factory
packages/keeper/             @kite/keeper, the rebalancing bot: drift maths, 1Click client and quote
                             signatures, runOnce; scripts/attack.ts (live attack demo), scripts/routes.ts
contracts/                   Cargo workspace
  vault/                     the vault (near-sdk 5.30): plan, guardrails, signed-quote checks, settle and breaker, close
  factory/                   the vault factory: a DAO creates <name>.kitevaults.near by one vote; no keys, no upgrades
  mock-intents/              test double for intents.near (balances and transfers), sandbox tests only
  integration-tests/         runs the shipped wasm on a local NEAR sandbox with real keys and receipts;
                             res/ holds SputnikDAO v3.2, fetched from mainnet's DAO factory
scripts/                     setup.sh, integration.sh, deploy-factory.sh (mainnet deploy and lock, run with your keys)
```

| Task | Command (from the repo root) |
|---|---|
| Install | `npm ci` |
| All TypeScript tests | `npm test` |
| Contract unit tests | `npm run test:contracts` |
| Sandbox integration tests | `npm run test:integration` (needs Rust with `rustup target add wasm32-unknown-unknown` and `cargo-near` 0.22; downloads the NEAR sandbox, about 70 MB, once; runs on Linux and Apple-silicon macOS) |
| Type check, lint, build | `npm run typecheck && npm run lint && npm run build` |
| Web app | `npm run dev` |
| One check, dry | `npm run keeper -- --vault <name>.kitevaults.near --dry` |
| Live attack demo | `npm run attack -- --vault <name>.kitevaults.near` |
| Check routes | `npm run routes -w packages/keeper` (live 1Click routes for the five core assets) |
| Build the vault | `cd contracts && cargo near build non-reproducible-wasm --manifest-path vault/Cargo.toml --env "RUSTFLAGS=-C link-arg=-s --remap-path-prefix=$HOME/.cargo/registry=~/.cargo/registry --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$PWD=/src"` → copy `target/near/kite_vault/kite_vault.wasm` to `apps/web/public/vault/`. The remaps keep local paths out of the binary. With exactly Rust 1.97.0 and cargo-near 0.22.0 this rebuilds the shipped file byte for byte (sha256 `484f929b…`, checked on macOS arm64); the factory builds the same way from `factory/Cargo.toml` (sha256 `cb670574…`). Other toolchain versions give a different hash, and so does a Linux host. CI repeats this build on every push. |

### Environment (`apps/web/.env.local`, never committed)

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_KITE_AGENT_PK` | Public half of Kite's keeper key, added to each new vault |
| `KITE_AGENT_KEY` | Server only. Lets `/api/cron` send real rebalances. Leave it out to run dry. (`/api/vault/check` is always a dry run.) |
| `NEARAI_API_KEY` | Server only. Lets the relay reach NEAR AI Cloud for the private AI features. Hackathon credits come through NEAR Builders. Without it the AI features show "not configured" and everything else works. |
| `ONECLICK_JWT` | Optional 1Click partner key. On Kite's quotes (Intents balance to Intents balance) we measured the same fee with or without it: 0.20%, or 0.01% on stablecoin pairs, shown in each signed quote's `appFees`. The [docs](https://docs.near-intents.org/resources/fees.md) list 0.25% for calls without a key. |
| `NEXT_PUBLIC_NEAR_RPC`, `NEAR_RPC`, `INTENTS_CONTRACT`, `ONECLICK_URL` | Optional overrides with working defaults (FastNEAR RPC, `intents.near`, the 1Click API) |
| `KITE_VAULT`, `ATTACKER` | Keeper CLI only (`npm run keeper`, `npm run attack`) |
| `CRON_SECRET`, `KITE_VAULTS` | `CRON_SECRET` is required for `/api/cron` (it refuses all calls without it). `KITE_VAULTS` lists vaults the hourly run checks first. The run also covers every vault Kite's factory made that carries Kite's key. |

---

## Operating it

- **Vercel project settings:** Root Directory `apps/web`, with "Include source files outside of the Root Directory" turned on. Vercel sees the npm workspace and installs from the repo root, so the app can import `@kite/keeper`. `apps/web/vercel.json` holds the cron. The cron is `0 * * * *`: every hour, on the hour. A vault's own rules still pace its trades (by default at most 4 a day, at least 4 hours apart), and the keeper skips a trade the vault would refuse.
- **Production environment:** `NEXT_PUBLIC_KITE_AGENT_PK` (required to create a real vault: without it only the preview works), `KITE_AGENT_KEY`, `CRON_SECRET`, `KITE_VAULTS`, `NEARAI_API_KEY`. A paid `NEAR_RPC` and a `ONECLICK_JWT` are recommended. The full list is in the table above and in `apps/web/.env.example`.
- **Failures are loud:** `/api/cron` logs one JSON line per vault (`cron: vault` or `vault-failed`) and answers 500 if a vault listed in `KITE_VAULTS` failed. Each line carries the transaction hash.
- **Gas:** Kite's key pays its gas from the vault. The key may spend at most 0.25 NEAR, and only the vault's NEAR not locked for storage (about 0.20 at creation). Measured in the sandbox tests: a whole rebalance (rebalance plus settle) burns about 16 Tgas and costs **0.0017 NEAR**. Each call reserves about 0.05 NEAR up front while it runs, and NEAR returns the unused part to both the allowance and the balance a few blocks later. On mainnet a rebalance plus settle cost 0.0020 NEAR. So a new vault's spare NEAR covers roughly 75 to 100 rebalances. **Guardrails** shows the gas left. Under 0.05 NEAR the keeper refuses to trade and the hourly run fails loudly. To top up, send the vault NEAR and turn Kite's key off and on, which renews the allowance.
- **One keeper key, revocable per vault.** Each owner can remove Kite's key from their own vault in one click. Per-vault keys would be derived from one master secret the keeper holds anyway, so the vault's own limits are the real protection.
- **The AI relay is rate-limited twice:** a Vercel firewall rule allows 30 requests a minute per IP on `/api/nearai`, and the route keeps its own limit and only forwards Kite's two models, with capped output.
- **Next:** an external audit before larger amounts.

## What we found building on NEAR

Things we ran into while taking Kite to mainnet, what caused them, and what we did. Each one is reproducible; where it's someone else's to fix, we've reported it or say so here.

- **Wallets won't let an app deploy a contract to your account.** Meteor blocks any `DeployContract` sent from a dApp ("Contract deployment blocked"), which is how our first version created `kite.<you>`. We moved personal vaults to the locked factory: creating one is now an ordinary function call to `kitevaults.near`, and the vault is still owned by the caller from its first block. Older `kite.<you>` vaults still work.
- **NEAR refuses to return a joint promise.** A vault call that sent several 1Click transfers joined into one promise failed with "Returning joint promise is currently prohibited". The sandbox test `a_dao_invests_with_eight_swaps_in_one_vote` reproduces it; the fix, with no contract change, is one `allocate` call per swap in the same transaction or DAO proposal.
- **Trezu misreads a DAO's NEAR after a vault closes, and then blocks payouts.** Closing a vault returns its deposit by deleting the vault account with the DAO as beneficiary ([`GRoLMGD…`](https://nearblocks.io/txns/GRoLMGDxAL46PdzUGb4Dk4v7J5L5ZC2W9QTqMcrncDiT)). `view_account` showed 2.8475 NEAR; Trezu showed 0.1499 and refused to let the DAO approve a valid 2.75 NEAR payout. The DAO contract checks the real balance, so the same vote sent from Kite paid out ([`75kM8ZG…`](https://nearblocks.io/txns/75kM8ZG69RRCnQuXfBSXrkJr9RuZbrsGwuewDr3hJnzJ)). We are reporting it to the Trezu team. Kite's DAO page lists payment requests waiting on your DAOs with an Approve button for exactly this case.
- **Wallets reserve the whole gas allowance up front.** Approving a proposal with 300 Tgas asked Meteor to hold about 0.30 NEAR, more than a nearly empty account had, though the vote burns about 10 Tgas. Kite now asks for what each vote needs (50 Tgas for a NEAR payment).
- **Withdrawing leaves tokens where wallets can't see them.** A vault's holdings live in NEAR Intents, and withdrawing them there left our tester with BTC and ETH their wallet didn't show. Kite now brings money back the way it went in, as USDC in your wallet (or the DAO's account): each holding goes through a 1Click address that Kite checks with NEAR Intents first. Profile shows anything already sitting in your Intents account, with one button to convert it.
- **The vault refuses trades under $1, so small vaults can't rebalance.** That floor is deliberate (dust can't burn the daily trade limit), but with $3 and a 10% per-trade cap Kite could never trade, silently. Kite now says so wherever it matters: the Create rules, Add money, Guardrails and Home ("Trade too small"). The keeper sizes trades 2% above the floor and skips a quote under it rather than failing on-chain.
- **NearBlocks returns call arguments escaped several times over.** A signed quote inside `rebalance` comes back as `{\\\"amount\\\":…}`, so a plain `JSON.parse` dropped every trade from history. Kite unwraps it however deep it goes (`deepJson`).
- **Browsers slow timers in background tabs.** Home re-read the vault every 15 seconds, but a tab left in the background while signing in a wallet fell to about once a minute and looked frozen. Home now re-reads the moment the tab is visible again and says when Kite last traded.

## Credits and notes

Libraries: near-sdk, near-workspaces, near-api-js, NEAR Wallet Selector, `@nearai/inference-sdk`, Next.js, Tailwind, Radix, Remotion (explainer clips, `apps/film`). `contracts/integration-tests/res/sputnikdao2_v3_2.wasm` is SputnikDAO's own contract, fetched from mainnet for the sandbox tests. Data: 1Click, NearBlocks, Kraken, CoinGecko, Meta Pool, Lido, Morpho, Kamino. Sky footage from Mixkit. Closing-banner photo from Unsplash (photo id 1753114767610-75bc913c8423, hotlinked, not committed). Token logos from web3icons; company logos from Simple Icons.

Kite is not financial advice. Automated trading for others may be regulated where you live.

# Kite

[![CI](https://github.com/emmanuel39hanks/kite/actions/workflows/ci.yml/badge.svg)](https://github.com/emmanuel39hanks/kite/actions/workflows/ci.yml)

**A self-custodied autopilot for your savings, on NEAR.** You pick a mix of up to eight from 22 assets: Bitcoin, Ethereum, Solana, NEAR, XRP, Dogecoin, Chainlink, Zcash and more, plus gold and digital dollars. Your money sits in **your own vault contract**. Kite keeps the mix on target by rebalancing through **NEAR Intents** when a holding drifts too far. Idle parts can earn a yield. A private model on **NEAR AI Cloud** can draft a plan, review it, and turn plain words into rules, and it never touches your money.

**The one idea:** Kite's robot holds a key that can only ask your vault to rebalance, and the vault only accepts a trade that carries a **quote signed by NEAR Intents**, checked on-chain. So even a stolen key can't send your money anywhere else.

- **Live:** https://www.usekite.xyz · no wallet needed: https://www.usekite.xyz/console?preview=1
- **Tracks:** `defi` (main), `security`, `privacy`. MIT licensed (`LICENSE`).
- **Built during the hackathon window:** all code in this repository was written from Nov 2, 2026 onward, during the hackathon. Nothing is carried over from earlier work. The git history begins on Nov 3 because that is when the project was first committed.

---

## Verify it in five minutes

Each row: do this, see that.

| Do this | You should see |
|---|---|
| `npm ci` | Installs the web app and the keeper in one go (npm workspaces). Run this once from a fresh clone. |
| `npm run test:contracts` | **92 vault tests pass**, including **42 attack tests** a thief with the robot's key might try and one that checks a **real** 1Click signature with the code that runs on chain, plus **17 factory tests** |
| `npm run test:integration` | **8 sandbox tests pass** on a local NEAR node, using the shipped wasm above with real keys and receipts: Kite's key can't withdraw, call `intents` directly or change limits (NEAR refuses it); the vault has no full-access key, so its code can't change; its code hash equals the sha256 of the file; a full rebalance and settle run end to end; a failed transfer leaves nothing pending; a signed quote that pays someone else is refused; and a **real SputnikDAO** (the exact v3.2 code mainnet's DAO factory deploys) takes over a vault by vote, locks out its creator, changes its guardrails, pauses it, and rotates Kite's key in a two-call vote. Two more run the **vault factory**: a real SputnikDAO creates its own vault by one vote (owned by the DAO from the first block, running the shipped code, with only Kite's limited key), Kite rebalances and settles it, and both a taken name and a creation that fails inside the vault end the proposal as **Failed** with the DAO's NEAR returned. One more has a DAO invest by vote with eight swaps, and shows why each swap is its own `allocate` call (below). It also checks a fresh vault keeps at least 0.1 NEAR for gas after paying for its storage. Prints the gas a rebalance really costs. |
| `npm test` | **43 tests pass**: 10 in the keeper (drift maths, the real 1Click signature, reading the vault's answer to each call, and the gas check), 33 in the web app (the checks on model output (Unicode-safe number guard, clamped rules, template fallbacks), the pre-signing check on swap addresses (every field on its own), and the preview engine's rebalance rule) |
| `npm run dev`, open http://localhost:3000/console?preview=1 | The full app with a simulated vault, live prices and **real 1Click quotes** (`dry: true`). No wallet, nothing signed. Walkthrough below. |
| `npm run attack -- --vault <name>.kitevaults.near` | Real 1Click quotes that pay the attacker, refund the attacker, are edited, dry or off-plan are sent to the vault's free `check_quote` view. **Every one is refused.** (Needs a created vault.) |
| `npm run typecheck && npm run lint && npm run build` | Clean type check, no lint warnings, production build |
| `shasum -a 256 apps/web/public/vault/kite_vault.wasm` | Starts with `484f929b00925266…`, the contract the app deploys (238,810 bytes). A vault's on-chain code hash is this sha256 in base58, so you can check any deployed vault against this file. |

**What you need:** Node 20.9 or newer (we use 26) and npm. Rust stable for the contract tests (`cargo test` needs no wasm target); to rebuild the wasm also `rustup target add wasm32-unknown-unknown` and `cargo-near`. The preview and every command above need **no environment variables and no funds**. The public "check now" route is always a dry run; real rebalances come from the daily cron (needs `CRON_SECRET` and `KITE_AGENT_KEY`) or the keeper CLI. The private AI features need a `NEARAI_API_KEY` (see below). Creating a real vault needs mainnet NEAR and Kite's keeper key, so the preview is the judge path.

**What is proven and what is not, plainly:**

| | Status |
|---|---|
| Contract: plan, guardrails, signed-quote checks, settle and breaker, close | Built. 92 unit tests and 8 sandbox tests pass. |
| Keeper and web app | Built and deployed at usekite.xyz. |
| Preview mode with real quotes | Works. Simulated vault, real prices and quotes. |
| **First end-to-end run on NEAR mainnet with real funds** | **Not done yet.** Transaction links will go in this README once it is. |
| Vault factory (DAO creates its own vault) | Built and tested against the real SputnikDAO v3.2 in the sandbox (17 unit tests, 2 sandbox tests), reviewed by two separate AI auditors (findings fixed). **Live and locked on mainnet** at [`kitevaults.near`](https://nearblocks.io/address/kitevaults.near): deployed in [`4WX2i7p…`](https://nearblocks.io/txns/4WX2i7p4oAx86AmkrEX5QNX8xJ89nY2y2MqWYgsFn4hJ), its only key deleted in [`JrAZuKD…`](https://nearblocks.io/txns/JrAZuKDyaTppVTjjG3eVBCUJw1yFmPDS6g9MfGASTAm), so it has no access keys. Its code hash on chain equals the sha256 of `kite_factory.wasm` (`cb670574…`), and `get_config` reports the vault hash of `kite_vault.wasm` (`484f929b…`). The DAO view re-checks both before anyone proposes. |
| Private AI features (NEAR AI Cloud) | Work in a browser. The model, the number checks and the clamps were tested against the live API. The in-browser encrypted path is the part to try yourself. |
| Chain Signatures | **Not used.** See [What NEAR does here](#what-near-does-here). |

---

## Try the preview (no wallet, no funds)

NEAR Intents has no testnet, so Kite has a **preview mode**: live prices, **real 1Click quotes requested with `dry: true`**, a vault simulated in your browser, nothing signed or sent.

1. Open https://www.usekite.xyz/console?preview=1 (or run locally as above).
2. **Explore** → **Steady** or **Bitcoin Plus** → **Start this plan** → **Create vault (preview)**. The panel lists exactly what the real signature grants.
3. **Add money:** **Bitcoin** → **Get a real quote** shows a live 1Click quote (BTC in, USDC out, cost and time). Or **USDC in my NEAR wallet** → `1000` → **Send**. The preview wallet starts with 1,000 USDC and 5 NEAR.
4. **Invest:** **Invest at today's real quotes** prices each slice with a dry 1Click quote. Or pick **1 year ago**, which replays Kite's daily check on real daily closes with your guardrails. **Activity** lists every rebalance and the drift that triggered it.
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
| Daily check | `/api/cron` (Vercel Cron, needs `CRON_SECRET`, needs `KITE_AGENT_KEY` to send real transactions; checks the vaults in `KITE_VAULTS` first, then every factory vault that carries Kite's key) or the keeper CLI runs `runOnce`: reads balances and drift, gets a 1Click quote, checks it locally, calls `vault.rebalance(quote, signature, prices)` with the keeper key, waits up to two minutes for the swap to land, then calls `vault.settle()`. One daily run is therefore a whole rebalance; if the swap is slow, the next run settles it. **Check now** in the app is always a dry run that shows what Kite would do. |
| Guardrails | Owner calls `set_limits`, `revoke_agent`, `set_agent`, `pause`, `unpause`, `set_quote_signer`. Each needs 1 yocto attached, so only your full-access key can call them. |
| Leave | `withdraw` each balance to your Intents account, then `close_vault`. It refuses while anything is left, then deletes the account and returns its NEAR to you. |

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

- **NEAR Intents:** holds every asset as NEP-245 balances owned by your vault account (nBTC, ETH, SOL, NEAR, XRP, DOGE, ADA, TRX, LINK, LTC, SUI, ZEC, BCH, AAVE, UNI, USDC, USDT, Tether Gold, plus the earning versions stNEAR, wstETH, gtUSDCp, kV-gtSOLb). Each was checked with a $50 round-trip 1Click quote before it was listed (0.06% for USDT, 0.5 to 0.8% for the rest). A plan holds at most eight, because the vault funds a plan in one call of at most eight swaps. BNB, AVAX and XLM are routable too but travel over a different bridge (HOT Omni) that hasn't been tested with the vault, so they're left out. The 1Click API handles deposits from other chains and every swap. **Its signed quotes are verified on-chain by the vault** (`env::ed25519_verify`).
- **NEAR AI Cloud:** the private AI features below, end-to-end encrypted to attested model hardware.
- **Function-call access keys:** limit Kite's keeper to two methods at the protocol level.
- **Auth by predecessor** (default in `intents.near`): the vault contract moves its own Intents balances with no keys registered there. Custody stays with a contract only you control.
- **Account model:** one readable, deletable account per vault (`<name>.kitevaults.near`), owned by your wallet, whose storage deposit is refunded on close.
- **Chain Signatures: not used.** The DeFi track lists it as an optional "lean on". We left it out on purpose: any path where the vault signs foreign-chain transactions would let funds leave outside a signed 1Click quote, which is the property Kite is built around.

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
- **Contract tests:** `cargo test --manifest-path contracts/Cargo.toml -p kite-vault attack_` runs the 42 attack tests (92 vault tests in total). Each new check was also confirmed by deleting it from the code and watching a named test fail.
- **Against a live vault, free:** `npm run attack -- --vault <name>.kitevaults.near`.
- **As real transactions:** add `--send` with the agent key. Each refusal gets a transaction hash. Add `--out file.md` to save the transcript.

**Threat model:** a fully compromised keeper still can't move money anywhere except a 1Click swap that pays your vault. It can still make trades you didn't need, inside your guardrails and rate limits. The worst case is swap costs, and it has a number: each trade can lose at most your price limit (default 1%) of the amount traded (default at most 10% of the portfolio), but the vault checks two things, the quote's output value and its guaranteed minimum, so a fill at the minimum can cost close to twice that. At the defaults that is up to about 0.2% of the portfolio per trade and at most 4 trades a day, so **up to about 0.8% a day**, until you revoke Kite's key or pause the vault. We chose not to add a separate daily loss cap: this bound already follows from the limits you set, and tightening those (band, trade size, price limit, trades a day) tightens it. A simulated thief with a lying third price could not loop trades indefinitely: the no-overshoot rule stops it after a few.

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
| Gas sized for callbacks | Static gas per callback. Measured in the sandbox: rebalance 10.6 Tgas, settle 5.7 Tgas, against 200 and 150 attached. |
| Contract keeps enough liquid balance | 2.6 NEAR covers storage for about 233 KB, with about 0.24 left for gas. The keeper refuses to trade under 0.05 NEAR. |
| Reproducible artifacts and a verified code hash | The build command strips local paths. The sandbox test asserts that the code hash equals the sha256 of the shipped file. Not done: a Docker reproducible build (`cargo near build reproducible-wasm`) and SourceScan verification. |
| Monitoring and a response plan | Vault events (listed below), a cron that fails loudly, a breaker, and the response plan below |
| Upgrade path | None by design. There is no full-access key and no upgrade method; to change code you close the vault and create a new one. |

**If something goes wrong:**

| Situation | Who acts | What to do |
|---|---|---|
| Kite's key may be leaked | Operator | Make a new key pair and set `KITE_AGENT_KEY` and `NEXT_PUBLIC_KITE_AGENT_PK`. Each owner turns Kite's key off and on in **Guardrails** to install the new one. Until then, owners can revoke it. |
| A swap went missing | Nobody needs to act | After the settle window (30 minutes) `settle` trips the breaker and pauses the vault. The owner reviews, then unpauses. |
| The daily run fails | Operator | `/api/cron` answers 500 and logs one JSON line per vault (`cron: vault-failed`). It also fails when Kite's gas is under 0.05 NEAR: send the vault NEAR and renew the key. |
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
- **Verifiable treasury policy (NEAR AI).** In the DAO view, **Propose a verified policy** turns the guardrails on the sliders into a DAO proposal whose reasoning anyone can check. Code computes every number: the plan's statistics from real price history, the worst case a stolen key could cost under these limits, and the exact `set_limits` / `set_plan` call. NEAR AI's attested model writes the rationale with no numbers of its own. The model's TEE signs `model:sha256(request):sha256(response)`; Kite packs the request, the answer and the signature into the proposal's last line, and puts `policy_ref = sha256(that bundle)` into the vault call itself.
- **Any voter can check it at [/verify](https://www.usekite.xyz/verify)** with the DAO and proposal number, in their own browser: the signature (NEAR AI's SDK), that the signed hashes match the kept bytes, that the signing key is in NEAR AI's current TEE report (Intel TDX and NVIDIA evidence, checked today), that the description wasn't edited, that the proposal calls exactly what was analysed plus that `policy_ref`, and the worst-case figure recomputed from the calls. Anything it can't check shows grey, never green. After the vote, the vault's own log carries the same `policy_ref`.
- **How the model writes without writing numbers.** It cites figures by placeholder (`{band}`, `{worst_day}`, `{mix}`, …) and Kite's code fills them in, so the prose reads naturally while every figure comes from code. A section with an unknown placeholder, a number of its own (digits, number words, fractions) or an echoed title is refused, and Kite retries up to three times before falling back to a fixed template. The policy model is `z-ai/glm-5.3` (attested, about a cent a proposal); the quicker `z-ai/glm-5.3-flash` does everything else.
- **Tested live,** through Kite's relay against NEAR AI: three policies for a DAO asking to "keep at least half in stablecoins", each written by the model on its first try, each **Verified** on every check (signature, hashes, TEE report with Intel TDX and NVIDIA evidence, Kite's own prompt, unedited text, vault owner, calls, `policy_ref`, worst case). Changing one letter of an answer fails the check. The security review's forgeries (a self-signed key, a prompt someone else wrote, a relabelled mix, another owner's vault, a call with a deposit) each fail a named test.

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
apps/web/                    Next.js 16 app: landing page, console, API routes, the daily cron
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
| Sandbox integration tests | `npm run test:integration` (needs `cargo-near`; downloads the NEAR sandbox once) |
| Type check, lint, build | `npm run typecheck && npm run lint && npm run build` |
| Web app | `npm run dev` |
| One check, dry | `npm run keeper -- --vault <name>.kitevaults.near --dry` |
| Live attack demo | `npm run attack -- --vault <name>.kitevaults.near` |
| Check routes | `npm run routes -w packages/keeper` (live 1Click routes for every asset) |
| Build the vault | `cd contracts && cargo near build non-reproducible-wasm --manifest-path vault/Cargo.toml --env "RUSTFLAGS=-C link-arg=-s --remap-path-prefix=$HOME/.cargo/registry=/cargo/registry --remap-path-prefix=$HOME/.rustup=/rustup --remap-path-prefix=$PWD=/src"` → copy `target/near/kite_vault/kite_vault.wasm` to `apps/web/public/vault/`. The remaps keep local paths out of the binary. The hash depends on your toolchain, so compare against ours only with the same versions (we used Rust 1.97.0 and cargo-near 0.22.0). |

### Environment (`apps/web/.env.local`, never committed)

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_KITE_AGENT_PK` | Public half of Kite's keeper key, added to each new vault |
| `KITE_AGENT_KEY` | Server only. Lets `/api/vault/check` and `/api/cron` send real rebalances. Leave it out to run dry. |
| `NEARAI_API_KEY` | Server only. Lets the relay reach NEAR AI Cloud for the private AI features. Hackathon credits come through NEAR Builders. Without it the AI features show "not configured" and everything else works. |
| `ONECLICK_JWT` | Optional 1Click partner key. On Kite's quotes (Intents balance to Intents balance) we measured the same fee with or without it: 0.20%, or 0.01% on stablecoin pairs, shown in each signed quote's `appFees`. The [docs](https://docs.near-intents.org/resources/fees.md) list 0.25% for calls without a key. |
| `NEXT_PUBLIC_NEAR_RPC`, `NEAR_RPC`, `INTENTS_CONTRACT`, `ONECLICK_URL` | Optional overrides with working defaults (FastNEAR RPC, `intents.near`, the 1Click API) |
| `KITE_VAULT`, `ATTACKER` | Keeper CLI only (`npm run keeper`, `npm run attack`) |
| `CRON_SECRET`, `KITE_VAULTS` | `CRON_SECRET` is required for `/api/cron` (it refuses all calls without it). `KITE_VAULTS` lists the vaults the server may send real transactions for. |

---

## Operating it

- **Vercel project settings:** Root Directory `apps/web`, with "Include source files outside of the Root Directory" turned on. Vercel sees the npm workspace and installs from the repo root, so the app can import `@kite/keeper`. `apps/web/vercel.json` holds the cron. The cron is `0 0 * * *` (daily, which fits the Hobby plan; timing can drift by up to an hour).
- **Production environment:** `NEXT_PUBLIC_KITE_AGENT_PK` (required to create a real vault: without it only the preview works), `KITE_AGENT_KEY`, `CRON_SECRET`, `KITE_VAULTS`, `NEARAI_API_KEY`. A paid `NEAR_RPC` and a `ONECLICK_JWT` are recommended. The full list is in the table above and in `web/.env.example`.
- **Failures are loud:** `/api/cron` logs one JSON line per vault (`cron: vault` or `vault-failed`) and answers 500 if any vault failed.
- **Before real money:** run one small vault end to end on mainnet and record the transactions here; generate a dedicated keeper key; get an external audit.

## Credits and notes

Libraries: near-sdk, near-api-js, NEAR Wallet Selector, `@nearai/inference-sdk`, Next.js, Tailwind, Radix. Sky footage from Mixkit. Closing-banner photo from Unsplash (photo id 1753114767610-75bc913c8423, hotlinked, not committed). Token logos from web3icons; company logos from Simple Icons.

Kite is not financial advice. Tokenized stocks, when they arrive, are not available to US persons. Automated trading for others may be regulated where you live.

# Kite

**A self-custodied autopilot for your savings, on NEAR.** You pick a mix: Bitcoin, Ethereum, Solana, NEAR, gold, digital dollars. Your money sits in **your own vault contract**. Kite keeps the mix on target by rebalancing through **NEAR Intents** when a holding drifts too far. Idle parts can earn a yield. A private model on **NEAR AI Cloud** can draft a plan, review it, and turn plain words into rules, and it never touches your money.

**The one idea:** Kite's robot holds a key that can only ask your vault to rebalance, and the vault only accepts a trade that carries a **quote signed by NEAR Intents**, checked on-chain. So even a stolen key can't send your money anywhere else.

- **Live:** https://www.usekite.xyz · no wallet needed: https://www.usekite.xyz/console?preview=1
- **Tracks:** `defi` (main), `security`, `privacy`. MIT licensed (`LICENSE`).
- **Built during the hackathon window:** all code in this repository was written from Nov 2, 2026 onward, during the hackathon. Nothing is carried over from earlier work. The git history begins on Nov 3 because that is when the project was first committed.

---

## Verify it in five minutes

Each row: do this, see that.

| Do this | You should see |
|---|---|
| `cd contracts/vault && cargo test` | **60 tests pass**, including **31 attack tests** a thief with the robot's key might try, and one test that checks a **real** 1Click signature with the code that runs on chain |
| `cd worker && npm install && npm test` | **8 tests pass** (drift maths and the real 1Click signature) |
| `cd web && npm install && npm test` | **27 tests pass**: the checks on model output (Unicode-safe number guard, clamped rules, template fallbacks), the pre-signing check on swap addresses, and the preview engine's rebalance rule |
| `cd web && npm install && npm run dev`, open http://localhost:3000/console?preview=1 | The full app with a simulated vault, live prices and **real 1Click quotes** (`dry: true`). No wallet, nothing signed. Walkthrough below. |
| `cd worker && npm run attack -- --vault kite.<owner>.near` | Real 1Click quotes that pay the attacker, refund the attacker, are edited, dry or off-plan are sent to the vault's free `check_quote` view. **Every one is refused.** (Needs a created vault.) |
| `cd web && npm run typecheck && npx eslint src && npm run build` | Clean type check, no lint warnings, production build |
| `shasum -a 256 web/public/vault/kite_vault.wasm` | Starts with `3709d2c52360334f…`, the contract the app deploys (230,112 bytes) |

**What you need:** Node 20.9 or newer (we use 26) and npm. Rust stable for the contract tests; `cargo-near` only if you want to rebuild the wasm. The preview and every command above need **no environment variables and no funds**. The public "check now" route is always a dry run; real rebalances come from the daily cron (needs `CRON_SECRET` and `KITE_AGENT_KEY`) or the worker CLI. The private AI features need a `NEARAI_API_KEY` (see below). Creating a real vault needs mainnet NEAR and Kite's worker key, so the preview is the judge path.

**What is proven and what is not, plainly:**

| | Status |
|---|---|
| Contract: plan, guardrails, signed-quote checks, settle and breaker, close | Built. 60 tests pass. Independently reviewed for security (findings fixed, see below). |
| Worker and web app | Built and deployed at usekite.xyz. |
| Preview mode with real quotes | Works. Simulated vault, real prices and quotes. |
| **First end-to-end run on NEAR mainnet with real funds** | **Not done yet.** Transaction links will go in this README once it is. |
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
| Every swap amount: 1Click `/v0/quote` with `dry: true` (`web/src/app/api/preview/quote`) | The wallet: 1,000 USDC and 5 NEAR |
| Daily price history: Kraken, CoinGecko as fallback | Back-dated swap cost: a flat 0.3%, about what live quotes show |
| Yields: Meta Pool, Lido, Morpho, Kamino APIs | |
| The rebalance rule: `web/src/lib/preview/engine.ts` mirrors `worker/src/drift.ts` and the contract | |

---

## How it works on mainnet

Connect a NEAR wallet (HOT, Meteor, Intear, Sender, Nightly or OKX).

| Step | What happens on chain |
|---|---|
| Create your vault | One transaction from your account to `kite.<you>`: `CreateAccount`, `Transfer 2.6 NEAR` (storage, refunded on close), `DeployContract` (this repo's vault), `new(owner, plan, limits)`, `AddKey`. The key is Kite's worker key: `FunctionCall` only, receiver = your vault, methods `rebalance, settle`, 0.25 NEAR allowance. One vault per account. |
| Add money | Send USDC from your NEAR wallet (`ft_transfer_call` to `intents.near`, `msg = vault`). Or `/api/deposit/quote` gets a 1Click deposit address on Base, Arbitrum, Ethereum, Bitcoin or Solana, and what you send lands in your vault as USDC inside `intents.near`. |
| Invest | You sign `vault.allocate(transfers)`: slices of USDC go to 1Click deposit addresses that swap into each plan asset and pay **back to the vault**. |
| Daily check | `/api/cron` (Vercel Cron, needs `CRON_SECRET`, sends real transactions only for vaults in `KITE_VAULTS`) or the worker CLI runs `worker.runOnce`: reads balances and drift, gets a 1Click quote, checks it locally, calls `vault.rebalance(quote, signature, prices)` with the worker key, and later `vault.settle()`. **Check now** in the app is always a dry run that shows what Kite would do. |
| Guardrails | Owner calls `set_limits`, `revoke_agent`, `set_agent`, `pause`, `unpause`, `set_quote_signer`. Each needs 1 yocto attached, so only your full-access key can call them. |
| Leave | `withdraw` each balance to your Intents account, then `close_vault`. It refuses while anything is left, then deletes the account and returns its NEAR to you. |

### Where your money is at every step

While a rebalance is in flight, **Home** shows a card driven by the vault's pending swap and 1Click's status API (`/v0/status`, no key needed). Three steps: **left your vault → being swapped → back in your vault**, with a plain line on where the money is, and links to the vault transfer, the delivery transaction and the NEAR Intents explorer.

- `SUCCESS`: delivered.
- `REFUNDED`: says the swap did not complete and the money was returned to the vault, with the amount and the reason 1Click gave.
- `FAILED`: says failed, shows a reference, and **never claims delivery or safety**; where the money is must be checked against the vault balance.
- `INCOMPLETE_DEPOSIT`: less arrived than the quote needed; a refund follows.

Code: `web/src/components/console/swap-tracker.tsx`, `web/src/lib/near/swap-status.ts`.

### History, including what the robot did while you were away

**Activity** lists your own actions and also Kite's `rebalance` and `settle` calls **read from the chain** (NearBlocks, via `/api/vault/history`), so trades made while your browser was closed show up with transaction links.

---

## What NEAR does here

- **NEAR Intents:** holds every asset as NEP-245 balances owned by your vault account (nBTC, ETH, SOL, NEAR, USDC, Tether Gold, plus the earning versions stNEAR, wstETH, gtUSDCp, kV-gtSOLb). The 1Click API handles deposits from other chains and every swap. **Its signed quotes are verified on-chain by the vault** (`env::ed25519_verify`).
- **NEAR AI Cloud:** the private AI features below, end-to-end encrypted to attested model hardware.
- **Function-call access keys:** limit Kite's worker to two methods at the protocol level.
- **Auth by predecessor** (default in `intents.near`): the vault contract moves its own Intents balances with no keys registered there. Custody stays with a contract only you control.
- **Account model:** one readable, deletable sub-account per user (`kite.<you>`), whose storage deposit is refunded on close.
- **Chain Signatures: not used.** The DeFi track lists it as an optional "lean on". We left it out on purpose: any path where the vault signs foreign-chain transactions would let funds leave outside a signed 1Click quote, which is the property Kite is built around.

---

## How the vault protects you

Code: `contracts/vault/src/lib.rs`. Every refusal has a named error in `contracts/vault/src/errors.rs`.

**Kite's worker never decides where money goes.** Every `rebalance` must carry a quote **signed by NEAR Intents 1Click**, and the vault verifies it on-chain:
- **Signature:** ed25519 over `base58(sha256(quote json))`, against 1Click's published key `reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`. The owner can rotate it with `set_quote_signer`.
- **Terms:** what is sold and bought, the amounts, the deposit address, the minimum out and the USD values all come from the signed quote, not from the worker.
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
| Keep trading after a swap goes missing | `settle` trips a breaker after the settle window, pausing the vault | `ERR_PAUSED` |

**Run the attacks yourself:**
- **Contract tests:** `cd contracts/vault && cargo test attack_` runs the 31 attack tests (60 tests in total).
- **Against a live vault, free:** `cd worker && npm run attack -- --vault kite.<owner>.near`.
- **As real transactions:** add `--send` with the agent key. Each refusal gets a transaction hash. Add `--out file.md` to save the transcript.

**Threat model:** a fully compromised worker still can't move money anywhere except a 1Click swap that pays your vault. It can still make trades you didn't need, inside your guardrails and rate limits. The worst case is swap costs, and it has a number: each trade can lose at most your price limit (default 1%) of the amount traded (default at most 10% of the portfolio), so about 0.1% of the portfolio per trade and at most 4 trades a day at the defaults, about 0.4% a day, until you revoke Kite's key or pause the vault.

**Defaults:** a holding must drift 5 points before Kite acts, one trade moves at most 10% of the portfolio, a swap may cost at most 1% fees included, at most 4 trades a day (the four-hour gap between trades allows at most 6), and a swap that hasn't landed after 30 minutes pauses the vault. You can change all of these.

**Gaps we found and closed:** (1) the first version took the deposit address and reference prices from the worker; verifying 1Click's signature on-chain closed it. (2) Independent review found the vault ignored referral and redirect fields in the signed quote; they are now refused. (3) A zero gas allowance used to mean unlimited, and `rebalance` accepted any key on the vault account; both are fixed. (4) Trades under $1 are refused, so dust can't burn the daily trade count.

**The first gap in detail:** the first version took the deposit address and reference prices from the worker. Writing the attack suite showed a stolen key could have pointed one trade at itself. Verifying 1Click's signature on-chain closed it.

---

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
- **Worth knowing:** switching in and back out costs about 1–2%, so earning pays off over months. gtUSDCp is a wrapper token whose deployer we couldn't verify.

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

**How the private call works** (`web/src/lib/ai/private-ai.ts`, `@nearai/inference-sdk` in the browser):
1. The browser verifies NEAR AI's attestation for the model.
2. It encrypts your message to the attested model key (X25519 + XChaCha20-Poly1305).
3. Kite's server relays the encrypted bytes (`web/src/app/api/nearai/v1/[...path]`), adds the API key, allows only Kite's model and the endpoints the SDK needs, and rate-limits visitors.
4. The browser checks the signature on the reply. The panel says which kind it was: **signed by the model's hardware** (`provider_tee`), or only **by NEAR AI's gateway**, a weaker guarantee that it shows as such.

**What we do not claim:** that nothing can ever read your words (this holds as far as you trust the open-source code this page runs), that a signature proves the model's text is *true* (it proves who produced it, so the facts and numbers are checked in code instead), or that signatures stay re-checkable forever (NEAR AI doesn't document how long, so we save the id on your device and say "re-checkable while NEAR AI retains it").

**Model:** `z-ai/glm-5.3-flash`, with reasoning turned off (it cut a draft from about 14 s to about 5 s). A draft costs a fraction of a cent and usually takes 10–15 s end to end in a browser.

---

## Repository

```
contracts/vault/   Rust vault (near-sdk 5.30): plan, guardrails, signed-quote checks, settle/breaker, close
worker/            Node worker: drift maths, 1Click client + quote signatures, runOnce, attack script
web/               Next.js 16 app
  src/app/           pages and API routes
  src/components/   landing/ (marketing page), console/ (product UI), shared logo and charts
  src/lib/           ai/ (private AI features and the checks on their output), market/ (prices, history, yields),
                     near/ (wallet, vault calls, swap status), preview/ (no-wallet engine),
                     server/ (route guards, 1Click client), shared assets, plans, mix, store
```

| Task | Command |
|---|---|
| Contract tests | `cd contracts/vault && cargo test` |
| Build the vault | `cd contracts/vault && cargo near build non-reproducible-wasm` → copy to `web/public/vault/kite_vault.wasm` |
| Worker tests | `cd worker && npm test` |
| Check routes | `cd worker && npm run routes` (live 1Click routes for every asset) |
| One check, dry | `cd worker && npm run worker -- --vault kite.<you>.near --dry` |
| Web app | `cd web && npm run dev` · `npm test` · `npm run typecheck` · `npx eslint src` · `npm run build` |

### Environment (`web/.env.local`, never committed)

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_KITE_AGENT_PK` | Public half of Kite's worker key, added to each new vault |
| `KITE_AGENT_KEY` | Server only. Lets `/api/vault/check` and `/api/cron` send real rebalances. Leave it out to run dry. |
| `NEARAI_API_KEY` | Server only. Lets the relay reach NEAR AI Cloud for the private AI features. Hackathon credits come through NEAR Builders. Without it the AI features show "not configured" and everything else works. |
| `ONECLICK_JWT` | Optional 1Click partner key, which avoids the 0.2% no-key fee |
| `NEXT_PUBLIC_NEAR_RPC`, `NEAR_RPC`, `INTENTS_CONTRACT`, `ONECLICK_URL` | Optional overrides with working defaults (FastNEAR RPC, `intents.near`, the 1Click API) |
| `KITE_VAULT`, `ATTACKER` | Worker CLI only (`npm run worker`, `npm run attack`) |
| `CRON_SECRET`, `KITE_VAULTS` | `CRON_SECRET` is required for `/api/cron` (it refuses all calls without it). `KITE_VAULTS` lists the vaults the server may send real transactions for. |

---

## Credits and notes

Libraries: near-sdk, near-api-js, NEAR Wallet Selector, `@nearai/inference-sdk`, Next.js, Tailwind, Radix. Sky footage from Mixkit. Closing-banner photo from Unsplash. Token logos from web3icons; company logos from Simple Icons.

Kite is not financial advice. Tokenized stocks, when they arrive, are not available to US persons. Automated trading for others may be regulated where you live.

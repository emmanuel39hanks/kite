# Kite attack demo

Vault: emmanuelhaanks-3.kitevaults.near · 2026-11-10T12:34:48.345Z · mode: views + real transactions
The attacker controls Kite's keeper: its key (rebalance/settle only) and everything it sends to the vault.
Rows Q0–Q6 are free view calls with no key. Rows K1–K6 are signed with Kite's real keeper key.

## 1. Redirecting money with real, 1Click-signed quotes

The honest quote (4.999327840000 USD, pays and refunds the vault) verifies against 1Click's key locally: true

✓ accepted  Q0  Control: the honest quote, untouched
    → ACCEPTED

✓ refused  Q1  Genuine 1Click quote that pays out to attacker.near
    → ERR_QUOTE_RECIPIENT
✓ refused  Q2  Genuine quote whose refund goes to attacker.near (then make the swap fail)
    → ERR_QUOTE_REFUND
✓ refused  Q3  Honest quote, edited to move 1000× more
    → ERR_QUOTE_SIG
✓ refused  Q4  Honest quote, signed by the attacker's own key
    → ERR_QUOTE_SIG
✓ refused  Q5  Dry quote (no deposit address) passed off as real
    → ERR_QUOTE_TERMS
✓ refused  Q6  Genuine quote into an asset outside the plan (nep141:wrap.near)
    → ERR_NOT_IN_PLAN

## 2. Real transactions signed with Kite's key

✓ refused  K1  Call vault.withdraw(…, attacker.near)
    → MethodNameMismatch  (refused before inclusion: no transaction)
✓ refused  K2  Call intents.near mt_transfer to attacker.near directly
    → ReceiverMismatch  (refused before inclusion: no transaction)
✓ refused  K3  Attach a deposit to rebalance
    → DepositWithFunctionCall  (refused before inclusion: no transaction)
✓ refused  K4  Call set_limits to loosen the guardrails
    → MethodNameMismatch  (refused before inclusion: no transaction)
✓ refused  K5  rebalance with the quote that pays attacker.near
    → ERR_QUOTE_RECIPIENT  (tx 4pgbMERzq5B3eFQNVmPjmHFutAHMXSCkSmp1KZfwhMvS)
✓ refused  K6  rebalance with an edited quote
    → ERR_QUOTE_SIG  (tx CeDVVf3mxbsetpGV8XZ3oK87GSBL8GXhKBmq7icttcC9)

## Result

| # | Attack | Stopped by | Refusal | On chain |
|---|---|---|---|---|
| Q0 | Control: the honest quote, untouched | – | accepted ✓ (as it should be) | view call |
| Q1 | Genuine 1Click quote that pays out to attacker.near | contract | `ERR_QUOTE_RECIPIENT` ✓ | view call |
| Q2 | Genuine quote whose refund goes to attacker.near (then make the swap fail) | contract | `ERR_QUOTE_REFUND` ✓ | view call |
| Q3 | Honest quote, edited to move 1000× more | contract | `ERR_QUOTE_SIG` ✓ | view call |
| Q4 | Honest quote, signed by the attacker's own key | contract | `ERR_QUOTE_SIG` ✓ | view call |
| Q5 | Dry quote (no deposit address) passed off as real | contract | `ERR_QUOTE_TERMS` ✓ | view call |
| Q6 | Genuine quote into an asset outside the plan (nep141:wrap.near) | contract | `ERR_NOT_IN_PLAN` ✓ | view call |
| K1 | Call vault.withdraw(…, attacker.near) | protocol (access key) | `MethodNameMismatch` ✓ | refused before inclusion: no transaction |
| K2 | Call intents.near mt_transfer to attacker.near directly | protocol (access key) | `ReceiverMismatch` ✓ | refused before inclusion: no transaction |
| K3 | Attach a deposit to rebalance | protocol (access key) | `DepositWithFunctionCall` ✓ | refused before inclusion: no transaction |
| K4 | Call set_limits to loosen the guardrails | protocol (access key) | `MethodNameMismatch` ✓ | refused before inclusion: no transaction |
| K5 | rebalance with the quote that pays attacker.near | contract | `ERR_QUOTE_RECIPIENT` ✓ | [4pgbMERz…](https://nearblocks.io/txns/4pgbMERzq5B3eFQNVmPjmHFutAHMXSCkSmp1KZfwhMvS) `4pgbMERzq5B3eFQNVmPjmHFutAHMXSCkSmp1KZfwhMvS` |
| K6 | rebalance with an edited quote | contract | `ERR_QUOTE_SIG` ✓ | [CeDVVf3m…](https://nearblocks.io/txns/CeDVVf3mxbsetpGV8XZ3oK87GSBL8GXhKBmq7icttcC9) `CeDVVf3mxbsetpGV8XZ3oK87GSBL8GXhKBmq7icttcC9` |

12 of 12 refused: 8 by the vault's own checks, 4 by NEAR before they could run (the key may only call rebalance or settle, only on this vault, with no deposit). Nothing left the vault.

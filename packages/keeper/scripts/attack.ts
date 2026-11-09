/**
 * Attack demo: someone who has stolen Kite's keeper key tries to steal from a live vault.
 *
 *   npm run attack -- --vault <name>.kitevaults.near            # no key, no funds, no transactions
 *   npm run attack -- --vault <name>.kitevaults.near --send     # also sends real transactions with the keeper key (KITE_AGENT_KEY)
 *   add --out ../../docs/attack-log.md to save the transcript (the path is relative to packages/keeper)
 *
 * What the free mode does: it asks 1Click for a handful of unfunded quotes (most of them real, non-dry quotes, two of
 * which name the attacker as payee or refund account) and hands each one to the vault's own `check_quote` view. Nobody
 * funds those quotes, so they expire unused. Row Q0 is the control: the same honest quote, untouched, must pass.
 *
 * Every attack must be refused. The script exits non-zero if any one gets through or the control fails.
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, KeyPair, actions, teraToGas, type KeyPairString } from "near-api-js";
import { INTENTS, isBusy, provider, readVault } from "../src/near.ts";
import { b58encode, quoteFull, signedPayload, tokens, verifyPayload, type QuoteResponse } from "../src/oneclick.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const vault = arg("vault");
const send = process.argv.includes("--send");
const out = arg("out");
if (!vault) {
  console.error("Usage: npm run attack -- --vault <name>.kitevaults.near [--send] [--out file.md]");
  process.exit(2);
}
const ATTACKER = process.env.ATTACKER ?? "attacker.near";

type Row = { id: string; attack: string; layer: string; expect: string; got: string; ok: boolean; tx?: string; note?: string };
const rows: Row[] = [];
const lines: string[] = [];
const say = (l = "") => {
  console.log(l);
  lines.push(l);
};

/** Pull the panic message (ERR_…) or the network's rejection reason out of whatever was thrown. */
function reason(e: unknown): string {
  const s = e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : JSON.stringify(e);
  const err = s.match(/ERR_[A-Z_]+/)?.[0];
  if (err) return err;
  for (const k of ["MethodNameMismatch", "ReceiverMismatch", "DepositWithFunctionCall", "RequiresFullAccess", "NotEnoughAllowance", "InvalidAccessKeyError", "AccessKeyNotFound"]) {
    if (s.includes(k)) return k;
  }
  return s.replace(/\s+/g, " ").slice(0, 140);
}
/** The network's own refusals for a limited access key. */
const REFUSALS = ["MethodNameMismatch", "ReceiverMismatch", "DepositWithFunctionCall", "RequiresFullAccess", "NotEnoughAllowance"];
/** The hash near-api-js computed for a transaction it sent, on success or failure. It may never have reached the chain. */
function sentHash(x: unknown): string | undefined {
  const o = x as { txHash?: string; transaction?: { hash?: string }; transaction_outcome?: { id?: string }; transactionResult?: { transaction_outcome?: { id?: string } } } | null;
  return o?.txHash || o?.transaction?.hash || o?.transaction_outcome?.id || o?.transactionResult?.transaction_outcome?.id || undefined;
}

/** True only if the chain itself knows this transaction. Checked on archival servers, which keep every transaction. */
async function onChain(hash: string): Promise<boolean> {
  for (const url of ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"]) {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: vault, wait_until: "NONE" } }),
          signal: AbortSignal.timeout(8_000),
        });
        const d = (await r.json()) as { result?: unknown };
        if (d.result) return true;
      } catch {
        /* try again, then the next server */
      }
      await new Promise((ok) => setTimeout(ok, 1_500));
    }
  }
  return false;
}

async function attempt(id: string, attack: string, layer: string, expect: string[], fn: () => Promise<unknown>) {
  let got = "NOT REFUSED";
  let hash: string | undefined;
  try {
    hash = sentHash(await fn());
  } catch (e) {
    if (isBusy(e)) {
      // Not an attack result: the network couldn't be reached. Say so instead of guessing.
      rows.push({ id, attack, layer, expect: expect.join(" or "), got: "could not reach NEAR (not an attack result)", ok: false });
      say(`? NOT RUN  ${id}  ${attack}\n    → could not reach NEAR: every RPC server was busy or down. This is not an attack result; run it again.`);
      return;
    }
    got = reason(e);
    hash = sentHash(e);
  }
  // A hash is only shown if the chain knows it. A call the network turns away at the door never becomes a transaction.
  const tx = hash && (await onChain(hash)) ? hash : undefined;
  // Refused by the check this attack targets (✓), or by another of the vault's or the network's checks (still
  // refused, reported as such). Only a call that went through, or failed for some unknown reason, is a failure.
  const refusedElsewhere = !expect.includes(got) && (REFUSALS.includes(got) || got.startsWith("ERR_"));
  const ok = expect.includes(got) || refusedElsewhere;
  const where = tx ? `tx ${tx}` : layer.startsWith("protocol") && REFUSALS.includes(got) ? "refused before inclusion: no transaction" : "";
  rows.push({ id, attack, layer, expect: expect.join(" or "), got: refusedElsewhere ? `${got} (not ${expect.join("/")})` : got, ok, tx, note: where });
  const verdict = ok ? "✓ refused" : got === "NOT REFUSED" ? "✗ GOT THROUGH" : "? UNCLEAR";
  say(`${verdict}  ${id}  ${attack}\n    → ${got}${where ? `  (${where})` : ""}`);
}

/** A real, signed 1Click quote that the attacker requested, with whatever recipient/refund they like. */
async function attackerQuote(sell: string, buy: string, amount: bigint, recipient: string, refundTo: string): Promise<QuoteResponse> {
  return quoteFull({
    dry: false,
    originAsset: sell,
    destinationAsset: buy,
    amount: amount.toString(),
    account: vault!,
    slippageBps: 50,
    deadlineSecs: 3600,
    recipientOverride: recipient,
    refundOverride: refundTo,
  });
}

const checkQuote = (quote: string, signature: string) => provider.callFunction({ contractId: vault!, method: "check_quote", args: { quote, signature } });

async function main() {
  say(`# Kite attack demo`);
  say(``);
  say(`Vault: ${vault} · ${new Date().toISOString()} · mode: ${send ? "views + real transactions" : "views only (no key, no funds)"}`);
  say(`The attacker controls Kite's keeper: its key (rebalance/settle only) and everything it sends to the vault.`);
  say(send ? `Rows Q0–Q6 are free view calls with no key. Rows K1–K6 are signed with Kite's real keeper key.` : `No key, no funds, no transactions: 1Click is asked for unfunded quotes, and the vault's own check_quote view judges each one.`);
  say(``);

  const v = await readVault(vault!);
  const [sell, buy] = [v.plan[0].token, v.plan[1].token];
  const all = await tokens();
  const px = (id: string) => all.find((t) => t.assetId === id)?.price ?? 0;
  const dec = v.plan[0].decimals;
  // About $5 of the first plan asset: big enough for 1Click to quote, small enough not to matter.
  const amount = BigInt(Math.floor((5 / px(sell)) * 10 ** Math.min(dec, 12))) * 10n ** BigInt(Math.max(0, dec - 12));
  const offPlan = all.find((t) => t.blockchain === "near" && !v.plan.some((p) => p.token === t.assetId) && t.price > 0.01 && t.assetId.startsWith("nep141:"))?.assetId;

  say(`## 1. Redirecting money with real, 1Click-signed quotes`);
  say(``);
  const honest = await attackerQuote(sell, buy, amount, vault!, vault!);
  const honestPayload = signedPayload(honest);
  say(`The honest quote (${honest.quote.amountInUsd} USD, pays and refunds the vault) verifies against 1Click's key locally: ${verifyPayload(honestPayload, honest.signature)}`);
  say(``);
  // The control. A vault that refused everything would also "refuse" every attack, so first show it accepts the real thing.
  let control = "refused";
  try {
    await checkQuote(honestPayload, honest.signature);
    control = "ACCEPTED";
  } catch (e) {
    control = isBusy(e) ? "could not reach NEAR (not a result)" : `refused: ${reason(e)}`;
  }
  const controlOk = control === "ACCEPTED";
  say(`${controlOk ? "✓ accepted" : "✗ CONTROL FAILED"}  Q0  Control: the honest quote, untouched\n    → ${control}`);
  say(``);

  const toAttacker = await attackerQuote(sell, buy, amount, ATTACKER, vault!);
  await attempt("Q1", `Genuine 1Click quote that pays out to ${ATTACKER}`, "contract", ["ERR_QUOTE_RECIPIENT"], () =>
    checkQuote(signedPayload(toAttacker), toAttacker.signature),
  );
  const refundAttacker = await attackerQuote(sell, buy, amount, vault!, ATTACKER);
  await attempt("Q2", `Genuine quote whose refund goes to ${ATTACKER} (then make the swap fail)`, "contract", ["ERR_QUOTE_REFUND"], () =>
    checkQuote(signedPayload(refundAttacker), refundAttacker.signature),
  );
  const edited = honestPayload.replace(`"amountIn":"${honest.quote.amountIn}"`, `"amountIn":"${amount * 1000n}"`);
  await attempt("Q3", "Honest quote, edited to move 1000× more", "contract", ["ERR_QUOTE_SIG"], () => checkQuote(edited, honest.signature));
  // A real ed25519 signature over the same message 1Click signs, made with a key the attacker just generated.
  const forged = KeyPair.fromRandom("ed25519").sign(Buffer.from(b58encode(createHash("sha256").update(honestPayload).digest()))).signature;
  await attempt("Q4", "Honest quote, signed by the attacker's own key", "contract", ["ERR_QUOTE_SIG"], () =>
    checkQuote(honestPayload, "ed25519:" + b58encode(forged)),
  );
  const dry = await quoteFull({ dry: true, originAsset: sell, destinationAsset: buy, amount: amount.toString(), account: vault!, slippageBps: 50, deadlineSecs: 3600 });
  await attempt("Q5", "Dry quote (no deposit address) passed off as real", "contract", ["ERR_QUOTE_TERMS"], () => checkQuote(signedPayload(dry), dry.signature));
  if (offPlan) {
    const off = await attackerQuote(sell, offPlan, amount, vault!, vault!);
    await attempt("Q6", `Genuine quote into an asset outside the plan (${offPlan})`, "contract", ["ERR_NOT_IN_PLAN"], () =>
      checkQuote(signedPayload(off), off.signature),
    );
  }

  if (send) {
    const key = process.env.KITE_AGENT_KEY as KeyPairString | undefined;
    if (!key) throw new Error("--send needs KITE_AGENT_KEY (the vault's function-call key)");
    const agent = new Account(vault!, provider, key);
    const call = (receiverId: string, method: string, args: object, deposit = 0n) =>
      agent.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, teraToGas("100"), deposit)] });

    say(``);
    say(`## 2. Real transactions signed with Kite's key`);
    say(``);
    await attempt("K1", `Call vault.withdraw(…, ${ATTACKER})`, "protocol (access key)", ["MethodNameMismatch"], () =>
      call(vault!, "withdraw", { token: sell, amount: "1", receiver_id: ATTACKER }),
    );
    await attempt("K2", `Call intents.near mt_transfer to ${ATTACKER} directly`, "protocol (access key)", ["ReceiverMismatch"], () =>
      // No deposit, so the network judges the key on what it is allowed to call, not on the attached yocto.
      call(INTENTS, "mt_transfer", { receiver_id: ATTACKER, token_id: sell, amount: "1" }),
    );
    await attempt("K3", "Attach a deposit to rebalance", "protocol (access key)", ["DepositWithFunctionCall"], () =>
      call(vault!, "rebalance", { quote: honestPayload, signature: honest.signature, prices: [] }, 1n),
    );
    await attempt("K4", "Call set_limits to loosen the guardrails", "protocol (access key)", ["MethodNameMismatch"], () =>
      call(vault!, "set_limits", { limits: { ...v.limits, max_trade_bps: 5000 } }),
    );
    await attempt("K5", `rebalance with the quote that pays ${ATTACKER}`, "contract", ["ERR_QUOTE_RECIPIENT"], () =>
      call(vault!, "rebalance", { quote: signedPayload(toAttacker), signature: toAttacker.signature, prices: [] }),
    );
    await attempt("K6", "rebalance with an edited quote", "contract", ["ERR_QUOTE_SIG"], () =>
      call(vault!, "rebalance", { quote: edited, signature: honest.signature, prices: [] }),
    );
  }

  const bad = rows.filter((r) => !r.ok);
  say(``);
  say(`## Result`);
  say(``);
  say(`| # | Attack | Stopped by | Refusal | On chain |`);
  say(`|---|---|---|---|---|`);
  say(`| Q0 | Control: the honest quote, untouched | – | ${controlOk ? "accepted ✓ (as it should be)" : `${control} ✗`} | view call |`);
  for (const r of rows) {
    const chain = r.tx ? `[${r.tx.slice(0, 8)}…](https://nearblocks.io/txns/${r.tx}) \`${r.tx}\`` : r.id.startsWith("Q") ? "view call" : (r.note ?? "–");
    say(`| ${r.id} | ${r.attack} | ${r.layer} | \`${r.got}\` ${r.ok ? "✓" : "✗"} | ${chain} |`);
  }
  say(``);
  const through = rows.filter((r) => r.got === "NOT REFUSED").length;
  const byVault = rows.filter((r) => r.ok && r.layer === "contract").length;
  const byNear = rows.filter((r) => r.ok && r.layer !== "contract").length;
  say(
    through
      ? `${through} attack(s) got through.`
      : bad.length
        ? `${rows.length - bad.length} of ${rows.length} refused; ${bad.length} did not run or failed for another reason (see above). Nothing left the vault.`
        : `${rows.length} of ${rows.length} refused: ${byVault} by the vault's own checks${byNear ? `, ${byNear} by NEAR before they could run (the key may only call rebalance or settle, only on this vault, with no deposit)` : ""}. Nothing left the vault.`,
  );
  if (!controlOk) say(`The control failed: the vault did not accept an honest quote, so the refusals above prove nothing. Check the vault and run again.`);
  if (out) writeFileSync(out, lines.join("\n") + "\n");
  process.exit(bad.length || !controlOk ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});

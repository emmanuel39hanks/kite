/**
 * Attack demo: a compromised (or prompt-injected) Kite keeper tries to steal from a live vault.
 *
 *   npm run attack -- --vault <name>.kitevaults.near            # free: real 1Click quotes, checked by the vault's own view
 *   npm run attack -- --vault <name>.kitevaults.near --send     # also sends real transactions with the agent key (KITE_AGENT_KEY)
 *   add --out ../docs/attack-log.md to save the transcript
 *
 * Every attack must be refused. The script exits non-zero if any one gets through.
 */
import { writeFileSync } from "node:fs";
import { Account, actions, teraToGas, type KeyPairString } from "near-api-js";
import { INTENTS, provider, readVault } from "../src/near.ts";
import { quoteFull, signedPayload, tokens, verifyPayload, type QuoteResponse } from "../src/oneclick.ts";

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

type Row = { id: string; attack: string; layer: string; expect: string; got: string; ok: boolean; tx?: string };
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
const hashOf = (e: unknown) => JSON.stringify(e ?? {}).match(/"(?:hash|transaction_hash)":"([1-9A-HJ-NP-Za-km-z]{43,44})"/)?.[1];

async function attempt(id: string, attack: string, layer: string, expect: string[], fn: () => Promise<unknown>) {
  let got = "NOT REFUSED";
  let tx: string | undefined;
  try {
    const r = await fn();
    tx = hashOf(r);
  } catch (e) {
    got = reason(e);
    tx = hashOf(e);
  }
  // Refused by the check this attack targets (✓), or by another of the vault's or the network's checks (still
  // refused, reported as such). Only a call that went through, or failed for some unknown reason, is a failure.
  const refusedElsewhere = !expect.includes(got) && (REFUSALS.includes(got) || got.startsWith("ERR_"));
  const ok = expect.includes(got) || refusedElsewhere;
  rows.push({ id, attack, layer, expect: expect.join(" or "), got: refusedElsewhere ? `${got} (not ${expect.join("/")})` : got, ok, tx });
  const verdict = ok ? "✓ refused" : got === "NOT REFUSED" ? "✗ GOT THROUGH" : "? UNCLEAR";
  say(`${verdict}  ${id}  ${attack}\n    → ${got}${tx ? `  (tx ${tx})` : ""}`);
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
  say(`Sanity check: an honest quote (${honest.quote.amountInUsd} USD) verifies locally: ${verifyPayload(honestPayload, honest.signature)}`);
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
  await attempt("Q4", "Quote signed by the attacker's own key", "contract", ["ERR_QUOTE_SIG"], () =>
    checkQuote(honestPayload, "ed25519:" + "1".repeat(64)),
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
  say(`| # | Attack | Stopped by | Refusal | Tx |`);
  say(`|---|---|---|---|---|`);
  for (const r of rows) say(`| ${r.id} | ${r.attack} | ${r.layer} | \`${r.got}\` ${r.ok ? "✓" : "✗"} | ${r.tx ? `[${r.tx.slice(0, 8)}…](https://nearblocks.io/txns/${r.tx})` : "–"} |`);
  say(``);
  const through = rows.filter((r) => r.got === "NOT REFUSED").length;
  say(
    through
      ? `${through} attack(s) got through.`
      : bad.length
        ? `${rows.length - bad.length} of ${rows.length} refused; ${bad.length} failed for another reason (see above). Nothing left the vault.`
        : `${rows.length} of ${rows.length} refused. Nothing left the vault.`,
  );
  if (out) writeFileSync(out, lines.join("\n") + "\n");
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});

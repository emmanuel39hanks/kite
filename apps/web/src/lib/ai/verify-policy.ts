/**
 * The checklist a voter sees on /verify. Each item says what was actually checked; an item that could not be
 * checked is "unknown", never green.
 *
 * The cryptography that needs NEAR AI's SDK (the signature bytes and today's attestation) is passed in, so this
 * file stays pure and testable; `evidence-sdk.ts` supplies the real implementation in the browser.
 */
import { decodeEvidenceLine, expectedSignedText, policyRefOf, requestModel, sameJson, splitDescription, type EvidenceBundle } from "@/lib/ai/evidence";
import { callsMatch, descriptionBody, factsFromRequest, lossBound, rationaleFrom, type PolicyFacts } from "@/lib/ai/policy";
import { toContractLimits, type ContractLimits, type ContractTarget } from "@/lib/near/vault";
import { decodeArgs, type ProposalKind } from "@/lib/near/dao";

export type CheckState = "pass" | "fail" | "unknown";
export type Check = { key: "evidence" | "signature" | "hashes" | "attested" | "text" | "calls" | "policy_ref" | "numbers" | "stats"; label: string; state: CheckState; reason: string };

export type SdkChecks = {
  /** Throws unless the signature over `signedText` is valid for the signing address (and signedText matches the bytes). */
  signature: (b: EvidenceBundle) => Promise<void>;
  /** Is the signing address in a report NEAR AI's TEE attests today? */
  attested: (b: EvidenceBundle) => Promise<{ state: CheckState; reason: string }>;
};

export type VerifyResult = { checks: Check[]; bundle: EvidenceBundle | null; facts: PolicyFacts | null; policyRef: string | null; body: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The calls a proposal kind makes, decoded. Null if it isn't a FunctionCall proposal. */
function proposalCalls(kind: unknown): { receiver: string; calls: { method: string; args: unknown }[] } | null {
  const fc = (kind as ProposalKind | null)?.FunctionCall;
  if (!fc || typeof fc.receiver_id !== "string" || !Array.isArray(fc.actions)) return null;
  return { receiver: fc.receiver_id, calls: fc.actions.map((a) => ({ method: a.method_name, args: decodeArgs(a.args) })) };
}

/** The rules in plain units, the targets and the stated worst case all agree with the call arguments. */
export function numbersCheck(f: PolicyFacts): { ok: boolean; reason: string } {
  const lim = f.calls.find((c) => c.method === "set_limits")?.args.limits as ContractLimits | undefined;
  if (!lim) return { ok: false, reason: "The signed calls have no set_limits." };
  const plan = f.calls.find((c) => c.method === "set_plan")?.args.plan as ContractTarget[] | undefined;
  if (plan && !sameJson(plan, f.targets)) return { ok: false, reason: "The set_plan targets differ from the plan the analysis describes." };
  const expect = toContractLimits(f.rules);
  if (lim.band_bps !== expect.band_bps || lim.max_trade_bps !== expect.max_trade_bps || lim.max_slippage_bps !== expect.max_slippage_bps || lim.max_trades_per_day !== expect.max_trades_per_day)
    return { ok: false, reason: "The plain-unit rules shown to the model differ from the set_limits arguments." };
  if (f.plan.length !== f.targets.length || f.plan.some((p, k) => Math.round(p.weightPct * 100) !== f.targets[k].target_bps))
    return { ok: false, reason: "The target mix shown differs from the plan's weights." };
  const again = lossBound(lim, f.targets);
  if (!sameJson(again, f.worstCase)) return { ok: false, reason: `Recomputed worst case is ${again.perTradePct}% a trade and ${again.perDayPct}% a day; the analysis says ${f.worstCase.perTradePct}% and ${f.worstCase.perDayPct}%.` };
  return { ok: true, reason: `Recomputed from the call arguments: about ${again.perTradePct}% a trade and ${again.perDayPct}% a day (${again.tradesPerDay} trades at most), as stated.` };
}

/**
 * Check a description, and optionally the proposal kind it came with.
 * Without a kind (a pasted description), the call and policy_ref checks are "unknown".
 */
export async function verifyPolicy(input: { description: string; kind?: unknown }, sdk: SdkChecks): Promise<VerifyResult> {
  const { body, line } = splitDescription(input.description);
  const checks: Check[] = [];
  let bundle: EvidenceBundle;
  try {
    if (!line) throw new Error("The description's last line isn't a kite-evidence line.");
    bundle = await decodeEvidenceLine(line);
  } catch (e) {
    checks.push({ key: "evidence", label: "Evidence attached", state: "fail", reason: msg(e) });
    return { checks, bundle: null, facts: null, policyRef: null, body };
  }

  // (b) the signed text is exactly model:sha256(request):sha256(response) of the bytes in the bundle.
  const expected = await expectedSignedText(bundle);
  const model = requestModel(bundle.request);
  const hashesOk = expected !== null && expected === bundle.signedText && (bundle.kind === "gateway" || model === bundle.model);
  checks.push({
    key: "hashes",
    label: "The signed text covers these exact bytes",
    state: hashesOk ? "pass" : "fail",
    reason: hashesOk
      ? `sha256 of the request and of the answer, recomputed here, are the ones ${bundle.kind === "provider_tee" ? `${bundle.model} signed` : "the gateway signed"}.`
      : expected === null
        ? "The signed request names no model."
        : model !== bundle.model && bundle.kind === "provider_tee"
          ? `The bundle says ${bundle.model} but the signed request names ${model}.`
          : "The hashes in the signed text don't match the request and answer in the evidence: something was edited.",
  });

  // (a) the signature over that text, with the SDK's own verifier.
  let sigOk = false;
  if (!hashesOk) checks.push({ key: "signature", label: "Signature is valid", state: "unknown", reason: "Not checked: the signed text doesn't match these bytes, so the SDK refuses before checking the signature." });
  else
    try {
      await sdk.signature(bundle);
      sigOk = true;
      checks.push({ key: "signature", label: "Signature is valid", state: "pass", reason: `${bundle.signingAlgo} signature by ${bundle.signingAddress.slice(0, 10)}… checked with NEAR AI's SDK (${bundle.kind === "provider_tee" ? "the model's key" : "the gateway's key"}).` });
    } catch (e) {
      checks.push({ key: "signature", label: "Signature is valid", state: "fail", reason: `NEAR AI's SDK refused it: ${msg(e)}` });
    }

  // (c) that key belongs to an attested TEE, today.
  if (!sigOk) checks.push({ key: "attested", label: "Signer is attested by NEAR AI", state: "unknown", reason: "Not checked: the signature didn't verify." });
  else {
    let a: { state: CheckState; reason: string };
    try {
      a = await sdk.attested(bundle);
    } catch (e) {
      a = { state: "unknown", reason: `Can't confirm today: ${msg(e)}` };
    }
    checks.push({ key: "attested", label: bundle.kind === "provider_tee" ? "Signer is the model's attested hardware" : "Signer is NEAR AI's attested gateway", ...a });
  }

  // What voters read is exactly what the signed facts and answer produce.
  let facts: PolicyFacts | null = null;
  const policyRef = await policyRefOf(bundle);
  try {
    facts = factsFromRequest(bundle.request);
    const rebuilt = descriptionBody(facts, rationaleFrom(bundle.response, facts), bundle, policyRef);
    const same = rebuilt === body;
    checks.push({
      key: "text",
      label: "The text you read is the signed answer",
      state: same ? "pass" : "fail",
      reason: same ? "Rebuilt from the signed request and answer, the description above the evidence line matches character for character." : "The description differs from what the signed request and answer produce: it was edited.",
    });
  } catch (e) {
    checks.push({ key: "text", label: "The text you read is the signed answer", state: "fail", reason: msg(e) });
  }

  // (d) and (e): the calls the DAO would make.
  const pc = input.kind === undefined ? undefined : proposalCalls(input.kind);
  if (!facts) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "unknown", reason: "Not checked: the signed request isn't a Kite policy." });
  else if (pc === undefined) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "unknown", reason: "Not checked: only a description was given. Load the proposal from the DAO to compare its calls." });
  else if (pc === null) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "fail", reason: "The proposal isn't a function call on the vault." });
  else if (pc.receiver !== facts.vault) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "fail", reason: `The proposal calls ${pc.receiver}; the analysis is about ${facts.vault}.` });
  else {
    const m = callsMatch(facts.calls, pc.calls, policyRef);
    checks.push({ key: "calls", label: "The proposal makes the signed calls", state: m.ok ? "pass" : "fail", reason: m.ok ? `On ${pc.receiver}: ${m.reason}` : m.reason });
  }

  if (!pc) checks.push({ key: "policy_ref", label: "policy_ref is the evidence's hash", state: "unknown", reason: `Not checked against a proposal. The evidence hashes to ${policyRef}.` });
  else {
    const refs = pc.calls.map((c) => (c.args as { policy_ref?: unknown } | null)?.policy_ref);
    const ok = refs.length > 0 && refs.every((r) => r === policyRef);
    checks.push({ key: "policy_ref", label: "policy_ref is the evidence's hash", state: ok ? "pass" : "fail", reason: ok ? `Every call carries ${policyRef.slice(0, 16)}…, the sha256 of the evidence recomputed here.` : `The calls carry ${String(refs[0] ?? "no policy_ref").slice(0, 16)}…; the evidence hashes to ${policyRef.slice(0, 16)}….` });
  }

  // (f) numbers we can recompute, and the ones we can't.
  if (!facts) checks.push({ key: "numbers", label: "Worst case recomputed", state: "unknown", reason: "Not checked: no facts to recompute from." });
  else {
    const n = numbersCheck(facts);
    checks.push({ key: "numbers", label: "Worst case recomputed", state: n.ok ? "pass" : "fail", reason: n.reason });
  }
  checks.push({
    key: "stats",
    label: "Price statistics",
    state: "unknown",
    reason: facts?.stats
      ? `Not rechecked: they come from ${facts.stats.days} days of daily prices up to the day of the analysis. The signature proves these are the numbers the model was given, not that they are right.`
      : "None were included in this analysis.",
  });

  return { checks, bundle, facts, policyRef, body };
}

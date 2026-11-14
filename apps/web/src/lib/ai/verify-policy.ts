/**
 * The checklist a voter sees on /verify. Each item says what was actually checked; an item that could not be
 * checked is "unknown", never green.
 *
 * The cryptography that needs NEAR AI's SDK (the signature bytes and today's attestation) is passed in, so this
 * file stays pure and testable; `evidence-sdk.ts` supplies the real implementation in the browser.
 */
import { decodeEvidenceLine, expectedSignedText, policyRefOf, requestModel, sameJson, splitDescription, type EvidenceBundle } from "@/lib/ai/evidence";
import { callsMatch, cleanMandate, descriptionBody, factsFromRequest, lossBound, policyRequest, rationaleFrom, type PolicyFacts } from "@/lib/ai/policy";
import { POLICY_MODEL } from "@/lib/ai/planner";
import { assetByIntentsId } from "@/lib/assets";
import { toContractLimits, type ContractLimits, type ContractTarget } from "@/lib/near/vault";
import { decodeArgs, type ProposalKind } from "@/lib/near/dao";

export type CheckState = "pass" | "fail" | "unknown";
export type Check = { key: "evidence" | "signature" | "hashes" | "attested" | "prompt" | "text" | "vault" | "calls" | "policy_ref" | "numbers" | "stats"; label: string; state: CheckState; reason: string };

/**
 * "verified" only when every check passes except the price statistics, which can never be rechecked. A valid signature
 * from a key NEAR AI doesn't attest proves nothing about who wrote the words, so an unattested signer is never verified.
 */
export function verdict(checks: Check[]): "verified" | "failed" | "unverified" {
  if (checks.some((c) => c.state === "fail")) return "failed";
  return checks.every((c) => c.key === "stats" || c.state === "pass") ? "verified" : "unverified";
}

export type SdkChecks = {
  /** Throws unless the signature over `signedText` is valid for the signing address (and signedText matches the bytes). */
  signature: (b: EvidenceBundle) => Promise<void>;
  /** Is the signing address in a report NEAR AI's TEE attests today? */
  attested: (b: EvidenceBundle) => Promise<{ state: CheckState; reason: string }>;
};

export type VerifyResult = { checks: Check[]; bundle: EvidenceBundle | null; facts: PolicyFacts | null; policyRef: string | null; body: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The calls a proposal kind makes, decoded. Null if it isn't a FunctionCall proposal. */
function proposalCalls(kind: unknown): { receiver: string; calls: { method: string; args: unknown }[]; deposits: string[] } | null {
  const fc = (kind as ProposalKind | null)?.FunctionCall;
  if (!fc || typeof fc.receiver_id !== "string" || !Array.isArray(fc.actions)) return null;
  return { receiver: fc.receiver_id, calls: fc.actions.map((a) => ({ method: a.method_name, args: decodeArgs(a.args) })), deposits: fc.actions.map((a) => String(a.deposit)) };
}

/** The rules in plain units, the targets and the stated worst case all agree with the call arguments. */
export function numbersCheck(f: PolicyFacts): { ok: boolean; reason: string } {
  // Kite always stores the DAO's words as one clean line; anything else could pose as Kite's own text.
  if (f.mandate !== null && (typeof f.mandate !== "string" || f.mandate === "" || f.mandate !== cleanMandate(f.mandate)))
    return { ok: false, reason: "The DAO's words in the analysis aren't the single clean line Kite writes: they could pose as Kite's own text." };
  const lim = f.calls.find((c) => c.method === "set_limits")?.args.limits as ContractLimits | undefined;
  if (!lim) return { ok: false, reason: "The signed calls have no set_limits." };
  const plan = f.calls.find((c) => c.method === "set_plan")?.args.plan as ContractTarget[] | undefined;
  if (plan && !sameJson(plan, f.targets)) return { ok: false, reason: "The set_plan targets differ from the plan the analysis describes." };
  const expect = toContractLimits(f.rules);
  if (lim.band_bps !== expect.band_bps || lim.max_trade_bps !== expect.max_trade_bps || lim.max_slippage_bps !== expect.max_slippage_bps || lim.max_trades_per_day !== expect.max_trades_per_day)
    return { ok: false, reason: "The plain-unit rules shown to the model differ from the set_limits arguments." };
  if (f.plan.length !== f.targets.length || f.plan.some((p, k) => Math.round(p.weightPct * 100) !== f.targets[k].target_bps))
    return { ok: false, reason: "The target mix shown differs from the plan's weights." };
  // Names come from the token ids in the call, not from the analysis, so a plan can't be labelled as something else.
  const bad = f.plan.findIndex((p, k) => p.asset !== (assetByIntentsId(f.targets[k].token)?.name ?? f.targets[k].token));
  if (bad >= 0) return { ok: false, reason: `The mix names ${f.plan[bad].asset}, but the call targets ${f.targets[bad].token}.` };
  const again = lossBound(lim, f.targets);
  if (!sameJson(again, f.worstCase)) return { ok: false, reason: `Recomputed worst case is ${again.perTradePct}% a trade and ${again.perDayPct}% a day; the analysis says ${f.worstCase.perTradePct}% and ${f.worstCase.perDayPct}%.` };
  return { ok: true, reason: `Recomputed from the call arguments: about ${again.perTradePct}% a trade and ${again.perDayPct}% a day (${again.tradesPerDay} trades at most), as stated.` };
}

/**
 * Check a description, and optionally the proposal kind it came with.
 * Without a kind (a pasted description), the call and policy_ref checks are "unknown".
 */
export async function verifyPolicy(
  input: { description: string; kind?: unknown; /** The DAO the proposal is on, and the vault's owner read from chain now. */ dao?: string; vaultOwner?: string | null; /** For a vault closed since: who the factory says created it, and whether the proposal passed and ran. */ closed?: { creator: string; passed: boolean } },
  sdk: SdkChecks,
): Promise<VerifyResult> {
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
      checks.push({ key: "signature", label: "Signature is valid", state: "pass", reason: `A valid ${bundle.signingAlgo} signature by key ${bundle.signingAddress.slice(0, 10)}…, checked with NEAR AI's SDK. On its own this says nothing about who holds that key: the next check does.` });
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
      a = { state: "unknown", reason: `Not verified today: ${msg(e)}` };
    }
    checks.push({ key: "attested", label: bundle.kind === "provider_tee" ? "Signer is the model's attested hardware" : "Signer is NEAR AI's attested gateway", ...a });
  }

  // What voters read is exactly what the signed facts and answer produce.
  let facts: PolicyFacts | null = null;
  const policyRef = await policyRefOf(bundle);
  try {
    facts = factsFromRequest(bundle.request);
    // The model must have been asked Kite's own question about these facts, byte for byte. Anyone can get NEAR AI to
    // sign an answer to a prompt they wrote; only this exact request makes the answer an analysis of the policy.
    const asked = bundle.request === policyRequest(POLICY_MODEL, facts);
    checks.push({
      key: "prompt",
      label: "The model was asked Kite's question",
      state: asked ? "pass" : "fail",
      reason: asked
        ? `The signed request is exactly Kite's policy prompt to ${POLICY_MODEL} for these facts, rebuilt here.`
        : "The signed request isn't Kite's policy prompt for these facts: someone else wrote what the model was told.",
    });
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

  // The vault the analysis is about must belong to the DAO the proposal is on.
  if (!facts) checks.push({ key: "vault", label: "The vault belongs to this DAO", state: "unknown", reason: "Not checked: the signed request isn't a Kite policy." });
  else if (!input.dao || input.vaultOwner === undefined) checks.push({ key: "vault", label: "The vault belongs to this DAO", state: "unknown", reason: `Not checked: load the proposal from its DAO to compare ${facts.vault}'s owner.` });
  else if (input.vaultOwner === input.dao) checks.push({ key: "vault", label: "The vault belongs to this DAO", state: "pass", reason: `${facts.vault} is owned by ${input.dao}, read from the vault now.` });
  // A closed vault has no owner to read. An owner-only call that ran proves who the owner was when it ran: SputnikDAO
  // marks a proposal Approved only if its call succeeded, and the factory's record names who created the vault.
  else if (!input.vaultOwner && input.closed)
    checks.push(
      input.closed.creator === input.dao && input.closed.passed
        ? { key: "vault", label: "The vault belonged to this DAO", state: "pass", reason: `${facts.vault} has been closed since, so its owner can't be read now. The factory's record shows ${input.dao} created it, and this proposal passed and ran: the vault makes these calls for its owner only.` }
        : { key: "vault", label: "The vault belongs to this DAO", state: "fail", reason: `${facts.vault} has been closed${input.closed.creator === input.dao ? ", and this proposal did not pass before it closed" : `; the factory's record shows ${input.closed.creator} created it, not ${input.dao}`}.` },
    );
  else checks.push({ key: "vault", label: "The vault belongs to this DAO", state: "fail", reason: input.vaultOwner ? `${facts.vault} is owned by ${input.vaultOwner}, not ${input.dao}.` : `${facts.vault} couldn't be read as a Kite vault.` });

  // (d) and (e): the calls the DAO would make.
  const pc = input.kind === undefined ? undefined : proposalCalls(input.kind);
  if (!facts) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "unknown", reason: "Not checked: the signed request isn't a Kite policy." });
  else if (pc === undefined) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "unknown", reason: "Not checked: only a description was given. Load the proposal from the DAO to compare its calls." });
  else if (pc === null) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "fail", reason: "The proposal isn't a function call on the vault." });
  else if (pc.receiver !== facts.vault) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "fail", reason: `The proposal calls ${pc.receiver}; the analysis is about ${facts.vault}.` });
  else if (pc.deposits.some((d) => d !== "1")) checks.push({ key: "calls", label: "The proposal makes the signed calls", state: "fail", reason: `Each call should attach 1 yoctoNEAR; this one attaches ${pc.deposits.join(", ")}.` });
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

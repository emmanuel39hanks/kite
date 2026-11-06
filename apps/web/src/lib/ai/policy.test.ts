import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { canonicalJson, decodeEvidenceLine, encodeEvidenceLine, expectedSignedText, policyRefOf, sha256Hex, splitDescription, type EvidenceBundle } from "./evidence";
import { checkSignature } from "./evidence-sdk";
import { buildProposal, callsMatch, lossBound, policyFacts, policyRequest, rationaleFrom, withPolicyRef, type PolicyFacts } from "./policy";
import { verifyPolicy, type SdkChecks } from "./verify-policy";
import { encodeArgs, vaultProposalKind } from "../near/dao";
import { toContractLimits, type ContractTarget } from "../near/vault";

const MODEL = "z-ai/glm-5.3-flash";
const VAULT = "kite.treasury.sputnik-dao.near";
const rules = { driftBand: 5, maxTradePct: 10, slippageBps: 100, tradesPerDay: 4 };
const targets: ContractTarget[] = [
  { token: "nep141:nbtc.bridge.near", target_bps: 6000, decimals: 8 },
  { token: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", target_bps: 4000, decimals: 6 },
];
const facts = () => policyFacts({ vault: VAULT, limits: toContractLimits(rules), rules, targets, setPlan: true, stats: null, mandate: "Keep most of it safe" });

const answer = (content: unknown) =>
  JSON.stringify({ id: "chatcmpl-test1", object: "chat.completion", model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }] });
const GOOD = { what: "Sets tight rules for the vault.", why: "Small trades keep costs low.", worst: "A misused key can only waste swap fees.", watch: "Watch for trades the plan didn't need." };

/** A bundle signed with a key made here, in NEAR AI's format: ed25519 over "<model>:sha256(req):sha256(res)". */
async function signedBundle(f: PolicyFacts = facts(), content: unknown = GOOD): Promise<EvidenceBundle> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString("hex");
  const request = policyRequest(MODEL, f);
  const response = answer(content);
  const signedText = (await expectedSignedText({ kind: "provider_tee", request, response }))!;
  const signature = sign(null, Buffer.from(signedText), privateKey).toString("hex");
  return { v: 1, kind: "provider_tee", model: MODEL, completionId: "chatcmpl-test1", request, response, signature, signingAddress: pub, signingAlgo: "ed25519", signedText };
}

const sdk: SdkChecks = { signature: checkSignature, attested: async () => ({ state: "pass", reason: "stub" }) };
const states = (r: Awaited<ReturnType<typeof verifyPolicy>>) => Object.fromEntries(r.checks.map((c) => [c.key, c.state]));

test("the worst case is 2 × price limit × trade size, times trades a day", () => {
  const b = lossBound(toContractLimits(rules), targets);
  assert.deepEqual(b, { priceLimitPct: 1, maxTradePct: 10, tradesPerDay: 4, perTradePct: 0.2, perDayPct: 0.8 });
  // An earning asset's wider limit is the one a trade can use.
  assert.equal(lossBound(toContractLimits(rules), [...targets, { token: "x", target_bps: 1, decimals: 6, max_slippage_bps: 200 }]).perTradePct, 0.4);
  // The four-hour gap caps trades a day at six, whatever the daily cap says.
  assert.equal(lossBound({ ...toContractLimits(rules), max_trades_per_day: 24 }, targets).tradesPerDay, 6);
});

test("policy_ref is the sha256 of the canonical bundle, independent of key order", async () => {
  const b = await signedBundle();
  const shuffled = Object.fromEntries(Object.entries(b).reverse()) as EvidenceBundle;
  assert.equal(await policyRefOf(b), await policyRefOf(shuffled));
  assert.equal(await policyRefOf(b), await sha256Hex(canonicalJson(b)));
  assert.match(await policyRefOf(b), /^[0-9a-f]{64}$/);
  assert.notEqual(await policyRefOf(b), await policyRefOf({ ...b, response: b.response + " " }));
  assert.equal(canonicalJson({ b: [1, { d: 2, c: "x" }], a: null }), '{"a":null,"b":[1,{"c":"x","d":2}]}');
});

test("the evidence line round-trips and rejects junk", async () => {
  const b = await signedBundle();
  const line = await encodeEvidenceLine(b);
  assert.match(line, /^kite-evidence:v1:[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeEvidenceLine(`hello\n${line}`), b);
  await assert.rejects(decodeEvidenceLine("kite-evidence:v1:!!!"));
  await assert.rejects(decodeEvidenceLine("kite-evidence:v1:AAAA"));
  await assert.rejects(decodeEvidenceLine("no line here"));
});

test("a proposal: signed args plus policy_ref, description under the limit, and it verifies", async () => {
  const b = await signedBundle();
  const p = await buildProposal(b);
  assert.ok(p.description.length < 8000, `${p.description.length}`);
  assert.equal(splitDescription(p.description).line?.startsWith("kite-evidence:v1:"), true);
  assert.deepEqual(p.calls.map((c) => c.method), ["set_limits", "set_plan"]);
  assert.equal(p.calls[0].args.policy_ref, await policyRefOf(b));
  assert.ok(p.rationale.fromModel);
  // The same bundle always gives the same proposal.
  assert.deepEqual(await buildProposal(b), p);

  const r = await verifyPolicy({ description: p.description, kind: vaultProposalKind(VAULT, p.calls) }, sdk);
  assert.deepEqual(states(r), { hashes: "pass", signature: "pass", attested: "pass", text: "pass", calls: "pass", policy_ref: "pass", numbers: "pass", stats: "unknown" });
});

test("a pasted description alone leaves the call checks unknown, never green", async () => {
  const p = await buildProposal(await signedBundle());
  const s = states(await verifyPolicy({ description: p.description }, sdk));
  assert.equal(s.calls, "unknown");
  assert.equal(s.policy_ref, "unknown");
  assert.equal(s.signature, "pass");
});

test("edits are caught: the text, the args, the policy_ref, the evidence", async () => {
  const b = await signedBundle();
  const p = await buildProposal(b);
  const kind = vaultProposalKind(VAULT, p.calls);

  // An edited sentence above the evidence line.
  const edited = p.description.replace("Small trades keep costs low.", "Big trades are fine.");
  assert.equal(states(await verifyPolicy({ description: edited, kind }, sdk)).text, "fail");

  // Looser limits in the proposal than in the analysis.
  const looser = [{ method: "set_limits", args: { limits: { ...toContractLimits(rules), max_slippage_bps: 500 }, policy_ref: p.policyRef } }, p.calls[1]];
  const sl = states(await verifyPolicy({ description: p.description, kind: vaultProposalKind(VAULT, looser) }, sdk));
  assert.equal(sl.calls, "fail");

  // A different vault.
  assert.equal(states(await verifyPolicy({ description: p.description, kind: vaultProposalKind("kite.thief.near", p.calls) }, sdk)).calls, "fail");

  // A wrong policy_ref.
  const wrongRef = withPolicyRef(p.calls, "0".repeat(64));
  const sr = states(await verifyPolicy({ description: p.description, kind: vaultProposalKind(VAULT, wrongRef) }, sdk));
  assert.equal(sr.policy_ref, "fail");

  // A replaced answer inside the evidence: the hashes no longer match, and the signature is then not claimed.
  const forged = { ...b, response: answer({ ...GOOD, why: "Trust us." }) };
  const forgedDesc = (await buildProposal(forged)).description;
  const sf = states(await verifyPolicy({ description: forgedDesc }, sdk));
  assert.equal(sf.hashes, "fail");
  assert.equal(sf.signature, "unknown");
  assert.equal(sf.attested, "unknown");

  // A signature by another key over the right text.
  const other = await signedBundle();
  const swapped = { ...b, signature: other.signature };
  assert.equal(states(await verifyPolicy({ description: (await buildProposal(swapped)).description }, sdk)).signature, "fail");

  // No evidence at all.
  assert.equal(states(await verifyPolicy({ description: "Kite treasury policy\nTrust me." }, sdk)).evidence, "fail");
});

test("model text with numbers falls back to the fixed template, and verification agrees", async () => {
  const f = facts();
  for (const bad of [{ ...GOOD, worst: "At worst you lose 2% a day." }, { ...GOOD, why: "It doubled last year." }, { ...GOOD, watch: "" }, "not json"]) {
    const r = rationaleFrom(answer(bad), f);
    assert.equal(r.fromModel, false);
    assert.match(r.worst, /0\.2% of the portfolio and a day about 0\.8%/);
  }
  const b = await signedBundle(f, { ...GOOD, worst: "Up to twenty percent." });
  const p = await buildProposal(b);
  assert.match(p.description, /fixed template/);
  assert.equal(states(await verifyPolicy({ description: p.description, kind: vaultProposalKind(VAULT, p.calls) }, sdk)).text, "pass");
});

test("args equality ignores key order but nothing else", () => {
  const signed = [{ method: "set_limits", args: { limits: { a: 1, b: 2 } } }];
  const ref = "ab".repeat(32);
  assert.ok(callsMatch(signed, [{ method: "set_limits", args: { policy_ref: ref, limits: { b: 2, a: 1 } } }], ref).ok);
  assert.ok(!callsMatch(signed, [{ method: "set_limits", args: { limits: { a: 1, b: 2 } } }], ref).ok);
  assert.ok(!callsMatch(signed, [{ method: "set_limits", args: { limits: { a: 1, b: 2 }, policy_ref: ref, extra: 1 } }], ref).ok);
  assert.ok(!callsMatch(signed, [], ref).ok);
  assert.equal(encodeArgs({ x: 1 }), "eyJ4IjoxfQ==");
});

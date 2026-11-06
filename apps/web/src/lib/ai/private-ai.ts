"use client";

/**
 * One private question to NEAR AI Cloud, from the browser.
 * Verify the model's attestation, encrypt the message to it, get a signed answer, check the signature.
 * The SDK throws if any step fails, so a returned receipt means every step passed.
 */
import { PLANNER_MODEL, POLICY_MODEL } from "@/lib/ai/planner";
import { expectedSignedText, requestModel, type EvidenceBundle } from "@/lib/ai/evidence";

export type Stage = "verify" | "ask" | "sign";
export type Receipt = { model: string; completionId: string; signatureKind: "provider_tee" | "gateway"; modelReports: number; verifiedAt: number };

type Client = InstanceType<typeof import("@nearai/inference-sdk").InferenceClient>;
let clientP: Promise<Client> | null = null;
let attestP: Promise<Awaited<ReturnType<Client["verify"]>>> | null = null;

/** One client per page load, so the attestation check (the slow part) is done once and reused. */
function client(): Promise<Client> {
  clientP ??= import("@nearai/inference-sdk")
    .then(({ InferenceClient }) => new InferenceClient({ baseUrl: `${window.location.origin}/api/nearai/v1`, e2ee: true }))
    .catch((e) => {
      clientP = null;
      throw e;
    });
  return clientP;
}
function attest() {
  attestP ??= client()
    .then((c) => c.verify(PLANNER_MODEL))
    .catch((e) => {
      attestP = null; // let the next try start fresh
      throw e;
    });
  return attestP;
}

/** Start the attestation check in the background, e.g. when the box appears, so the click feels instant. */
export function warmUp() {
  attest().catch(() => {});
}

export async function askPrivately(opts: {
  system: string;
  user: string;
  schema: { name: string; strict: boolean; schema: unknown };
  maxTokens?: number;
  onStage?: (s: Stage) => void;
}): Promise<{ data: unknown; receipt: Receipt }> {
  const c = await client();
  opts.onStage?.("verify");
  const att = await attest();
  opts.onStage?.("ask");
  const completion = await c.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 1500,
    response_format: { type: "json_schema", json_schema: opts.schema as never },
    // Drafting a plan doesn't need the model to think out loud: that tripled the wait (14s to 5s in testing).
    reasoning_effort: "none",
  } as never) as Awaited<ReturnType<typeof c.chat.completions.create>> & { id: string; choices: { message: { content?: string | null } }[] };
  opts.onStage?.("sign");
  const verified = await c.verifyResponse(completion.id);
  const content = String(completion.choices[0]?.message?.content ?? "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  return {
    data: JSON.parse(content),
    receipt: {
      model: PLANNER_MODEL,
      completionId: completion.id,
      signatureKind: (verified as { signatureKind: "provider_tee" | "gateway" }).signatureKind,
      modelReports: att.models?.length ?? 0,
      verifiedAt: att.verifiedAt ?? Date.now(),
    },
  };
}

/* ───────────── public analyses, with evidence anyone can check ───────────── */

let publicClientP: Promise<Client> | null = null;

/**
 * A second client with E2EE off, for analyses that are public anyway (a DAO's treasury policy). With E2EE the
 * signed bytes are ciphertext only this browser can read; without it they are the plain request and answer,
 * so a voter can re-hash them later. The SDK still verifies NEAR AI's attestation and routes to an attested key.
 */
function publicClient(): Promise<Client> {
  publicClientP ??= import("@nearai/inference-sdk")
    .then(({ InferenceClient }) => new InferenceClient({ baseUrl: `${window.location.origin}/api/nearai/v1`, e2ee: false }))
    .catch((e) => {
      publicClientP = null;
      throw e;
    });
  return publicClientP;
}

type SignedResult = { signature: { kind: "provider_tee" | "gateway"; signedText: string; signature: string; signer: { signingAlgo: "ed25519" | "ecdsa"; signingAddress: string } } };

/**
 * Send an exact request body and keep the exact bytes of both sides with NEAR AI's signature for the completion.
 * Checked here the way a voter will check it later: the signed text must be "<model>:sha256(request):sha256(response)"
 * (or the gateway's two-hash form) for these strings.
 */
export async function askPublicly(opts: { request: string; onStage?: (s: Stage) => void }): Promise<EvidenceBundle> {
  const model = requestModel(opts.request);
  if (model !== POLICY_MODEL) throw new Error("Only Kite's policy model is used for public analyses.");
  const c = await publicClient();
  opts.onStage?.("verify");
  await c.verify(POLICY_MODEL);
  opts.onStage?.("ask");
  const res = await c.fetch(new URL("chat/completions", c.getBaseUrl()).toString(), { method: "POST", headers: { "content-type": "application/json" }, body: opts.request });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(res.status === 503 ? "NEAR AI isn't configured on this deployment." : res.status === 429 ? "Too many requests. Try again in a few minutes." : `NEAR AI answered with an error (${res.status}).`);
  const response = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const completionId = String((JSON.parse(response) as { id?: unknown }).id ?? "");
  if (!completionId) throw new Error("NEAR AI's answer has no completion id.");
  opts.onStage?.("sign");
  // Checks the signature against the attestation the request was routed to, and returns the signature itself.
  const s = ((await c.verifyResponse(completionId)) as unknown as SignedResult).signature;
  const bundle: EvidenceBundle = {
    v: 1,
    kind: s.kind,
    model,
    completionId,
    request: opts.request,
    response,
    signature: s.signature,
    signingAddress: s.signer.signingAddress,
    signingAlgo: s.signer.signingAlgo,
    signedText: s.signedText,
  };
  // The SDK signed over the bytes it sent and received; make sure those are the strings kept here.
  if ((await expectedSignedText(bundle)) !== bundle.signedText) throw new Error("The signed bytes don't match the request and answer kept here, so they can't be used as evidence.");
  return bundle;
}

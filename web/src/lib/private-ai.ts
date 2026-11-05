"use client";

/**
 * One private question to NEAR AI Cloud, from the browser.
 * Verify the model's attestation, encrypt the message to it, get a signed answer, check the signature.
 * The SDK throws if any step fails, so a returned receipt means every step passed.
 */
import { PLANNER_MODEL } from "./planner";

export type Stage = "verify" | "ask" | "sign";
export type Receipt = { model: string; completionId: string; signatureKind: "provider_tee" | "gateway"; modelReports: number; verifiedAt: number };

type Client = InstanceType<typeof import("@nearai/inference-sdk").InferenceClient>;
let clientP: Promise<Client> | null = null;
let attestP: Promise<Awaited<ReturnType<Client["verify"]>>> | null = null;

/** One client per page load, so the attestation check (the slow part) is done once and reused. */
function client(): Promise<Client> {
  clientP ??= import("@nearai/inference-sdk").then(({ InferenceClient }) => new InferenceClient({ baseUrl: `${window.location.origin}/api/nearai/v1`, e2ee: true }));
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

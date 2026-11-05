"use client";

/**
 * One private question to NEAR AI Cloud, from the browser.
 * Verify the model's attestation, encrypt the message to it, get a signed answer, check the signature.
 * The SDK throws if any step fails, so a returned receipt means every step passed.
 */
import { PLANNER_MODEL } from "./planner";

export type Stage = "verify" | "ask" | "sign";
export type Receipt = { model: string; completionId: string; signatureKind: "provider_tee" | "gateway"; modelReports: number; verifiedAt: number };

export async function askPrivately(opts: {
  system: string;
  user: string;
  schema: { name: string; strict: boolean; schema: unknown };
  maxTokens?: number;
  onStage?: (s: Stage) => void;
}): Promise<{ data: unknown; receipt: Receipt }> {
  const { InferenceClient } = await import("@nearai/inference-sdk");
  const client = new InferenceClient({ baseUrl: `${window.location.origin}/api/nearai/v1`, e2ee: true });
  opts.onStage?.("verify");
  const att = await client.verify(PLANNER_MODEL);
  opts.onStage?.("ask");
  const completion = await client.chat.completions.create({
    model: PLANNER_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 1500,
    response_format: { type: "json_schema", json_schema: opts.schema as never },
  });
  opts.onStage?.("sign");
  const verified = await client.verifyResponse(completion.id);
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

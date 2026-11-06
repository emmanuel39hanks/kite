/**
 * The two checks that need NEAR AI's SDK, kept apart from the pure verifier so it can be tested without them.
 *
 * signature: the SDK's own `verifyModelResponse` / `verifyGatewayResponse` over the bundle's exact bytes. They take
 * a verified attestation only to compare its signer with the signature's; here that comparison is done separately
 * (by `attested`, against a report verified today), so the signer passed in is the bundle's own.
 *
 * attested: fetch NEAR AI's current report for that signing address (through Kite's relay, which adds the API key)
 * and verify it with `verifyModelAttestation` (Intel TDX quote, measurements, GPU evidence when present). Keys
 * rotate when NEAR AI redeploys, so a key that isn't reported any more is "can't confirm today", not a failure.
 */
import type { CheckState, SdkChecks } from "@/lib/ai/verify-policy";
import type { EvidenceBundle } from "@/lib/ai/evidence";

const sameHex = (a: string, b: string) => a.replace(/^0x/i, "").toLowerCase() === b.replace(/^0x/i, "").toLowerCase();

const sdk = () => import("@nearai/inference-sdk");

const asSignature = (b: EvidenceBundle) => ({ kind: b.kind, signedText: b.signedText, signature: b.signature, signer: { signingAlgo: b.signingAlgo, signingAddress: b.signingAddress } });

/** Signature check alone. Works in Node too, which the tests use. */
export async function checkSignature(b: EvidenceBundle): Promise<void> {
  const { verifyModelResponse, verifyGatewayResponse } = await sdk();
  const enc = new TextEncoder();
  const params = {
    requestBody: enc.encode(b.request),
    responseBody: enc.encode(b.response),
    signature: asSignature(b),
    // Only `.signer` is read; the real attestation check is `attested` below.
    attestation: { signer: asSignature(b).signer } as never,
  };
  if (b.kind === "provider_tee") verifyModelResponse(params);
  else verifyGatewayResponse(params);
}

const code = (e: unknown) => {
  const f = (e as { failure?: { code?: string } })?.failure?.code;
  return f ?? (e instanceof Error ? e.message : String(e));
};

export function sdkChecks(baseUrl: string): SdkChecks {
  return {
    signature: checkSignature,
    async attested(b): Promise<{ state: CheckState; reason: string }> {
      const { AttestationClient, verifyModelAttestation, verifyGatewayAttestation } = await sdk();
      const client = new AttestationClient({ baseUrl });
      if (b.kind === "gateway") {
        let fetched;
        try {
          fetched = await client.fetchGatewayAttestation({ signingAlgo: b.signingAlgo });
        } catch (e) {
          return { state: "unknown", reason: `Can't confirm today: NEAR AI's gateway report couldn't be fetched (${code(e)}).` };
        }
        try {
          const g = await verifyGatewayAttestation({ attestation: fetched.attestation, clientBinding: fetched.clientBinding });
          return sameHex(g.signer.signingAddress, b.signingAddress)
            ? { state: "pass", reason: `The gateway's key is in its TEE report, verified here today (TCB ${g.tcbStatus}). This proves the gateway saw these bytes, not which hardware ran the model.` }
            : { state: "unknown", reason: "Can't confirm today: the gateway reports a different key now. Its key may have rotated since the analysis." };
        } catch (e) {
          return { state: "fail", reason: `NEAR AI's gateway report failed verification: ${code(e)}.` };
        }
      }
      let fetched;
      try {
        fetched = await client.fetchModelAttestations({ model: b.model, signingAlgo: b.signingAlgo, signingAddress: b.signingAddress });
      } catch (e) {
        return { state: "unknown", reason: `Can't confirm today: NEAR AI didn't return a report for this key (${code(e)}). It may have rotated since the analysis.` };
      }
      const mine = fetched.attestations.filter((a) => sameHex(a.signer.signingAddress, b.signingAddress) && a.signer.signingAlgo === b.signingAlgo);
      if (!mine.length) return { state: "unknown", reason: "Can't confirm today: NEAR AI no longer reports this key. It may have rotated since the analysis." };
      try {
        const v = await verifyModelAttestation({ attestation: mine[0], clientBinding: fetched.clientBinding });
        if (!sameHex(v.signer.signingAddress, b.signingAddress)) return { state: "fail", reason: "The verified report is for a different key." };
        return { state: "pass", reason: `This key is in a ${b.model} TEE report, verified here today (Intel TDX quote, TCB ${v.tcbStatus}${v.gpuEvidence === "verified" ? ", NVIDIA GPU evidence" : ""}).` };
      } catch (e) {
        return { state: "fail", reason: `NEAR AI returned a report for this key, but it failed verification: ${code(e)}.` };
      }
    },
  };
}

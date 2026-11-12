/**
 * Evidence that a piece of text came from NEAR AI's attested model and wasn't edited.
 *
 * A public analysis (a DAO's treasury policy) is sent WITHOUT end-to-end encryption, so the bytes the
 * model signs are the plain request and answer, which any voter can re-hash. The bundle keeps those exact
 * bytes next to the signature NEAR AI returns for the completion id.
 *
 * How the model signs (checked in @nearai/inference-sdk 0.2.1, `modelSignatureText` and `gatewaySignatureText`):
 *   provider_tee: "<model>:<sha256 hex of request bytes>:<sha256 hex of response bytes>", model read from the request
 *   gateway:      "<sha256 hex of request bytes>:<sha256 hex of response bytes>"
 * signed with ed25519 (signing address = the 32-byte public key) or ECDSA (an Ethereum-style address).
 *
 * Pure code: no SDK, no network. It runs in the browser and under `node --test`.
 */

export type EvidenceBundle = {
  v: 1;
  /** Who signed: the model's TEE (`provider_tee`) or only NEAR AI's gateway. */
  kind: "provider_tee" | "gateway";
  model: string;
  completionId: string;
  /** The exact request body string sent to /v1/chat/completions. */
  request: string;
  /** The exact response body string received. */
  response: string;
  signature: string;
  signingAddress: string;
  signingAlgo: "ed25519" | "ecdsa";
  signedText: string;
};

export const EVIDENCE_PREFIX = "kite-evidence:v1:";
/** A decoded bundle larger than this is refused (a gzip bomb would otherwise expand without limit). */
const MAX_BUNDLE_BYTES = 256_000;

/** JSON with object keys sorted at every level and no whitespace, so the same value always gives the same bytes. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Not representable in JSON");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Deep equality on JSON values, ignoring key order. */
export const sameJson = (a: unknown, b: unknown) => {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
};

const enc = new TextEncoder();

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The vault's `policy_ref`: sha256 of the bundle's canonical JSON. 64 lowercase hex characters, as the contract requires. */
export const policyRefOf = (b: EvidenceBundle) => sha256Hex(canonicalJson(b));

/** The model id the signature covers: the `model` field of the exact request bytes. */
export function requestModel(request: string): string | null {
  try {
    const m = (JSON.parse(request) as { model?: unknown }).model;
    return typeof m === "string" && m ? m : null;
  } catch {
    return null;
  }
}

/** What NEAR AI's signer should have signed for these bytes, or null if the request has no model. */
export async function expectedSignedText(b: Pick<EvidenceBundle, "kind" | "request" | "response">): Promise<string | null> {
  const [hq, hr] = await Promise.all([sha256Hex(b.request), sha256Hex(b.response)]);
  if (b.kind === "gateway") return `${hq}:${hr}`;
  const model = requestModel(b.request);
  return model ? `${model}:${hq}:${hr}` : null;
}

/** Shape check on an untrusted bundle. Throws a plain-English error. */
export function asBundle(raw: unknown): EvidenceBundle {
  const b = raw as Record<string, unknown>;
  const str = (k: string) => typeof b?.[k] === "string" && (b[k] as string).length > 0;
  if (!b || typeof b !== "object" || b.v !== 1) throw new Error("The evidence isn't a version 1 Kite bundle.");
  if (b.kind !== "provider_tee" && b.kind !== "gateway") throw new Error("The evidence names an unknown signer kind.");
  if (b.signingAlgo !== "ed25519" && b.signingAlgo !== "ecdsa") throw new Error("The evidence names an unknown signing algorithm.");
  for (const k of ["model", "completionId", "request", "response", "signature", "signingAddress", "signedText"]) if (!str(k)) throw new Error(`The evidence is missing ${k}.`);
  if (!/^(0x)?[0-9a-fA-F]+$/.test(b.signature as string) || !/^(0x)?[0-9a-fA-F]+$/.test(b.signingAddress as string)) throw new Error("The evidence's signature or signing address isn't hex.");
  const extra = Object.keys(b).filter((k) => !["v", "kind", "model", "completionId", "request", "response", "signature", "signingAddress", "signingAlgo", "signedText"].includes(k));
  if (extra.length) throw new Error("The evidence has fields Kite doesn't know.");
  return b as unknown as EvidenceBundle;
}

/* ───────────── the evidence line ───────────── */

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, max = Infinity): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = out.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      throw new Error("The evidence is too large.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return all;
}

/** `kite-evidence:v1:<base64url of gzip(canonical JSON of the bundle)>` */
export async function encodeEvidenceLine(b: EvidenceBundle): Promise<string> {
  return EVIDENCE_PREFIX + toBase64Url(await pipe(enc.encode(canonicalJson(b)), new CompressionStream("gzip")));
}

/** Length of base64url(gzip(text)): what a string adds to an evidence line. */
export async function compressedLength(text: string): Promise<number> {
  return toBase64Url(await pipe(enc.encode(text), new CompressionStream("gzip"))).length;
}

/** The last evidence line in a text, decoded and shape-checked. Throws a plain-English error. */
export async function decodeEvidenceLine(text: string): Promise<EvidenceBundle> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(EVIDENCE_PREFIX));
  const line = lines.at(-1);
  if (!line) throw new Error("No kite-evidence line found.");
  const body = line.slice(EVIDENCE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error("The evidence line isn't base64url.");
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(await pipe(fromBase64Url(body), new DecompressionStream("gzip"), MAX_BUNDLE_BYTES));
  } catch (e) {
    throw new Error(e instanceof Error && e.message.includes("too large") ? e.message : "The evidence line doesn't decompress.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("The evidence isn't JSON.");
  }
  return asBundle(raw);
}

/** Split a description into what voters read and the evidence line (the last line). */
export function splitDescription(description: string): { body: string; line: string | null } {
  const text = description.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const i = text.lastIndexOf("\n");
  const last = (i < 0 ? text : text.slice(i + 1)).trim();
  if (!last.startsWith(EVIDENCE_PREFIX)) return { body: text, line: null };
  return { body: i < 0 ? "" : text.slice(0, i), line: last };
}

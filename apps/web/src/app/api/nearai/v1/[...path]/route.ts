import { connection } from "next/server";
import { PLANNER_MODEL, POLICY_MODEL } from "@/lib/ai/planner";
import { policyPrompt } from "@/lib/ai/policy";

/** The only models relayed, each with its own output cap: the quick planner, and the stronger model for DAO policies. */
const MODEL_CAPS: Record<string, number> = { [PLANNER_MODEL]: 4000, [POLICY_MODEL]: 1500 };
const allowedModel = (m: unknown): m is string => typeof m === "string" && Object.hasOwn(MODEL_CAPS, m);
import { clientIp, crossSite, limited, refuseCrossSite } from "@/lib/server/guards";

/**
 * A thin relay to NEAR AI Cloud for the private plan builder.
 *
 * The browser verifies NEAR AI's hardware attestation itself and encrypts the
 * user's message to the attested model key (end-to-end). This route only adds
 * Kite's API key and forwards bytes unchanged, so it never sees the plaintext:
 * request and response bodies, and the encryption headers, pass through as-is,
 * which is also what lets the browser check the model's signature over them.
 *
 * One exception, on purpose: a DAO's treasury policy is public, so it is sent
 * without E2EE (its signed bytes must be readable by every voter), and this
 * route sees that request in plain text. The public /verify page uses only the
 * GET routes: the attestation report and the signature for a completion id.
 */
const UPSTREAM = "https://cloud-api.near.ai/v1";
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^model\/[^/]+$/ },
  { method: "GET", path: /^attestation\/report$/ },
  { method: "POST", path: /^chat\/completions$/ },
  { method: "GET", path: /^signature\/[A-Za-z0-9_-]+$/ },
];
const DROP_REQ = new Set(["host", "authorization", "cookie", "connection", "content-length", "accept-encoding", "origin", "referer", "user-agent", "x-api-key", "api-key", "forwarded", "via", "x-real-ip"]);
// Platform and proxy headers never go upstream next to Kite's key.
const DROP_PREFIX = ["x-forwarded-", "x-vercel-", "x-middleware-", "sec-", "proxy-", "cf-"];
const MAX_TOKENS = 4000;
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]);

/** The top-level keys of a JSON object, read straight from the text (JSON.parse hides duplicates). null if it isn't an object. */
function topLevelKeys(text: string): string[] | null {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i < n && /\s/.test(text[i])) i++;
  if (text[i] !== "{") return null;
  let expectKey = false;
  for (; i < n; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (depth === 1 && expectKey) keys.push(text.slice(i + 1, j));
      expectKey = false;
      i = j;
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1 && c === "{") expectKey = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) expectKey = true;
  }
  return keys;
}

async function relay(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await connection();
  if (req.method === "POST" && crossSite(req)) return refuseCrossSite();
  const key = process.env.NEARAI_API_KEY;
  if (!key) return Response.json({ error: "The private plan builder isn't configured on this deployment (NEARAI_API_KEY)." }, { status: 503 });
  const { path } = await ctx.params;
  // Keep the model id URL-encoded exactly as the SDK sent it.
  const raw = new URL(req.url).pathname.split("/api/nearai/v1/")[1] ?? path.join("/");
  if (!ALLOWED.some((a) => a.method === req.method && a.path.test(raw))) return Response.json({ error: "Not allowed" }, { status: 404 });
  if (limited(`ai:${clientIp(req)}`, 60, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  let body: ArrayBuffer | undefined;
  if (req.method === "POST") {
    body = await req.arrayBuffer();
    if (body.byteLength > 64_000) return Response.json({ error: "Too large" }, { status: 413 });
    // The model name stays readable under E2EE; only Kite's planner model is relayed.
    try {
      const text = new TextDecoder().decode(body);
      // The body can't be re-serialised (the browser checks signatures over its exact bytes), so refuse
      // ambiguous ones: a repeated or escaped top-level key could be read differently upstream.
      const keys = topLevelKeys(text);
      if (!keys || new Set(keys).size !== keys.length || keys.some((k) => k.includes("\\"))) return Response.json({ error: "Bad request" }, { status: 400 });
      const j = JSON.parse(text) as Record<string, unknown>;
      if (!allowedModel(j.model)) return Response.json({ error: "Model not allowed" }, { status: 403 });
      // A cost cap that can't be skipped: a sane max_tokens is required, and the multipliers are refused.
      const mt = j.max_tokens;
      const cap = Math.min(MAX_TOKENS, MODEL_CAPS[j.model]);
      if (!(typeof mt === "number" && Number.isInteger(mt) && mt > 0 && mt <= cap)) return Response.json({ error: `max_tokens required (up to ${cap})` }, { status: 400 });
      if ("max_completion_tokens" in j || "best_of" in j || "tools" in j || (j.n !== undefined && j.n !== 1)) return Response.json({ error: "Not allowed" }, { status: 400 });
      // The stronger model is only for DAO policies: Kite's own system prompt and one message of facts, in the clear.
      if (j.model === POLICY_MODEL) {
        const m = j.messages as { role?: unknown; content?: unknown }[] | undefined;
        if (!Array.isArray(m) || m.length !== 2 || m[0]?.role !== "system" || m[0]?.content !== policyPrompt || m[1]?.role !== "user" || typeof m[1]?.content !== "string")
          return Response.json({ error: "This model only answers Kite's policy prompt" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
  }
  if (raw.startsWith("model/")) {
    let id = "";
    try {
      id = decodeURIComponent(raw.slice(6));
    } catch {}
    if (!allowedModel(id)) return Response.json({ error: "Model not allowed" }, { status: 403 });
  }
  // Model reports are fetched with Kite's key too, so only for Kite's model. The gateway's own report names no model.
  const reportModels = new URL(req.url).searchParams.getAll("model");
  if (raw === "attestation/report" && (reportModels.length > 1 || (reportModels.length === 1 && !allowedModel(reportModels[0])))) return Response.json({ error: "Model not allowed" }, { status: 403 });

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    const name = k.toLowerCase();
    if (!DROP_REQ.has(name) && !DROP_PREFIX.some((x) => name.startsWith(x))) headers.set(k, v);
  });
  headers.set("authorization", `Bearer ${key}`);
  headers.set("accept-encoding", "identity");

  let up: Response;
  try {
    up = await fetch(`${UPSTREAM}/${raw}${new URL(req.url).search}`, { method: req.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(90_000) });
  } catch {
    return Response.json({ error: "NEAR AI didn't answer in time." }, { status: 504 });
  }
  const out = new Headers();
  up.headers.forEach((v, k) => {
    if (!DROP_RES.has(k.toLowerCase())) out.set(k, v);
  });
  return new Response(up.body, { status: up.status, headers: out });
}

export const GET = relay;
export const POST = relay;

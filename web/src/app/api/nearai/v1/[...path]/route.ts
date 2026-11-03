import { connection } from "next/server";
import { PLANNER_MODEL } from "@/lib/planner";

/**
 * A thin relay to NEAR AI Cloud for the private plan builder.
 *
 * The browser verifies NEAR AI's hardware attestation itself and encrypts the
 * user's message to the attested model key (end-to-end). This route only adds
 * Kite's API key and forwards bytes unchanged, so it never sees the plaintext:
 * request and response bodies, and the encryption headers, pass through as-is,
 * which is also what lets the browser check the model's signature over them.
 */
const UPSTREAM = "https://cloud-api.near.ai/v1";
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^model\/[^/]+$/ },
  { method: "GET", path: /^attestation\/report$/ },
  { method: "POST", path: /^chat\/completions$/ },
  { method: "GET", path: /^signature\/[A-Za-z0-9_-]+$/ },
];
const DROP_REQ = new Set(["host", "authorization", "cookie", "connection", "content-length", "accept-encoding", "origin", "referer"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]);

// Small per-visitor limit so the relay can't be used to spend Kite's credits.
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 60;
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

async function relay(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  await connection();
  const key = process.env.NEARAI_API_KEY;
  if (!key) return Response.json({ error: "The private plan builder isn't configured on this deployment (NEARAI_API_KEY)." }, { status: 503 });
  const { path } = await ctx.params;
  // Keep the model id URL-encoded exactly as the SDK sent it.
  const raw = new URL(req.url).pathname.split("/api/nearai/v1/")[1] ?? path.join("/");
  if (!ALLOWED.some((a) => a.method === req.method && a.path.test(raw))) return Response.json({ error: "Not allowed" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  let body: ArrayBuffer | undefined;
  if (req.method === "POST") {
    body = await req.arrayBuffer();
    if (body.byteLength > 64_000) return Response.json({ error: "Too large" }, { status: 413 });
    // The model name stays readable under E2EE; only Kite's planner model is relayed.
    try {
      const j = JSON.parse(new TextDecoder().decode(body)) as { model?: string; stream?: boolean };
      if (j.model !== PLANNER_MODEL) return Response.json({ error: "Model not allowed" }, { status: 403 });
    } catch {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
  }
  if (raw.startsWith("model/") && decodeURIComponent(raw.slice(6)) !== PLANNER_MODEL) return Response.json({ error: "Model not allowed" }, { status: 403 });

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQ.has(k.toLowerCase())) headers.set(k, v);
  });
  headers.set("authorization", `Bearer ${key}`);
  headers.set("accept-encoding", "identity");

  const up = await fetch(`${UPSTREAM}/${raw}${new URL(req.url).search}`, { method: req.method, headers, body, cache: "no-store" });
  const out = new Headers();
  up.headers.forEach((v, k) => {
    if (!DROP_RES.has(k.toLowerCase())) out.set(k, v);
  });
  return new Response(up.body, { status: up.status, headers: out });
}

export const GET = relay;
export const POST = relay;

import { timingSafeEqual } from "node:crypto";

/** A Kite vault id: kite.<owner>, where owner is a NEAR account (named or implicit). No empty or dotted-over labels. */
export const isKiteVault = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 64 && /^kite\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s);

/** Any NEAR account id (2-64 chars, labels separated by single dots/dashes/underscores). */
export const isNearAccount = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 2 && s.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s);

/** Constant-time string compare. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The vaults the server is allowed to act on for real (KITE_VAULTS, comma-separated). */
export const allowedVaults = () => (process.env.KITE_VAULTS ?? "").split(",").map((v) => v.trim()).filter(Boolean);

// A small in-memory limiter. Per server instance, so it is a best-effort guard, not a hard cap.
const buckets = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size <= 4000) break; }
  return recent.length > max;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

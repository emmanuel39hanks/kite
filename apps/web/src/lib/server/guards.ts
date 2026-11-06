import "server-only";
import { timingSafeEqual } from "node:crypto";
import { isFactoryVault } from "@/lib/near/factory-names";

/** A Kite vault id: kite.<owner> (made from a wallet), or <name>.<factory> (made by Kite's vault factory). */
export const isKiteVault = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 64 && (/^kite\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s) || isFactoryVault(s));

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
  if (recent.length <= max) recent.push(now); // a blocked key stops growing
  buckets.delete(key); // re-insert so the oldest-touched keys are the ones evicted
  buckets.set(key, recent);
  if (buckets.size > 5000) for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size <= 4000) break; }
  return recent.length > max;
}

/** True for a browser request that comes from another website. A page on any site can fire a POST at ours from each of its visitors, each with their own IP, so a per-IP limit alone does not stop it. */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // not a browser form/fetch; the per-IP limit still applies
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const refuseCrossSite = () => Response.json({ error: "Cross-site request refused" }, { status: 403 });

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

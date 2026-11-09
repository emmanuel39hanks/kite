/**
 * One NEAR RPC client for the whole app that survives a busy server. Free public RPCs cap requests per IP (FastNEAR
 * answers 429 "Rate limits exceeded"), and a withdrawal alone makes a burst of reads. When a server is busy or
 * unreachable, the call moves on to the next one. Any other answer, such as "account does not exist" or a contract
 * panic, is the chain's real reply and is passed straight through, so callers see exactly what they did before.
 */
import { JsonRpcProvider } from "near-api-js";
import { NEAR } from "./config";

/** Busy or unreachable: worth asking another server. Everything else is a real answer. */
export function isBusy(e: unknown): boolean {
  if (e instanceof SyntaxError) return true; // an HTML error page where JSON was expected
  const cause = (e as { cause?: unknown } | null)?.cause;
  if (typeof cause === "number" && [408, 429, 500, 502, 503, 504].includes(cause)) return true;
  const s = e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : JSON.stringify(e ?? "");
  return /\b429\b|rate limit|too many requests|exceeded \d+ attempts|fetch failed|failed to fetch|networkerror|load failed|econn|etimedout|timed? ?out|\b50[0234]\b|bad gateway|unavailable|internal server error/i.test(s);
}

let preferred = 0;
let preferredSince = 0;
/** Go back to the first server after this long, so one bad minute doesn't pin the app to a fallback. */
const RETURN_MS = 5 * 60_000;

/** A drop-in for `new JsonRpcProvider(...)` that fails over across NEAR.rpcs. */
export function nearProvider(): JsonRpcProvider {
  const all = NEAR.rpcs.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 300 }));
  return new Proxy(all[0], {
    get(_target, prop) {
      const first = Reflect.get(all[0], prop);
      if (typeof first !== "function") return first;
      return async (...args: unknown[]) => {
        if (preferred !== 0 && Date.now() - preferredSince > RETURN_MS) preferred = 0;
        let last: unknown;
        for (let n = 0; n < all.length; n++) {
          const i = (preferred + n) % all.length;
          try {
            const r = await (Reflect.get(all[i], prop) as (...a: unknown[]) => unknown).apply(all[i], args);
            if (preferred !== i) preferredSince = Date.now();
            preferred = i;
            return r;
          } catch (e) {
            if (!isBusy(e)) throw e;
            last = e;
          }
        }
        throw last;
      };
    },
  });
}

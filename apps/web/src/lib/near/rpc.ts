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
  const s = e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : JSON.stringify(e ?? "");
  return /\b429\b|rate limit|too many requests|exceeded \d+ attempts|fetch failed|failed to fetch|networkerror|load failed|econn|etimedout|timed? ?out|\b50[234]\b|bad gateway|service unavailable/i.test(s);
}

let preferred = 0;

/** A drop-in for `new JsonRpcProvider(...)` that fails over across NEAR.rpcs. */
export function nearProvider(): JsonRpcProvider {
  const all = NEAR.rpcs.map((url) => new JsonRpcProvider({ url }));
  return new Proxy(all[0], {
    get(_target, prop) {
      const first = Reflect.get(all[0], prop);
      if (typeof first !== "function") return first;
      return async (...args: unknown[]) => {
        let last: unknown;
        for (let n = 0; n < all.length; n++) {
          const i = (preferred + n) % all.length;
          try {
            const r = await (Reflect.get(all[i], prop) as (...a: unknown[]) => unknown).apply(all[i], args);
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

/**
 * NearBlocks hands back call arguments as JSON text whose string fields can themselves be JSON, escaped once or
 * several times over (a signed 1Click quote inside `rebalance` comes back as {\\\"amount\\\":…}). Unwrap until an
 * object or array appears; null if it never does.
 */
export function deepJson(v: unknown): unknown {
  let cur: unknown = v;
  for (let i = 0; i < 8 && typeof cur === "string"; i++) {
    const s: string = cur;
    try {
      cur = JSON.parse(s);
    } catch {
      const unescaped = s.replace(/\\(["\\/])/g, "$1");
      if (unescaped === s) return null;
      cur = unescaped;
    }
  }
  return typeof cur === "object" ? cur : null;
}

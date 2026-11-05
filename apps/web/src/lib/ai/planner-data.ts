import type { History } from "@/lib/market/market";

export type AssetStats = { ret30: number; ret90: number; volYear: number; maxDrawdown: number; corrBtc: number };

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Per-asset facts from real daily closes. All arithmetic happens here; the model only reads the table. */
export function assetStats(h: History): Record<string, AssetStats> {
  const out: Record<string, AssetStats> = {};
  const rets = (p: number[]) => p.slice(1).map((v, i) => v / p[i] - 1);
  const btc = h.prices.btc ? rets(h.prices.btc) : [];
  for (const [id, p] of Object.entries(h.prices)) {
    if (!p || p.length < 40) continue;
    const r = rets(p);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
    let peak = p[0];
    let mdd = 0;
    for (const v of p) {
      peak = Math.max(peak, v);
      mdd = Math.max(mdd, 1 - v / peak);
    }
    const n = Math.min(r.length, btc.length);
    const mb = btc.slice(-n).reduce((a, b) => a + b, 0) / n;
    const mr = r.slice(-n).reduce((a, b) => a + b, 0) / n;
    let cov = 0, vb = 0, vr = 0;
    for (let i = 0; i < n; i++) {
      const x = btc[btc.length - n + i] - mb;
      const y = r[r.length - n + i] - mr;
      cov += x * y; vb += x * x; vr += y * y;
    }
    const last = p.length - 1;
    out[id] = {
      ret30: r1((p[last] / p[Math.max(0, last - 30)] - 1) * 100),
      ret90: r1((p[last] / p[Math.max(0, last - 90)] - 1) * 100),
      volYear: r1(sd * Math.sqrt(365) * 100),
      maxDrawdown: r1(mdd * 100),
      corrBtc: vb > 0 && vr > 0 ? Math.round((cov / Math.sqrt(vb * vr)) * 100) / 100 : 0,
    };
  }
  return out;
}

/** Every number the model was given. A cited number that isn't one of these is dropped. */
export function allowedNumbers(stats: Record<string, AssetStats>, extra: number[] = []): Set<string> {
  const s = new Set<string>(extra.map(String));
  for (const a of Object.values(stats))
    for (const v of Object.values(a)) {
      s.add(String(v));
      s.add(String(Math.abs(v)));
    }
  return s;
}

import type { LogoId } from "@/lib/assets";

export type Slice = { id: LogoId; weight: number; color: string };

const COLORS: Partial<Record<LogoId, string>> = {
  btc: "#F7931A",
  eth: "#627EEA",
  sol: "#9945FF",
  near: "#00C08B",
  xaut: "#D4A537",
  usdc: "#2775CA",
  stnear: "#00C08B",
  wsteth: "#627EEA",
  gtusdc: "#2775CA",
  ksol: "#9945FF",
  xrp: "#23292F",
  doge: "#C2A633",
  ada: "#246DD3",
  trx: "#C4342B",
  link: "#2E61DE",
  ltc: "#345D9D",
  sui: "#4BA2FF",
  zec: "#ECB244",
  bch: "#58BE92",
  aave: "#9391F7",
  uni: "#FF0A6F",
  usdt: "#009393",
};

export const slice = (id: LogoId, weight: number): Slice => ({ id, weight, color: COLORS[id] ?? "#999" });

/** The vault funds a plan in one call of at most eight swaps, so a plan holds at most eight assets. */
export const MAX_ASSETS = 8;

/** Split 100 evenly, keeping order. */
export function evenly(m: Slice[]): Slice[] {
  if (!m.length) return m;
  const base = Math.floor(100 / m.length);
  return m.map((s, i) => ({ ...s, weight: base + (i < 100 - base * m.length ? 1 : 0) }));
}

/** Set one share and move the others proportionally, so the total always stays 100. */
export function rebalance(m: Slice[], id: LogoId, v: number): Slice[] {
  const target = Math.max(1, Math.min(100 - (m.length - 1), Math.round(v)));
  const others = m.filter((s) => s.id !== id);
  const rest = 100 - target;
  const otherSum = others.reduce((a, s) => a + s.weight, 0);
  // Proportional split with a 1% floor, then hand rounding leftovers to the largest.
  const raw = others.map((s) => Math.max(1, otherSum > 0 ? (s.weight / otherSum) * rest : rest / others.length));
  const floored = raw.map(Math.floor);
  let left = rest - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left !== 0 && j < order.length * 4; j++) {
    const i = order[j % order.length][1];
    if (left > 0) {
      floored[i]++;
      left--;
    } else if (floored[i] > 1) {
      floored[i]--;
      left++;
    }
  }
  let o = 0;
  return m.map((s) => (s.id === id ? { ...s, weight: target } : { ...s, weight: floored[o++] }));
}

/** A mix the vault accepts: two to eight assets, each at least 1%, adding up to 100. */
export const mixValid = (m: Slice[]) => m.length >= 2 && m.length <= MAX_ASSETS && m.every((s) => s.weight >= 1) && m.reduce((a, s) => a + s.weight, 0) === 100;

import { cacheLife } from "next/cache";
import type { EarnId } from "@/lib/assets";

type Yield = { apy: number; source: string; url: string };
export type Yields = Partial<Record<EarnId, Yield>>;

const get = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "user-agent": "kite", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

/**
 * Live yields, straight from each protocol's public API (no keys). Cached for an hour.
 * A source that fails is left out rather than guessed.
 */
export async function getYields(): Promise<Yields> {
  "use cache";
  cacheLife("hours");
  const out: Yields = {};
  const jobs: [EarnId, () => Promise<Yield>][] = [
    [
      "stnear",
      async () => ({ apy: Number((await get("https://validators.narwallets.com/metrics_json")).st_near_30_day_apy), source: "Meta Pool, 30-day", url: "https://metapool.app" }),
    ],
    [
      "wsteth",
      async () => {
        // Median of Lido's 7-day series: one-off spikes (a 15% day) would skew the mean.
        const d = await get("https://eth-api.lido.fi/v1/protocol/steth/apr/sma");
        return { apy: median((d.data.aprs as { apr: number }[]).map((a) => a.apr)), source: "Lido, 7-day median", url: "https://lido.fi" };
      },
    ],
    [
      "gtusdc",
      async () => {
        const q = '{ vaultByAddress(address: "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61", chainId: 8453) { state { netApy } } }';
        const d = await get("https://blue-api.morpho.org/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
        return { apy: Number(d.data.vaultByAddress.state.netApy) * 100, source: "Morpho, net", url: "https://app.morpho.org/base/vault/0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61" };
      },
    ],
    [
      "ksol",
      async () => ({
        apy: Number((await get("https://api.kamino.finance/kvaults/DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg/metrics")).apy30d) * 100,
        source: "Kamino, 30-day",
        url: "https://app.kamino.finance",
      }),
    ],
  ];
  await Promise.all(
    jobs.map(async ([id, fn]) => {
      try {
        const y = await fn();
        if (Number.isFinite(y.apy) && y.apy > 0 && y.apy < 50) out[id] = y;
      } catch {}
    }),
  );
  return out;
}

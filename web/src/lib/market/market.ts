import { cacheLife } from "next/cache";
import { ASSETS } from "@/lib/assets";
import { getLivePrices } from "@/lib/server/oneclick";
import { getYields } from "@/lib/market/yields";

/** CoinGecko ids, as listed by NEAR Intents 1Click /tokens (coingeckoId). */
const GECKO: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  near: "near",
  xaut: "tether-gold",
  usdc: "usd-coin",
};

export type Quote = { price: number; change24h: number | null };
export type Market = { quotes: Record<string, Quote>; updatedAt: string; source: string };

/** Live prices from NEAR Intents, 24h change from CoinGecko. Cached for a minute. */
export async function getMarket(): Promise<Market> {
  "use cache";
  cacheLife("minutes");
  const live = await getLivePrices();
  let changes: Record<string, number> = {};
  try {
    const ids = Object.values(GECKO).join(",");
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
    if (r.ok) {
      const d = (await r.json()) as Record<string, { usd: number; usd_24h_change?: number }>;
      changes = Object.fromEntries(Object.entries(GECKO).map(([k, g]) => [k, d[g]?.usd_24h_change ?? NaN]));
    }
  } catch {}
  const quotes: Record<string, Quote> = {};
  for (const a of ASSETS) {
    if (!a.live) continue;
    // An earning version moves with its base asset (plus a sliver of yield).
    const c = changes[a.earn?.base ?? a.id];
    quotes[a.id] = { price: live.prices[a.id] ?? a.price, change24h: Number.isFinite(c) ? c : null };
  }
  return { quotes, updatedAt: live.updatedAt ?? new Date().toISOString(), source: live.source };
}

export type History = { days: number; dates: number[]; prices: Record<string, number[]> };

/** Daily closing prices for every live asset over `days` (real data: Kraken, CoinGecko fallback). Cached for hours. */
export async function getHistory(days: number): Promise<History> {
  "use cache";
  cacheLife("hours");
  const prices: Record<string, number[]> = {};
  let dates: number[] = [];
  // USDC is pegged, so it's held at $1. Everything else: Kraken daily closes, CoinGecko if Kraken fails.
  const series = await Promise.all(
    Object.keys(GECKO)
      .filter((id) => id !== "usdc")
      .map(async (id) => [id, (await krakenDaily(id, days)) ?? (await geckoDaily(id, days))] as const),
  );
  for (const [id, p] of series) {
    if (!p) throw new Error(`No price history for ${id}`); // errors aren't cached; the next request retries
    prices[id] = p.map((x) => x[1]);
    if (p.length > dates.length) dates = p.map((x) => x[0]);
  }
  // Align every series to the same length (most recent points).
  const n = Math.min(...Object.values(prices).map((p) => p.length), dates.length);
  for (const k of Object.keys(prices)) prices[k] = prices[k].slice(-n);
  prices.usdc = Array(n).fill(1);

  // Earning versions: the base asset's real history × today's exchange rate (from 1Click prices),
  // grown back at today's APY. An estimate: past yields weren't exactly today's.
  const [live, yields] = await Promise.all([getLivePrices(), getYields()]);
  for (const a of ASSETS) {
    if (!a.earn || !prices[a.earn.base]) continue;
    const baseNow = live.prices[a.earn.base];
    const rate = baseNow && live.prices[a.id] ? live.prices[a.id] / baseNow : a.price / (ASSETS.find((b) => b.id === a.earn!.base)?.price ?? 1);
    const apy = (yields[a.id as keyof typeof yields]?.apy ?? 0) / 100;
    prices[a.id] = prices[a.earn.base].map((p, i) => p * rate * Math.pow(1 + apy, -(n - 1 - i) / 365));
  }
  return { days, dates: dates.slice(-n), prices };
}

const KRAKEN: Record<string, string> = { btc: "XBTUSD", eth: "ETHUSD", sol: "SOLUSD", near: "NEARUSD", xaut: "XAUTUSD" };

/** [ms, close] per day from Kraken's public OHLC endpoint (no key). The last row is today so far. */
async function krakenDaily(id: string, days: number): Promise<[number, number][] | null> {
  try {
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[id]}&interval=1440`);
    if (!r.ok) return null;
    const d = (await r.json()) as { error: string[]; result?: Record<string, unknown> };
    const rows = Object.entries(d.result ?? {}).find(([k]) => k !== "last")?.[1] as [number, string, string, string, string][] | undefined;
    if (d.error?.length || !rows || rows.length < days + 1) return null;
    return rows.slice(-(days + 1)).map((row) => [row[0] * 1000, Number(row[4])]);
  } catch {
    return null;
  }
}

async function geckoDaily(id: string, days: number): Promise<[number, number][] | null> {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${GECKO[id]}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
    return r.ok ? ((await r.json()) as { prices: [number, number][] }).prices : null;
  } catch {
    return null;
  }
}

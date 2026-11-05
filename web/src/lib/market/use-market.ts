"use client";

import { useEffect, useState } from "react";
import { ASSETS } from "@/lib/assets";
import type { History, Market, Quote } from "@/lib/market/market";
import type { Slice } from "@/lib/mix";
import type { Yields } from "@/lib/market/yields";

const FALLBACK: Market = {
  quotes: Object.fromEntries(ASSETS.filter((a) => a.live).map((a) => [a.id, { price: a.price, change24h: null }])),
  updatedAt: "",
  source: "fallback",
};

/** Live market, refreshed every minute. */
export function useMarket() {
  const [m, setM] = useState<Market>(FALLBACK);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/market")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Market | null) => alive && d && setM(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const quote = (id: string): Quote => m.quotes[id] ?? { price: ASSETS.find((a) => a.id === id)?.price ?? 0, change24h: null };
  return { ...m, quote, price: (id: string) => quote(id).price };
}

let yieldsCache: Promise<Yields> | null = null;

/** Live APY per earning asset (Meta Pool, Lido, Morpho, Kamino). */
export function useYields() {
  const [y, setY] = useState<Yields>({});
  useEffect(() => {
    let alive = true;
    yieldsCache ??= fetch("/api/yields").then((r) => (r.ok ? r.json() : {}));
    yieldsCache.then((d) => alive && setY(d)).catch(() => (yieldsCache = null));
    return () => {
      alive = false;
    };
  }, []);
  return y;
}

const historyCache = new Map<number, Promise<History>>();

/** Daily real prices for the last `days`. Shared across components. */
export function useHistory(days: number) {
  const [h, setH] = useState<History | null>(null);
  useEffect(() => {
    let alive = true;
    if (!historyCache.has(days)) {
      historyCache.set(
        days,
        fetch(`/api/history?days=${days}`).then((r) => {
          if (!r.ok) throw new Error("history");
          return r.json();
        }),
      );
    }
    historyCache
      .get(days)!
      .then((d) => alive && setH(d))
      .catch(() => historyCache.delete(days));
    return () => {
      alive = false;
    };
  }, [days]);
  return h;
}

/** Value of $start held in a mix, rebalanced back to its weights every day, on real prices. */
export function backtest(h: History, mix: Slice[], start = 1000): number[] {
  const series = mix.map((s) => ({ w: s.weight / 100, p: h.prices[s.id] }));
  if (series.some((s) => !s.p || s.p.length < 2)) return [];
  const n = Math.min(...series.map((s) => s.p.length));
  const out = [start];
  for (let i = 1; i < n; i++) {
    const r = series.reduce((acc, s) => acc + s.w * (s.p[i] / s.p[i - 1] - 1), 0);
    out.push(out[i - 1] * (1 + r));
  }
  return out;
}

/** What the given holdings (units per asset) were worth on each past day. */
export function holdingsValue(h: History, units: Record<string, number>): number[] {
  const ids = Object.keys(units).filter((id) => h.prices[id]);
  if (ids.length === 0) return [];
  const n = Math.min(...ids.map((id) => h.prices[id].length));
  return Array.from({ length: n }, (_, i) => ids.reduce((acc, id) => acc + units[id] * h.prices[id][i], 0));
}

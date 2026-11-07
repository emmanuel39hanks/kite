"use client";

/**
 * Preview mode: the whole Kite flow with no wallet and nothing signed.
 *
 * What's real: live prices (NEAR Intents 1Click /tokens), every swap priced by a
 * real 1Click quote with `dry: true`, real daily price history, and the same
 * rebalance rule the keeper and vault contract use (nextTrade below mirrors
 * packages/keeper/src/drift.ts). What's simulated: the vault itself, which lives in this
 * browser's storage, and a starting wallet of 1,000 USDC and 5 NEAR.
 */

import { useEffect, useState } from "react";
import { assetById } from "@/lib/assets";
import type { History } from "@/lib/market/market";
import type { Slice } from "@/lib/mix";
import type { Guardrails } from "@/lib/store";

export const PREVIEW_ACCOUNT = "you.preview";
export const PREVIEW_VAULT = `kite.${PREVIEW_ACCOUNT}`;
const KEY = "kite-preview:v1";
const EVENT = "kite-preview";

/** Swap cost assumed when replaying the past: 1Click's 0.2% fee (measured on live quotes) plus ~0.1% spread. */
const REPLAY_COST = 0.003;

export type PreviewVault = {
  createdAt: number;
  plan: Slice[];
  guardrails: Guardrails;
  keyActive: boolean;
  paused: boolean;
  /** Units held per asset id (human units). */
  balances: Record<string, number>;
  /** USDC deposited but not yet invested. */
  cash: number;
  /** Net dollars put in (deposits minus withdrawals). */
  invested: number;
  /** Dollars of cost basis per asset. Sums to what's been invested; rebalances carry cost across. */
  cost: Record<string, number>;
  /** Timestamps of Kite's trades, for the per-day limit. */
  trades: number[];
  /** Daily value points, for the chart. */
  series: { t: number; v: number }[];
};

export type PreviewState = { wallet: Record<string, number>; vault: PreviewVault | null };

const FRESH: PreviewState = { wallet: { near: 5, usdc: 1000 }, vault: null };

/** Storage isn't trusted: a malformed saved preview is dropped rather than crashing the page. */
function validPreview(s: PreviewState): boolean {
  const nums = (o: unknown) => !!o && typeof o === "object" && Object.values(o as object).every((n) => typeof n === "number" && Number.isFinite(n));
  if (!s || typeof s !== "object" || !nums(s.wallet)) return false;
  const v = s.vault;
  if (v === null) return true;
  if (!v || !Array.isArray(v.plan) || !v.plan.length || !nums(v.balances) || !nums(v.cost) || !Array.isArray(v.series) || !Array.isArray(v.trades)) return false;
  return v.plan.every((p) => {
    try {
      return typeof p.weight === "number" && !!assetById(p.id as never);
    } catch {
      return false;
    }
  });
}

export function loadPreview(): PreviewState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as PreviewState;
      if (validPreview(s)) return s;
    }
  } catch {}
  return structuredClone(FRESH);
}

export function savePreview(s: PreviewState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function updatePreview(fn: (s: PreviewState) => PreviewState) {
  const next = fn(structuredClone(loadPreview()));
  savePreview(next);
  return next;
}

export function resetPreview() {
  savePreview(structuredClone(FRESH));
}

/** The preview state, re-read whenever it changes. */
export function usePreview(on = true) {
  const [s, setS] = useState<PreviewState | null>(null);
  useEffect(() => {
    if (!on) return;
    const read = () => setS(loadPreview());
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [on]);
  return on ? s : null;
}

export const onPreviewChange = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

/* ───────────── Real 1Click quotes, dry ───────────── */

export type DryQuote = {
  amountIn: string;
  amountOut: string;
  amountInUsd: number;
  amountOutUsd: number;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOut: string;
  timeEstimate: number;
  correlationId: string;
  at: string;
};

const toBase = (units: number, decimals: number) => {
  // Avoid float overflow for 18/24-decimal tokens: scale in two steps.
  const head = Math.min(decimals, 12);
  return (BigInt(Math.floor(units * 10 ** head)) * 10n ** BigInt(decimals - head)).toString();
};
export const fromBase = (base: string, decimals: number) => Number(base) / 10 ** decimals;

export async function dryQuote(from: string, to: string, units: number, decimals: number, origin = false): Promise<DryQuote> {
  const r = await fetch("/api/preview/quote", { method: "POST", body: JSON.stringify({ from, to, amount: toBase(units, decimals), origin }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "No quote from NEAR Intents");
  return d as DryQuote;
}

/** Quote one asset into another, both by our asset id. */
export async function quoteSwap(sell: string, buy: string, units: number) {
  const a = assetById(sell as never);
  const b = assetById(buy as never);
  const q = await dryQuote(a.intentsId!, b.intentsId!, units, a.decimals);
  return { q, out: fromBase(q.amountOut, b.decimals) };
}

/* ───────────── The rebalance rule (mirrors packages/keeper/src/drift.ts and the contract) ───────────── */

type Row = { id: string; target: number; units: number; price: number; value: number; weight: number; drift: number };

export function rowsOf(plan: Slice[], balances: Record<string, number>, price: (id: string) => number) {
  const rows: Row[] = plan.map((s) => {
    const units = balances[s.id] ?? 0;
    const p = price(s.id);
    return { id: s.id, target: s.weight, units, price: p, value: units * p, weight: 0, drift: 0 };
  });
  const nav = rows.reduce((a, r) => a + r.value, 0);
  for (const r of rows) {
    r.weight = nav > 0 ? (r.value / nav) * 100 : 0;
    r.drift = r.weight - r.target;
  }
  return { rows, nav };
}

export type Plan = { sell: Row; buy: Row; units: number; valueUsd: number };

/** The single best trade, or null when everything is inside the band. Same sizing as the keeper. */
export function nextTrade(plan: Slice[], balances: Record<string, number>, price: (id: string) => number, g: Guardrails): Plan | null {
  const { rows, nav } = rowsOf(plan, balances, price);
  if (nav <= 0) return null;
  const sell = [...rows].sort((a, b) => b.drift - a.drift)[0];
  const buy = [...rows].sort((a, b) => a.drift - b.drift)[0];
  if (sell.drift < g.driftBand || buy.drift >= 0 || sell.id === buy.id) return null;
  const surplus = (sell.drift / 100) * nav;
  const shortfall = (-buy.drift / 100) * nav;
  const cap = (g.maxTradePct / 100) * nav;
  const valueUsd = Math.min(surplus, shortfall, cap) * 0.995;
  if (valueUsd < 0.25) return null;
  return { sell, buy, units: Math.min(valueUsd / sell.price, sell.units), valueUsd };
}

/** Move units from one asset to another, carrying cost basis with them. */
export function applySwap(v: PreviewVault, sell: string, sellUnits: number, buy: string, buyUnits: number) {
  const held = v.balances[sell] ?? 0;
  const frac = held > 0 ? Math.min(1, sellUnits / held) : 0;
  const moved = (v.cost[sell] ?? 0) * frac;
  v.balances[sell] = Math.max(0, held - sellUnits);
  v.cost[sell] = (v.cost[sell] ?? 0) - moved;
  v.balances[buy] = (v.balances[buy] ?? 0) + buyUnits;
  v.cost[buy] = (v.cost[buy] ?? 0) + moved;
}

export const tradesToday = (v: PreviewVault, now = Date.now()) => {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return v.trades.filter((t) => t >= start.getTime() && t <= now).length;
};

export const navOf = (v: PreviewVault, price: (id: string) => number) => rowsOf(v.plan, v.balances, price).nav + v.cash;

/* ───────────── Replay: start as if you'd invested N days ago ───────────── */

export type ReplayEvent = { at: number; kind: "trade" | "check" | "deposit"; title: string; detail: string };

/**
 * Invest `cash` at the first day's real close, then run Kite's daily check on
 * every day after it with the vault's guardrails. Returns the events it made.
 */
export function replay(v: PreviewVault, h: History): ReplayEvent[] {
  const n = h.dates.length;
  const at = (i: number) => h.dates[i] + 9 * 3600_000; // checks run once a day; stamp them mid-morning UTC
  const priceAt = (i: number) => (id: string) => h.prices[id]?.[i] ?? 1;
  const events: ReplayEvent[] = [];
  const amount = v.cash;

  // Day 0: split the cash across the plan at that day's prices, less swap cost.
  const p0 = priceAt(0);
  for (const s of v.plan) {
    const dollars = (amount * s.weight) / 100;
    const got = s.id === "usdc" ? dollars : (dollars * (1 - REPLAY_COST)) / p0(s.id);
    v.balances[s.id] = (v.balances[s.id] ?? 0) + got;
    v.cost[s.id] = (v.cost[s.id] ?? 0) + dollars;
  }
  v.cash = 0;
  v.createdAt = h.dates[0];
  v.series = [{ t: h.dates[0], v: navOf(v, p0) }];
  events.push({
    at: at(0),
    kind: "trade",
    title: `Invested ${usdShort(amount)} into your plan`,
    detail: `At ${dateShort(h.dates[0])} closing prices, ${(REPLAY_COST * 100).toFixed(1)}% swap cost. Replayed from real price history.`,
  });

  for (let i = 1; i < n - 1; i++) {
    const p = priceAt(i);
    let made = 0;
    for (;;) {
      if (made >= v.guardrails.tradesPerDay) break;
      const t = nextTrade(v.plan, v.balances, p, v.guardrails);
      if (!t) break;
      const out = (t.valueUsd * (1 - REPLAY_COST)) / t.buy.price;
      applySwap(v, t.sell.id, t.units, t.buy.id, out);
      v.trades.push(at(i));
      made++;
      events.push({
        at: at(i) + made,
        kind: "trade",
        title: `Rebalanced: sold ${usdShort(t.valueUsd)} of ${assetById(t.sell.id as never).ticker} for ${assetById(t.buy.id as never).ticker}`,
        detail: `${assetById(t.sell.id as never).ticker} was ${t.sell.drift.toFixed(1)} pts over target, ${assetById(t.buy.id as never).ticker} ${Math.abs(t.buy.drift).toFixed(1)} under. Band ${v.guardrails.driftBand} pts.`,
      });
    }
    v.series.push({ t: h.dates[i], v: navOf(v, p) });
  }
  return events;
}

const usdShort = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const dateShort = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });


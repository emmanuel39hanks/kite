/**
 * The two size floors a person can run into, in one place so every screen says the same thing.
 *  - Investing: each swap from USDC into an asset must be at least $0.25 (/api/allocate/quotes skips smaller ones,
 *    and they stay in the vault as USDC).
 *  - Rebalancing: the vault refuses any trade under $1 (ERR_TOO_SMALL in contracts/vault), so dust can't burn the
 *    daily trade count. The deployed code can't change, so the keeper and the app follow it.
 */
import type { Slice } from "./mix";
import type { Guardrails } from "./store";

export const MIN_SWAP_USD = 0.25;
export const MIN_TRADE_USD = 1;
/** Kite sizes trades 2% above the floor (packages/keeper drift.ts), since the vault judges the quote's USD figure. */
const HEADROOM = 1.02;
/** The invest step refuses less than this in total. */
export const MIN_INVEST_USD = 0.5;

const up = (n: number, step: number) => Math.round(Math.ceil(n / step - 1e-9) * step * 100) / 100;

/** The smallest amount that buys every asset in the plan (USDC itself needs no swap). 1% headroom for prices. */
export function minToInvest(mix: Slice[]): number {
  const swapped = mix.filter((s) => s.id !== "usdc" && s.weight > 0);
  if (!swapped.length) return MIN_INVEST_USD;
  const smallest = Math.min(...swapped.map((s) => s.weight));
  return Math.max(MIN_INVEST_USD, up(((MIN_SWAP_USD * 100) / smallest) * 1.01, 0.01));
}

/**
 * About how much a vault must hold for Kite to rebalance as soon as a holding crosses the band. Kite sells the most
 * overweight holding into the most underweight one, sized to the smallest of the surplus, the shortfall and the cap.
 * When one of `assets` holdings is `band` points over, the others are typically band/(assets−1) points under each,
 * so the trade is about min(band/(assets−1), cap)% of the vault, and that must reach $1. Below this the vault still
 * invests and holds; it just needs a bigger drift before a trade is allowed.
 */
export function minToRebalance(g: Pick<Guardrails, "driftBand" | "maxTradePct">, assets = 2): number {
  const pct = Math.min(g.driftBand / Math.max(1, assets - 1), g.maxTradePct);
  return up(((MIN_TRADE_USD * HEADROOM * 100) / pct) / 0.995, 1);
}

/** The largest trade the rules allow in a vault worth `valueUsd`. */
export const biggestTradeUsd = (valueUsd: number, g: Pick<Guardrails, "maxTradePct">) => (valueUsd * g.maxTradePct) / 100;

/** The smallest per-trade cap (in whole %) that lets a vault worth `valueUsd` make a $1 trade, or null if none can (over 50%). */
export function maxTradeNeeded(valueUsd: number): number | null {
  if (!(valueUsd > 0)) return null;
  const pct = Math.ceil(((MIN_TRADE_USD * HEADROOM) / 0.995) * 100 / valueUsd);
  return pct <= 50 ? pct : null;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;

/** One plain sentence about whether Kite can rebalance a vault of this size under these rules, or null when it's fine. */
export function rebalanceWarning(valueUsd: number, g: Pick<Guardrails, "driftBand" | "maxTradePct">, assets = 2): string | null {
  if (!(valueUsd > 0)) return null;
  const floor = minToRebalance(g, assets);
  if (valueUsd >= floor) return null;
  const biggest = biggestTradeUsd(valueUsd, g);
  if (biggest * 0.995 < MIN_TRADE_USD * HEADROOM) {
    const need = maxTradeNeeded(valueUsd);
    return `With ${usd(valueUsd)} in the vault, Kite's biggest trade is ${usd(biggest)}, but the vault only accepts trades of $1 or more, so Kite can't rebalance it. ${
      need ? `Raise “Biggest single trade” to at least ${need}%, or add money` : "Add money"
    } (about ${usd(floor)} lets Kite step in at your rules).`;
  }
  return `With ${usd(valueUsd)} in the vault, Kite only trades once a holding has drifted far enough for the trade to reach $1, so later than your ${g.driftBand}-point rule. From about ${usd(floor)}, it steps in right at ${g.driftBand} points.`;
}

/**
 * Roughly the trade Kite would make now, the keeper's rule: the most overweight holding sold into the most
 * underweight, sized to the smallest of the surplus, the shortfall and the cap. `drifts` are now − target, in points.
 */
export function nextTradeUsd(investedUsd: number, drifts: number[], g: Pick<Guardrails, "maxTradePct">): number {
  if (!(investedUsd > 0) || !drifts.length) return 0;
  const over = Math.max(...drifts);
  const under = -Math.min(...drifts);
  if (over <= 0 || under <= 0) return 0;
  return (Math.min(over, under, g.maxTradePct) / 100) * investedUsd * 0.995;
}

/** Whether a trade of this size clears the vault's $1 floor with the keeper's margin. */
export const tradeBigEnough = (usd: number) => usd >= MIN_TRADE_USD * HEADROOM;

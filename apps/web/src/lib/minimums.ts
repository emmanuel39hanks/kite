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
 * About how much a vault must hold for Kite to rebalance as soon as a holding crosses the band. Kite's trade is the
 * smaller of the drift and the per-trade cap, so at the band it's about min(band, cap)% of the vault, and that must
 * reach $1. Below this the vault still invests and holds; it just needs a bigger drift before a trade is allowed.
 */
export function minToRebalance(g: Pick<Guardrails, "driftBand" | "maxTradePct">): number {
  return up((MIN_TRADE_USD * 100) / Math.min(g.driftBand, g.maxTradePct) / 0.995, 1);
}

/** The largest trade the rules allow in a vault worth `valueUsd`. */
export const biggestTradeUsd = (valueUsd: number, g: Pick<Guardrails, "maxTradePct">) => (valueUsd * g.maxTradePct) / 100;

/** The smallest per-trade cap (in whole %) that lets a vault worth `valueUsd` make a $1 trade, or null if none can (over 50%). */
export function maxTradeNeeded(valueUsd: number): number | null {
  if (!(valueUsd > 0)) return null;
  const pct = Math.ceil(((MIN_TRADE_USD / 0.995) * 100) / valueUsd);
  return pct <= 50 ? pct : null;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;

/** One plain sentence about whether Kite can rebalance a vault of this size under these rules, or null when it's fine. */
export function rebalanceWarning(valueUsd: number, g: Pick<Guardrails, "driftBand" | "maxTradePct">): string | null {
  if (!(valueUsd > 0)) return null;
  const floor = minToRebalance(g);
  if (valueUsd >= floor) return null;
  const biggest = biggestTradeUsd(valueUsd, g);
  if (biggest < MIN_TRADE_USD / 0.995) {
    const need = maxTradeNeeded(valueUsd);
    return `With ${usd(valueUsd)} in the vault, Kite's biggest trade is ${usd(biggest)}, but the vault only accepts trades of $1 or more, so Kite can't rebalance it. ${
      need ? `Raise “Biggest single trade” to at least ${need}%, or add money` : "Add money"
    } (about ${usd(floor)} lets Kite step in at your rules).`;
  }
  return `With ${usd(valueUsd)} in the vault, Kite only trades once a holding has drifted far enough for the trade to reach $1, so later than your ${g.driftBand}-point rule. From about ${usd(floor)}, it steps in right at ${g.driftBand} points.`;
}

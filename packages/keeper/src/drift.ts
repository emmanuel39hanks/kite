/**
 * Pure rebalance maths, mirroring the vault contract's policy so the keeper
 * only ever proposes trades the contract will accept.
 */

export type Target = { token: string; target_bps: number; decimals: number; max_slippage_bps?: number | null };

/** The price limit for a trade: the widest of the vault's limit and the two assets' own limits (same rule as the contract). */
export const tradeSlippageBps = (limits: Limits, sell: Target, buy: Target) =>
  Math.max(limits.max_slippage_bps, sell.max_slippage_bps ?? 0, buy.max_slippage_bps ?? 0);
export type Limits = {
  band_bps: number;
  max_trade_bps: number;
  max_slippage_bps: number;
  max_trades_per_day: number;
  min_interval_secs: number;
  settle_window_secs: number;
};

export type Holding = Target & { balance: bigint; priceUsd: number; valueUsd: number; weightBps: number; driftBps: number };

export type Trade = {
  sell: Holding;
  buy: Holding;
  /** Amount of `sell` in base units. */
  amountIn: bigint;
  valueUsd: number;
};

const BPS = 10_000;

export function holdings(plan: Target[], balances: bigint[], prices: Record<string, number>): { rows: Holding[]; navUsd: number } {
  const rows = plan.map((t, i) => {
    const priceUsd = prices[t.token];
    if (!(priceUsd > 0)) throw new Error(`No price for ${t.token}`);
    const valueUsd = (Number(balances[i]) / 10 ** t.decimals) * priceUsd;
    return { ...t, balance: balances[i], priceUsd, valueUsd, weightBps: 0, driftBps: 0 };
  });
  const navUsd = rows.reduce((a, r) => a + r.valueUsd, 0);
  for (const r of rows) {
    r.weightBps = navUsd > 0 ? Math.floor((r.valueUsd * BPS) / navUsd) : 0;
    r.driftBps = r.weightBps - r.target_bps;
  }
  return { rows, navUsd };
}

/**
 * The single best trade right now, or null if nothing is outside the band.
 * Sells the most-overweight asset into the most-underweight one, sized to the
 * smaller of: the surplus, the shortfall, and the per-trade cap. A 0.5% haircut
 * keeps rounding and price movement from tripping the contract's size checks.
 */
export function nextTrade(plan: Target[], balances: bigint[], prices: Record<string, number>, limits: Limits): Trade | null {
  const { rows, navUsd } = holdings(plan, balances, prices);
  if (navUsd <= 0) return null;
  const sell = [...rows].sort((a, b) => b.driftBps - a.driftBps)[0];
  const buy = [...rows].sort((a, b) => a.driftBps - b.driftBps)[0];
  if (sell.driftBps < limits.band_bps || buy.driftBps >= 0 || sell.token === buy.token) return null;

  const surplus = (sell.driftBps * navUsd) / BPS;
  const shortfall = (-buy.driftBps * navUsd) / BPS;
  const cap = (limits.max_trade_bps * navUsd) / BPS;
  const valueUsd = Math.min(surplus, shortfall, cap) * 0.995;
  if (valueUsd < 1) return null; // not worth the swap fee

  const amountIn = BigInt(Math.floor((valueUsd / sell.priceUsd) * 10 ** sell.decimals));
  return { sell, buy, amountIn: amountIn > sell.balance ? sell.balance : amountIn, valueUsd };
}

/** Fixed-point USD price the contract expects: $1 = 1_000_000. */
export const toUsdE6 = (usd: number) => BigInt(Math.round(usd * 1_000_000)).toString();

/** The fair amount out, in `buy` base units, at reference prices. */
export function fairOut(trade: Trade): bigint {
  return BigInt(Math.floor((trade.valueUsd / trade.buy.priceUsd) * 10 ** trade.buy.decimals));
}

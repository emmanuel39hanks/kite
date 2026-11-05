import { holdings, nextTrade, toUsdE6, tradeSlippageBps } from "./drift.js";
import { callRebalance, callSettle, readVault } from "./near.js";
import { prices as livePrices, quoteFull, signedPayload, status as swapStatus, submitDeposit, verifyPayload } from "./oneclick.js";

export type RunOptions = { vault: string; dry: boolean; log?: (line: string) => void; /** How long to wait for a started swap before leaving it for the next run. */ settleWaitMs?: number };

const FINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

/** Poll 1Click until the swap reaches a final status, or the wait runs out (then null). */
async function waitForSwap(depositAddress: string, waitMs: number, log: (line: string) => void): Promise<string | null> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5_000));
    const s = await swapStatus(depositAddress).catch(() => null);
    if (s && FINAL.has(String(s.status))) return String(s.status);
  }
  log(`Waited ${Math.round(waitMs / 1000)}s for the swap.`);
  return null;
}

/**
 * One check of one vault:
 *   pending swap? → settle it.
 *   otherwise → read balances + live prices → if something is outside the band,
 *   get a 1Click quote and call vault.rebalance (unless dry).
 */
export async function runOnce({ vault, dry, log = console.log, settleWaitMs = 120_000 }: RunOptions) {
  const v = await readVault(vault);
  if (v.status.paused) {
    log(`${vault} is paused. Nothing to do until the owner unpauses.`);
    return { action: "paused" as const };
  }
  if (v.status.pending) {
    const s = await swapStatus(v.status.pending.deposit_address).catch(() => ({ status: "UNKNOWN" }));
    log(`Pending swap (${s.status}). ${dry ? "Would call" : "Calling"} settle.`);
    if (!dry) await callSettle(vault);
    return { action: "settle" as const, swap: s.status };
  }

  const tokenIds = v.plan.map((t) => t.token);
  const prices = await livePrices(tokenIds);
  const { rows, navUsd } = holdings(v.plan, v.balances, prices);
  log(`NAV $${navUsd.toFixed(2)}`);
  for (const r of rows) {
    log(`  ${r.token.padEnd(48)} ${(r.weightBps / 100).toFixed(2).padStart(6)}%  target ${(r.target_bps / 100).toFixed(2).padStart(6)}%  drift ${(r.driftBps / 100).toFixed(2)} pts`);
  }

  const trade = nextTrade(v.plan, v.balances, prices, v.limits);
  if (!trade) {
    log(`On plan: nothing is ${v.limits.band_bps / 100} points off target.`);
    return { action: "none" as const, navUsd };
  }
  log(`Trade: sell $${trade.valueUsd.toFixed(2)} of ${trade.sell.token} for ${trade.buy.token}`);

  const limitBps = tradeSlippageBps(v.limits, trade.sell, trade.buy);
  const res = await quoteFull({
    dry,
    originAsset: trade.sell.token,
    destinationAsset: trade.buy.token,
    amount: trade.amountIn.toString(),
    account: vault,
    // Half the limit for solver slippage; the other half is room for 1Click's fees.
    slippageBps: Math.max(10, Math.floor(limitBps / 2)),
    deadlineSecs: v.limits.settle_window_secs,
  });
  const q = res.quote;
  // The vault's price rule, checked here first: value back ≥ (1 − limit) × value in, by 1Click's
  // signed USD figures, and the guaranteed minimum no looser than the limit either.
  const keep = 1 - limitBps / 10_000;
  const inUsd = Number(q.amountInUsd);
  const outUsd = Number(q.amountOutUsd);
  log(`Quote: $${inUsd.toFixed(2)} in → $${outUsd.toFixed(2)} out (${((1 - outUsd / inUsd) * 100).toFixed(2)}% cost, limit ${(limitBps / 100).toFixed(2)}%)`);
  if (!(Number.isFinite(inUsd) && Number.isFinite(outUsd) && outUsd >= inUsd * keep && Number(q.minAmountOut) >= Number(q.amountOut) * keep)) {
    log("Quote costs more than the price limit. Skipping; the vault would refuse it anyway.");
    return { action: "skipped" as const, reason: "price" };
  }
  if (dry || !q.depositAddress) {
    log("Dry run: not sending.");
    return { action: "dry" as const, trade, quote: q };
  }

  // The vault verifies 1Click's signature itself; checking here first just saves gas.
  const payload = signedPayload(res);
  if (!verifyPayload(payload, res.signature)) throw new Error("1Click's quote signature didn't verify; not sending.");
  const { hash } = await callRebalance(vault, {
    quote: payload,
    signature: res.signature,
    prices: rows.map((r) => ({ token: r.token, usd_e6: toUsdE6(r.priceUsd) })),
  });
  if (hash) await submitDeposit(hash, q.depositAddress);
  log(`Sent. tx ${hash}. 1Click deposit ${q.depositAddress}.`);

  // Wait for the swap to land, then settle in the same run, so one daily run is a whole rebalance.
  // If it hasn't landed in time, the vault stays pending and the next run settles it.
  const final = await waitForSwap(q.depositAddress, settleWaitMs, log);
  if (final) {
    await callSettle(vault);
    log(`Swap ${final.toLowerCase()}. Settled.`);
    return { action: "rebalanced" as const, tx: hash, depositAddress: q.depositAddress, swap: final };
  }
  log("The swap hasn't landed yet. The next run will settle it.");
  return { action: "rebalanced" as const, tx: hash, depositAddress: q.depositAddress };
}

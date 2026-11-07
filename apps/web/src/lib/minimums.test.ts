import assert from "node:assert/strict";
import { test } from "node:test";
import { biggestTradeUsd, maxTradeNeeded, minToInvest, minToRebalance, rebalanceWarning } from "./minimums";
import { slice } from "./mix";

test("the smallest deposit buys every asset in the plan at $0.25 a swap", () => {
  assert.equal(minToInvest([slice("btc", 50), slice("eth", 50)]), 0.51);
  assert.equal(minToInvest([slice("btc", 90), slice("eth", 10)]), 2.53);
  // USDC needs no swap, so a 5% USDC share doesn't raise the floor.
  assert.equal(minToInvest([slice("usdc", 5), slice("btc", 95)]), 0.5);
});

test("rebalancing needs the trade at the band to reach the vault's $1 floor", () => {
  assert.equal(minToRebalance({ driftBand: 5, maxTradePct: 10 }), 21);
  assert.equal(minToRebalance({ driftBand: 5, maxTradePct: 50 }), 21);
  assert.equal(minToRebalance({ driftBand: 10, maxTradePct: 3 }), 34);
  assert.equal(biggestTradeUsd(2.93, { maxTradePct: 10 }), 0.293);
  assert.equal(maxTradeNeeded(2.93), 35);
  assert.equal(maxTradeNeeded(1.5), null);
});

test("the warning says plainly when Kite can't trade, and is quiet when it can", () => {
  const stuck = rebalanceWarning(2.93, { driftBand: 5, maxTradePct: 10 })!;
  assert.match(stuck, /can't rebalance/);
  assert.match(stuck, /at least 35%/);
  const late = rebalanceWarning(2.93, { driftBand: 5, maxTradePct: 50 })!;
  assert.match(late, /drifted far enough/);
  assert.equal(rebalanceWarning(500, { driftBand: 5, maxTradePct: 10 }), null);
  assert.equal(rebalanceWarning(0, { driftBand: 5, maxTradePct: 10 }), null);
});

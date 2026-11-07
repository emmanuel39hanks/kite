import assert from "node:assert/strict";
import { test } from "node:test";
import { fairOut, holdings, nextTrade, type Limits, type Target } from "../src/drift.ts";

const BTC = "nep141:nbtc.bridge.near";
const XAUT = "nep141:xaut";
const USDC = "nep141:usdc";
const plan: Target[] = [
  { token: BTC, target_bps: 6000, decimals: 8 },
  { token: XAUT, target_bps: 2000, decimals: 6 },
  { token: USDC, target_bps: 2000, decimals: 6 },
];
const limits: Limits = { band_bps: 500, max_trade_bps: 1000, max_slippage_bps: 100, max_trades_per_day: 4, min_interval_secs: 3600, settle_window_secs: 1800 };
const prices = { [BTC]: 80_000, [XAUT]: 4_000, [USDC]: 1 };

test("weights and drift", () => {
  const { rows, navUsd } = holdings(plan, [8_750_000n, 375_000n, 1_500_000_000n], prices);
  assert.equal(Math.round(navUsd), 10_000);
  assert.deepEqual(rows.map((r) => r.driftBps), [1000, -500, -500]);
});

test("on plan → no trade", () => {
  assert.equal(nextTrade(plan, [7_500_000n, 500_000n, 2_000_000_000n], prices, limits), null);
});

test("inside the band → no trade", () => {
  // BTC at 64% (4 pts over, band is 5)
  assert.equal(nextTrade(plan, [8_000_000n, 450_000n, 1_800_000_000n], prices, limits), null);
});

test("over the band → sells the overweight into the most underweight, capped", () => {
  const t = nextTrade(plan, [8_750_000n, 375_000n, 1_500_000_000n], prices, limits);
  if (!t) throw new Error("expected a trade");
  assert.equal(t.sell.token, BTC);
  assert.ok([XAUT, USDC].includes(t.buy.token));
  // surplus $1000, shortfall $500, cap $1000 → $500 × 0.995
  assert.ok(Math.abs(t.valueUsd - 497.5) < 0.01);
  assert.equal(t.amountIn, 621_875n);
  assert.ok(fairOut(t) > 0n);
});

test("never sells more than the cap", () => {
  // BTC at 90%: surplus $3000, shortfall per asset $1000, cap $1000
  const t = nextTrade(plan, [11_250_000n, 0n, 1_000_000_000n], prices, limits);
  if (!t) throw new Error("expected a trade");
  assert.ok(t.valueUsd <= 1000);
});

test("a small vault still rebalances: trades from $0.25 go through, smaller ones wait", () => {
  const plan2: Target[] = [
    { token: "nep141:usdc", decimals: 6, target_bps: 5000 },
    { token: "nep141:btc", decimals: 8, target_bps: 5000 },
  ];
  const px = { "nep141:usdc": 1, "nep141:btc": 100_000 };
  const lim: Limits = { ...limits, max_trade_bps: 5000 };
  // $3 vault at 70/30: $0.60 over, a $0.60 trade.
  const t = nextTrade(plan2, [2_100_000n, 900n], px, lim);
  assert.ok(t && t.valueUsd > 0.5 && t.valueUsd < 0.61 && t.sell.token === "nep141:usdc");
  // $1 vault at 60/40: $0.10 over, too small.
  assert.equal(nextTrade(plan2, [600_000n, 400n], px, lim), null);
});

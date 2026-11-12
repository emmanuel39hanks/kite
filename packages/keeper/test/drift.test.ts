import assert from "node:assert/strict";
import { test } from "node:test";
import { holdings, nextTrade, rateWait, type Limits, type Target } from "../src/drift.ts";

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
});

test("never sells more than the cap", () => {
  // BTC at 90%: surplus $3000, shortfall per asset $1000, cap $1000
  const t = nextTrade(plan, [11_250_000n, 0n, 1_000_000_000n], prices, limits);
  if (!t) throw new Error("expected a trade");
  assert.ok(t.valueUsd <= 1000);
});

test("a small vault rebalances only once the trade reaches the vault's $1 minimum", () => {
  const plan2: Target[] = [
    { token: "nep141:usdc", decimals: 6, target_bps: 5000 },
    { token: "nep141:btc", decimals: 8, target_bps: 5000 },
  ];
  const px = { "nep141:usdc": 1, "nep141:btc": 100_000 };
  const lim: Limits = { ...limits, max_trade_bps: 5000 };
  // $3 vault at 90/10: $1.20 over, a $1.19 trade.
  const t = nextTrade(plan2, [2_700_000n, 300n], px, lim);
  assert.ok(t && t.valueUsd >= 1 && t.valueUsd < 1.2 && t.sell.token === "nep141:usdc");
  // $3 vault at 70/30: only $0.60 over, under the vault's $1 floor.
  assert.equal(nextTrade(plan2, [2_100_000n, 900n], px, lim), null);
});

test("the keeper holds a trade the vault would refuse for its pacing", () => {
  const pace = { max_trades_per_day: 4, min_interval_secs: 14_400 };
  const noon = 1_800_000_000 - (1_800_000_000 % 86_400) + 12 * 3600; // 12:00 UTC on some day
  const ns = (secs: number) => secs * 1e9;
  // Never traded: free to go.
  assert.equal(rateWait({ trades_today: 0, last_trade_ns: 0 }, pace, noon), null);
  // Traded an hour ago: wait out the rest of the four-hour gap.
  assert.deepEqual(rateWait({ trades_today: 1, last_trade_ns: ns(noon - 3600) }, pace, noon), { reason: "gap", waitSecs: 10_800 });
  // The gap has passed: free to go.
  assert.equal(rateWait({ trades_today: 1, last_trade_ns: ns(noon - 14_400) }, pace, noon), null);
  // Today's trades are used up, even though the gap has passed: wait for the next UTC day.
  assert.deepEqual(rateWait({ trades_today: 4, last_trade_ns: ns(noon - 20_000) }, pace, noon), { reason: "day", waitSecs: 43_200 });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applySwap, navOf, nextTrade, rowsOf, type PreviewVault } from "./engine";

const plan = [{ id: "btc", weight: 60, color: "" }, { id: "xaut", weight: 30, color: "" }, { id: "usdc", weight: 10, color: "" }] as never;
const px = (id: string) => ({ btc: 80_000, xaut: 4_000, usdc: 1 })[id as "btc"] ?? 1;
const g = { driftBand: 5, maxTradePct: 10, slippageBps: 100, tradesPerDay: 4 };
// The contract test fixture: $10,000 with BTC drifted to 70% (target 60%).
const drifted = { btc: 0.0875, xaut: 0.375, usdc: 1500 };

test("sells the most overweight and buys the most underweight", () => {
  const t = nextTrade(plan, drifted, px, g)!;
  assert.equal(t.sell.id, "btc");
  assert.equal(t.buy.id, "xaut");
});

test("does nothing inside the band", () => {
  assert.equal(nextTrade(plan, { btc: 0.075, xaut: 0.75, usdc: 1000 }, px, g), null);
});

test("a trade is never bigger than the cap or the gap", () => {
  const nav = navOf({ plan, balances: drifted, cash: 0 } as unknown as PreviewVault, px);
  const r = rowsOf(plan, drifted, px).rows.find((x) => x.id === "btc")!;
  // BTC is 10 points over ($1,000), XAUT 15 under ($1,500). The cap and the gap differ in each case,
  // so dropping either limit from the code fails one of these.
  const capped = nextTrade(plan, drifted, px, { ...g, maxTradePct: 4 })!;
  assert.ok(Math.abs(capped.valueUsd - 0.04 * nav * 0.995) < 1e-6, `cap binds: ${capped.valueUsd}`);
  const gapped = nextTrade(plan, drifted, px, { ...g, maxTradePct: 50 })!;
  assert.ok(Math.abs(gapped.valueUsd - (r.drift / 100) * nav * 0.995) < 1e-6, `gap binds: ${gapped.valueUsd}`);
});

test("trades under one dollar are skipped", () => {
  assert.equal(nextTrade(plan, { btc: 0.0000001, xaut: 0, usdc: 0.5 }, px, g), null);
});

test("a swap carries its cost basis with it", () => {
  const v = { balances: { btc: 1, xaut: 0 }, cost: { btc: 100, xaut: 0 } } as unknown as PreviewVault;
  applySwap(v, "btc", 0.25, "xaut", 5);
  assert.equal(v.cost.btc, 75);
  assert.equal(v.cost.xaut, 25);
  assert.equal(v.balances.btc, 0.75);
  assert.equal(v.balances.xaut, 5);
});

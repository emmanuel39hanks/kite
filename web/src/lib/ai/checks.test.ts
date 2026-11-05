import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanProposal, GUARD_BOUNDS } from "./guard-bounds";
import { cleanIncident } from "./incident";
import { normalise } from "./planner";
import { cleanReview } from "./review";
import { cleanWhy, whyTemplate } from "./why";

const cur = { driftBand: 5, maxTradePct: 10, slippageBps: 100, tradesPerDay: 4 };

test("guardrail proposals are clamped and snapped to the allowed ranges", () => {
  const p = cleanProposal({ intent: "specific", driftBand: 99, maxTradePct: 500, slippageBps: 9999, tradesPerDay: 99, explain: "x" }, cur);
  assert.equal(p.rules.driftBand, GUARD_BOUNDS.driftBand.max);
  assert.equal(p.rules.maxTradePct, GUARD_BOUNDS.maxTradePct.max);
  assert.equal(p.rules.slippageBps, GUARD_BOUNDS.slippageBps.max);
  assert.equal(p.rules.tradesPerDay, GUARD_BOUNDS.tradesPerDay.max);
  assert.equal(cleanProposal({ intent: "specific", driftBand: 5, maxTradePct: 10, slippageBps: 75, tradesPerDay: 4, explain: "" }, cur).rules.slippageBps % 10, 0);
});

test("'more careful' can never loosen a rule, whatever the model returns", () => {
  const p = cleanProposal({ intent: "more_careful", driftBand: 3, maxTradePct: 40, slippageBps: 300, tradesPerDay: 6, explain: "" }, cur);
  assert.ok(p.rules.maxTradePct <= cur.maxTradePct && p.rules.slippageBps <= cur.slippageBps && p.rules.tradesPerDay <= cur.tradesPerDay);
});

test("missing or null values keep the current setting", () => {
  const p = cleanProposal({ intent: "specific", driftBand: null, maxTradePct: "", slippageBps: undefined, tradesPerDay: "x", explain: "" }, cur);
  assert.deepEqual(p.rules, cur);
});

test("an explanation containing a number is dropped", () => {
  assert.equal(cleanProposal({ intent: "specific", ...cur, explain: "I changed it to 5" }, cur).explain, "");
  assert.ok(cleanProposal({ intent: "specific", ...cur, explain: "Trades stay small." }, cur).explain);
});

test("the 'why' wording is replaced by the template when it cites an unknown number", () => {
  const input = { sell: "Bitcoin", buy: "Ethereum", overByPts: 6.2 };
  assert.equal(cleanWhy({ because: "Bitcoin rose 12% so Kite sold." }, input).fromModel, false);
  assert.equal(cleanWhy({ because: "Bitcoin was 6.2 points over target." }, input).fromModel, true);
  assert.equal(cleanWhy({ because: "" }, input).text, whyTemplate(input));
});

test("the incident explanation must agree with the status in code", () => {
  const ok = { what_happened: "The swap did not finish.", where_money_is: "vault", next_step: "Kite will retry." };
  assert.equal(cleanIncident(ok, "REFUNDED", "T").fromModel, true);
  assert.equal(cleanIncident(ok, "FAILED", "T").fromModel, false); // FAILED must be "unknown", never "vault"
  assert.equal(cleanIncident({ ...ok, what_happened: "Refund of 5 USDC" }, "REFUNDED", "T").fromModel, false);
});

test("review bullets keep only real statistics and drop sentences with numbers", () => {
  const r = cleanReview({ verdict: "watch", suggestion: "raise_band", bullets: [{ stat: "volatility", text: "It moves less than most crypto." }, { stat: "volatility", text: "It swings 15% a year." }, { stat: "bogus", text: "x" }] });
  assert.equal(r.bullets.length, 1);
  assert.throws(() => cleanReview({ verdict: "ok", bullets: [{ stat: "volatility", text: "twenty percent" }] }));
});

test("plan drafts: weights add to 100, unknown assets are dropped, stray numbers are removed", () => {
  const raw = {
    name: "House fund",
    summary: "Mostly steady, with 99% certainty.",
    assets: [{ id: "usdc", weight: 70, earn: false, why: "Cushion." }, { id: "btc", weight: 30, earn: false, why: "Up 500% lately." }, { id: "doge", weight: 5, earn: false, why: "" }],
    rules: { driftBand: 5, maxTradePct: 10, slippageBps: 100, tradesPerDay: 4 },
    caution: "Prices fall by 80% sometimes.",
    basis: ["Bitcoin swung about 43.8% over the year", "Bitcoin will rise 500%"],
  };
  const { draft } = normalise(raw, new Set(["43.8"]));
  assert.equal(draft.assets.reduce((n, a) => n + a.weight, 0), 100);
  assert.ok(!draft.assets.some((a) => a.id === ("doge" as never)));
  assert.equal(draft.summary, "");
  assert.equal(draft.assets.find((a) => a.id === "btc")!.why, "");
  assert.deepEqual(draft.basis, ["Bitcoin swung about 43.8% over the year"]);
  assert.ok(draft.caution.length > 0 && !/80/.test(draft.caution)); // replaced with the standard caution, not left empty
});

test("with no statistics supplied, the planner still refuses invented numbers", () => {
  const { draft } = normalise({ name: "x", summary: "Returns 12%.", assets: [{ id: "usdc", weight: 50, earn: false, why: "" }, { id: "btc", weight: 50, earn: false, why: "" }], rules: {}, caution: "", basis: ["Bitcoin rose 12%"] });
  assert.equal(draft.summary, "");
  assert.deepEqual(draft.basis, []);
});

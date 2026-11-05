import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAllocation, verifyDeposit } from "./allocate-check";

const USDC = "nep141:usdc";
const BTC = "nep141:btc";
const ETH = "nep141:eth";
const FEE = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
const vault = "kite.alex.near";
const plan = [{ token: BTC, target_bps: 6000 }, { token: ETH, target_bps: 4000 }];
const usdc = 10_000_000n;
const stored = (o: Record<string, unknown> = {}) => ({
  quoteResponse: { quoteRequest: { recipient: vault, refundTo: vault, recipientType: "INTENTS", refundType: "INTENTS", depositType: "INTENTS", originAsset: USDC, dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, appFees: [{ recipient: FEE, fee: 20 }], ...o } },
});
const good = [
  { token: USDC, amount: "6000000", to: "aaaaaaaa11", buy: BTC },
  { token: USDC, amount: "4000000", to: "bbbbbbbb22", buy: ETH },
];
const run = (transfers = good, status: (a: string) => Record<string, unknown> = () => ({})) =>
  verifyAllocation({
    transfers, plan, usdc, usdcToken: USDC, vault,
    fetchStatus: async (a) => {
      const t = transfers.find((x) => x.to === a)!;
      return stored({ destinationAsset: t.buy, amount: t.amount, ...status(a) }) as never;
    },
  });

test("a correct allocation passes", async () => {
  await run();
});

test("refuses a swap that pays someone else", async () => {
  await assert.rejects(run(good, () => ({ recipient: "thief.near" })), /didn't check out/);
});

test("refuses a refund to someone else", async () => {
  await assert.rejects(run(good, () => ({ refundTo: "thief.near" })));
});

test("refuses an amount that isn't the planned share", async () => {
  await assert.rejects(run([{ ...good[0], amount: "9000000" }, good[1]]));
});

test("refuses a token that isn't USDC, an unplanned asset, or repeats", async () => {
  await assert.rejects(run([{ ...good[0], token: "nep141:other" }, good[1]]));
  await assert.rejects(run([{ ...good[0], buy: "nep141:doge" }, good[1]]));
  await assert.rejects(run([good[0], good[0]]));
});

test("refuses a fee that doesn't go to 1Click, or is too large", async () => {
  await assert.rejects(run(good, () => ({ appFees: [{ recipient: "thief", fee: 20 }] })));
  await assert.rejects(run(good, () => ({ appFees: [{ recipient: FEE, fee: 500 }] })));
});

test("refuses an address NEAR Intents doesn't know", async () => {
  await assert.rejects(
    verifyAllocation({ transfers: good, plan, usdc, usdcToken: USDC, vault, fetchStatus: async () => { throw new Error("404"); } }),
    /unknown to NEAR Intents/,
  );
});

test("refuses a loose slippage, a wrong swap type, or a referral", async () => {
  await assert.rejects(run(good, () => ({ slippageTolerance: 10_000 })));
  await assert.rejects(run(good, () => ({ swapType: "EXACT_OUTPUT" })));
  await assert.rejects(run(good, () => ({ referral: "thief" })));
});

test("nothing to invest gives a plain message, not a quote error", async () => {
  await assert.rejects(run([]), /nothing to invest/);
});

const dep = (o: Record<string, unknown> = {}) =>
  stored({ depositType: "ORIGIN_CHAIN", originAsset: "nep141:btc", destinationAsset: USDC, refundTo: "alex.near", amount: "5000", ...o }) as never;
const runDep = (o: Record<string, unknown> = {}) =>
  verifyDeposit({ address: "cccccccc33", vault, owner: "alex.near", sourceAsset: "nep141:btc", usdcToken: USDC, amount: "5000", fetchStatus: async () => dep(o) });

test("a cross-chain deposit address that pays this vault and refunds this owner passes", async () => {
  await runDep();
});

test("a deposit address that pays or refunds someone else is not shown", async () => {
  await assert.rejects(runDep({ recipient: "thief.near" }), /didn't check out/);
  await assert.rejects(runDep({ refundTo: "thief.near" }));
  await assert.rejects(runDep({ destinationAsset: "nep141:other" }));
  await assert.rejects(runDep({ amount: "9" }));
  await assert.rejects(runDep({ appFees: [{ recipient: "thief", fee: 20 }] }));
});

// Each field on its own, so dropping any single check from the code fails a test.
const swapFields: Record<string, unknown>[] = [
  { recipient: "thief.near" }, { refundTo: "thief.near" },
  { recipientType: "DESTINATION_CHAIN" }, { refundType: "ORIGIN_CHAIN" }, { depositType: "ORIGIN_CHAIN" },
  { originAsset: "nep141:other" }, { destinationAsset: "nep141:other" }, { amount: "1" },
  { dry: true }, { swapType: "EXACT_OUTPUT" }, { slippageTolerance: 201 }, { slippageTolerance: "100" },
];

test("each swap field is checked on its own", async () => {
  for (const o of swapFields) await assert.rejects(run(good, () => o), /didn't check out/, JSON.stringify(o));
});

test("each deposit field is checked on its own", async () => {
  const fields = [
    ...swapFields.filter((o) => !("depositType" in o) && !("slippageTolerance" in o)),
    { depositType: "INTENTS" }, { originAsset: "nep141:eth" }, { destinationAsset: BTC },
  ];
  for (const o of fields) await assert.rejects(runDep(o), /didn't check out/, JSON.stringify(o));
});

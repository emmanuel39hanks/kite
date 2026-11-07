import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyConvert } from "./allocate-check";

const USDC = "nep141:usdc.test";
const OWNER = "alice.near";
const good = { recipient: OWNER, recipientType: "DESTINATION_CHAIN", refundTo: OWNER, refundType: "INTENTS", depositType: "INTENTS", originAsset: "nep141:eth.omft.near", destinationAsset: USDC, amount: "100", dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100 };
const t = { token: "nep141:eth.omft.near", amount: "100", to: "addr1" };
const run = (q: Record<string, unknown>) => verifyConvert({ transfers: [t], owner: OWNER, usdcToken: USDC, fetchStatus: async () => ({ quoteResponse: { quoteRequest: q } }) });

test("a swap back to USDC in the owner's own wallet passes", async () => {
  await run(good);
});

test("anything that pays someone else, or isn't USDC, is refused before signing", async () => {
  for (const bad of [
    { recipient: "mallory.near" },
    { refundTo: "mallory.near" },
    { recipientType: "INTENTS" },
    { destinationAsset: "nep141:eth.omft.near" },
    { amount: "99" },
    { originAsset: "nep141:nbtc.bridge.near" },
    { dry: true },
    { slippageTolerance: 900 },
    { referral: "x" },
    { appFees: [{ recipient: "mallory.near", fee: 10 }] },
  ]) await assert.rejects(run({ ...good, ...bad }), /didn't check out/, JSON.stringify(bad));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { signedPayload, verifyPayload, type QuoteResponse } from "../src/oneclick.ts";

/** A real 1Click /quote response from 2026-11-03T00:05:28.110Z (fields that 1Click doesn't sign included, to prove they're dropped). */
const response = {"quoteRequest": {"dry": false, "swapType": "EXACT_INPUT", "slippageTolerance": 100, "originAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "depositType": "INTENTS", "destinationAsset": "nep141:nbtc.bridge.near", "amount": "5000000", "refundTo": "kite.preview.near", "refundType": "INTENTS", "recipient": "kite.preview.near", "recipientType": "INTENTS", "deadline": "2026-11-06T01:05:27.789Z", "depositMode": "SIMPLE", "appFees": [{"recipient": "x", "fee": 20}]}, "quote": {"amountIn": "5000000", "amountInFormatted": "5.0", "amountInUsd": "4.996540000000", "minAmountIn": "5000000", "amountOut": "6499", "amountOutFormatted": "0.00006499", "amountOutUsd": "4.984408050000", "minAmountOut": "6434", "depositAddress": "309eda6dc4ff8679f6de9e57aede0142ee2bb14ccaa4166145355bb2bcd7a55c", "timeWhenInactive": "2026-11-06T01:05:27.789Z", "timeEstimate": 10, "refundFee": "0", "withdrawFee": "0", "deadline": "2026-11-06T01:05:27.789Z"}, "signature": "ed25519:7XRRcve6kEgqHdKGWZ5QwXNmk7bn2vmNeFoMdfipTauyTu8spkDwM5SgM9u4WfEYJqDNaHt6RAEnhGgSQRGuvZB", "timestamp": "2026-11-03T00:05:28.110Z", "correlationId": "ignored"} as unknown as QuoteResponse;

test("rebuilds the exact JSON 1Click signed", () => {
  assert.equal(signedPayload(response), "{\"amount\":\"5000000\",\"amountIn\":\"5000000\",\"amountInFormatted\":\"5.0\",\"amountInUsd\":\"4.996540000000\",\"amountOut\":\"6499\",\"amountOutFormatted\":\"0.00006499\",\"amountOutUsd\":\"4.984408050000\",\"deadline\":\"2026-11-06T01:05:27.789Z\",\"depositAddress\":\"309eda6dc4ff8679f6de9e57aede0142ee2bb14ccaa4166145355bb2bcd7a55c\",\"depositType\":\"INTENTS\",\"destinationAsset\":\"nep141:nbtc.bridge.near\",\"dry\":false,\"minAmountIn\":\"5000000\",\"minAmountOut\":\"6434\",\"originAsset\":\"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1\",\"recipient\":\"kite.preview.near\",\"recipientType\":\"INTENTS\",\"refundFee\":\"0\",\"refundTo\":\"kite.preview.near\",\"refundType\":\"INTENTS\",\"slippageTolerance\":100,\"swapType\":\"EXACT_INPUT\",\"timeEstimate\":10,\"timeWhenInactive\":\"2026-11-06T01:05:27.789Z\",\"timestamp\":\"2026-11-03T00:05:28.110Z\",\"withdrawFee\":\"0\"}");
});

test("verifies 1Click's real signature", () => {
  assert.equal(verifyPayload(signedPayload(response), response.signature), true);
});

test("rejects an edited quote", () => {
  const edited = signedPayload(response).replace('"recipient":"kite.preview.near"', '"recipient":"attacker.near"');
  assert.equal(verifyPayload(edited, response.signature), false);
});

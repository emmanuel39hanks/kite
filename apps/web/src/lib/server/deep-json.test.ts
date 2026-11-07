import assert from "node:assert/strict";
import { test } from "node:test";
import { deepJson } from "./deep-json";

test("call arguments escaped any number of times still parse", () => {
  const q = { amountIn: "5", amountInUsd: "1.15" };
  const once = JSON.stringify(q);
  assert.deepEqual(deepJson(once), q);
  assert.deepEqual(deepJson(JSON.stringify(once)), q);
  // NearBlocks' shape: backslash-escaped quotes inside a plain string.
  assert.deepEqual(deepJson(once.replace(/"/g, '\\\\\\"')), q);
  assert.equal(deepJson("not json"), null);
});

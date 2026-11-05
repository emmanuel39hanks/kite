import assert from "node:assert/strict";
import { test } from "node:test";
import { gasLeft, returned } from "../src/near.js";

const ok = (v: unknown) => ({ status: { SuccessValue: Buffer.from(JSON.stringify(v)).toString("base64") } });

test("reads the vault's answer from the final receipt", () => {
  assert.equal(returned(ok(false)), false);
  assert.equal(returned(ok("waiting")), "waiting");
  assert.equal(returned({ status: { SuccessValue: "" } }), undefined);
  assert.equal(returned({ status: { Failure: {} } }), undefined);
  assert.equal(returned({ status: { SuccessValue: "not json!" } }), undefined);
});

test("gas left is the smaller of the allowance and the NEAR not locked for storage", () => {
  const near = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
  // 2.6 NEAR held, 230,000 bytes stored (2.3 NEAR locked): 0.3 NEAR spare.
  assert.equal(gasLeft(near(0.25).toString(), near(2.6), 230_000), near(0.25));
  assert.equal(gasLeft(near(1).toString(), near(2.6), 230_000), near(0.3));
  assert.equal(gasLeft(null, near(2.6), 230_000), near(0.3));
  assert.equal(gasLeft(near(1).toString(), near(2), 230_000), 0n);
});

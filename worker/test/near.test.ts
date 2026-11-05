import assert from "node:assert/strict";
import { test } from "node:test";
import { returned } from "../src/near.js";

const ok = (v: unknown) => ({ status: { SuccessValue: Buffer.from(JSON.stringify(v)).toString("base64") } });

test("reads the vault's answer from the final receipt", () => {
  assert.equal(returned(ok(false)), false);
  assert.equal(returned(ok("waiting")), "waiting");
  assert.equal(returned({ status: { SuccessValue: "" } }), undefined);
  assert.equal(returned({ status: { Failure: {} } }), undefined);
  assert.equal(returned({ status: { SuccessValue: "not json!" } }), undefined);
});

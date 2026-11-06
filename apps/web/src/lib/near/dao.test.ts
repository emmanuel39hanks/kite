import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeArgs, describeCalls, encodeArgs, looksLikeSputnikDao, vaultProposalKind } from "./dao";

test("proposal args round-trip as SputnikDAO stores them (base64 JSON)", () => {
  const args = { limits: { band_bps: 500 }, policy_ref: "ab".repeat(32), note: "café" };
  assert.deepEqual(decodeArgs(encodeArgs(args)), args);
  assert.equal(encodeArgs({}), "e30=");
  assert.equal(decodeArgs("not base64!"), null);
});

test("a vault proposal calls only the vault, with 1 yoctoNEAR on each call", () => {
  const kind = vaultProposalKind("kite.alice.near", [{ method: "pause", args: {} }, { method: "accept_owner", args: {} }]);
  assert.equal(kind.FunctionCall.receiver_id, "kite.alice.near");
  assert.deepEqual(kind.FunctionCall.actions.map((a) => [a.method_name, a.deposit]), [["pause", "1"], ["accept_owner", "1"]]);
  assert.deepEqual(describeCalls(kind), [{ method: "pause", args: {} }, { method: "accept_owner", args: {} }]);
});

test("DAO account names", () => {
  assert.ok(looksLikeSputnikDao("treasury.sputnik-dao.near"));
  assert.ok(!looksLikeSputnikDao("sputnik-dao.near"));
  assert.ok(!looksLikeSputnikDao("evil.sputnik-dao.near.attacker.near"));
});

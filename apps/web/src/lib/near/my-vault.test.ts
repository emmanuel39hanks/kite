import assert from "node:assert/strict";
import { test } from "node:test";
import { baseVaultName } from "./my-vault";
import { validVaultName } from "./factory-names";

test("a wallet's factory vault name comes from its account and is one the factory accepts", () => {
  assert.equal(baseVaultName("emmanuelhaanks.near"), "emmanuelhaanks");
  assert.equal(baseVaultName("alice.tg"), "alice");
  assert.equal(baseVaultName("pay.alice.near"), "pay-alice");
  assert.equal(baseVaultName("a_b--c.near"), "a-b-c");
  const hex = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  assert.equal(baseVaultName(hex), hex.slice(0, 24));
  assert.equal(baseVaultName("x.near"), "vault");
  for (const a of ["emmanuelhaanks.near", "pay.alice.near", hex, "x.near", "a-.b.near"]) assert.ok(validVaultName(baseVaultName(a)), a);
});

test("with several vaults, the screens follow what this browser picked", async () => {
  const { view } = await import("./my-vault");
  const f = { open: ["b.kitevaults.near", "a.kitevaults.near"], inflight: null, next: "c.kitevaults.near" };
  assert.deepEqual(view(f, null).vault, "b.kitevaults.near"); // newest by default
  assert.equal(view(f, "a.kitevaults.near").vault, "a.kitevaults.near");
  assert.equal(view(f, "gone.kitevaults.near").vault, "b.kitevaults.near"); // a closed pick falls back
  const fresh = view(f, "new");
  assert.equal(fresh.vault, "c.kitevaults.near");
  assert.equal(fresh.exists, false);
  // A creation still in flight is never offered a second name.
  assert.equal(view({ ...f, inflight: "c.kitevaults.near", next: "d.kitevaults.near" }, "new").vault, "c.kitevaults.near");
  assert.equal(view({ open: [], inflight: null, next: "x.kitevaults.near" }, null).exists, false);
});

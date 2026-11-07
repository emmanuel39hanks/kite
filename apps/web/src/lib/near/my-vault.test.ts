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

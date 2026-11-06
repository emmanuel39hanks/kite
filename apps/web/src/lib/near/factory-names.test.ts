import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFactoryVault, validVaultName } from "./factory-names";

// Must match valid_name in contracts/factory/src/lib.rs exactly.
describe("factory vault names", () => {
  it("accepts what the factory accepts", () => {
    for (const ok of ["treasury", "ab", "dao-2026", "my_vault", "a1", "x".repeat(32)]) assert.ok(validVaultName(ok), ok);
  });
  it("refuses what the factory refuses", () => {
    for (const bad of ["", "a", "Treasury", "a.b", "-ab", "ab-", "a--b", "a-_b", "has space", "x".repeat(33)]) assert.ok(!validVaultName(bad), bad);
  });
  it("recognises only direct children of the factory", () => {
    assert.ok(isFactoryVault("treasury.kitevaults.near"));
    assert.ok(!isFactoryVault("a.treasury.kitevaults.near"));
    assert.ok(!isFactoryVault("treasury.evilkitevaults.near"));
    assert.ok(!isFactoryVault("kitevaults.near"));
  });
});

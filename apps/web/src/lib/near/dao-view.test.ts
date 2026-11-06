import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCalls, vaultProposalKind, type DaoProposal } from "./dao";
import {
  callRisk,
  canApprove,
  cleanAccount,
  foreignOwner,
  isLapsed,
  isOpen,
  nearFromYocto,
  openOffer,
  openProposalFor,
  ownerProposal,
  rightsOf,
  statusLabel,
  summarizeCall,
} from "./dao-view";

const VAULT = "kite.alice.near";
const DAY_NS = (86_400n * 10n ** 9n).toString();
const NOW = Date.UTC(2026, 10, 6);
const nsAgo = (hours: number) => (BigInt(NOW - hours * 3_600_000) * 1_000_000n).toString();
const proposal = (over: Partial<DaoProposal> = {}): DaoProposal => ({
  id: 7,
  proposer: "bob.near",
  description: "",
  kind: vaultProposalKind(VAULT, [{ method: "pause", args: {} }]),
  status: "InProgress",
  submission_time: nsAgo(1),
  ...over,
});

test("account names are cleaned and checked", () => {
  assert.equal(cleanAccount("  Treasury.Sputnik-DAO.near "), "treasury.sputnik-dao.near");
  assert.equal(cleanAccount("a"), null);
  assert.equal(cleanAccount("bad..name.near"), null);
  assert.equal(cleanAccount("has space.near"), null);
  assert.equal(cleanAccount("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
});

test("a vault owned by someone else is detected; unknown owner is not treated as foreign", () => {
  assert.equal(foreignOwner("alice.near", "alice.near"), null);
  assert.equal(foreignOwner("team.sputnik-dao.near", "alice.near"), "team.sputnik-dao.near");
  assert.equal(foreignOwner(undefined, "alice.near"), null);
  assert.equal(foreignOwner("alice.near", null), null);
});

test("an offer is open only until the offered account owns the vault", () => {
  assert.equal(openOffer({ owner: "alice.near", pending_owner: "team.sputnik-dao.near" }), "team.sputnik-dao.near");
  assert.equal(openOffer({ owner: "alice.near", pending_owner: null }), null);
  assert.equal(openOffer({ owner: "alice.near" }), null);
  assert.equal(openOffer({ owner: "team.sputnik-dao.near", pending_owner: "team.sputnik-dao.near" }), null);
});

test("yoctoNEAR prints as short NEAR", () => {
  assert.equal(nearFromYocto(10n ** 23n), "0.1");
  assert.equal(nearFromYocto(10n ** 24n), "1");
  assert.equal(nearFromYocto(25n * 10n ** 22n), "0.25");
  assert.equal(nearFromYocto(0n), "0");
});

test("open, lapsed and approvable proposals", () => {
  assert.ok(isOpen(proposal(), DAY_NS, NOW));
  assert.ok(isOpen(proposal()));
  assert.ok(!isOpen(proposal({ status: "Approved" }), DAY_NS, NOW));
  const old = proposal({ submission_time: nsAgo(25) });
  assert.ok(!isOpen(old, DAY_NS, NOW));
  assert.ok(isLapsed(old, DAY_NS, NOW));
  assert.ok(!isLapsed(proposal({ status: "Rejected", submission_time: nsAgo(25) }), DAY_NS, NOW));

  assert.ok(canApprove(proposal(), VAULT, DAY_NS, NOW));
  assert.ok(!canApprove(proposal(), "kite.mallory.near", DAY_NS, NOW));
  assert.ok(!canApprove(proposal({ kind: { Transfer: { receiver_id: "x.near", amount: "1" } } }), VAULT, DAY_NS, NOW));
  assert.ok(!canApprove(old, VAULT, DAY_NS, NOW));
  assert.equal(statusLabel("InProgress"), "Open");
  assert.equal(statusLabel("Approved"), "Passed");
  assert.equal(statusLabel("Something"), "Something");
});

test("an existing open proposal for the same call is found", () => {
  const list = [proposal({ id: 3, status: "Approved" }), proposal({ id: 9, kind: vaultProposalKind(VAULT, [{ method: "accept_owner", args: {} }]) })];
  assert.equal(openProposalFor(list, "accept_owner", DAY_NS, NOW)?.id, 9);
  assert.equal(openProposalFor(list, "pause", DAY_NS, NOW), null);
});

test("calls that move money or change control are flagged", () => {
  assert.equal(callRisk("withdraw"), "moves-money");
  assert.equal(callRisk("close_vault"), "moves-money");
  assert.equal(callRisk("propose_owner"), "changes-owner");
  assert.equal(callRisk("pause"), null);
  assert.equal(callRisk("set_limits"), null);
});

test("decoded calls read as plain sentences", () => {
  assert.equal(summarizeCall("pause", {}), "Pause the vault");
  assert.equal(summarizeCall("propose_owner", { new_owner: null }), "Withdraw the ownership offer");
  assert.equal(summarizeCall("propose_owner", { new_owner: "x.sputnik-dao.near" }), "Offer the vault to x.sputnik-dao.near");
  assert.equal(
    summarizeCall("set_limits", { limits: { band_bps: 500, max_trade_bps: 1000, max_slippage_bps: 100, max_trades_per_day: 1 } }),
    "Set guardrails: steps in at 5 pts, biggest trade 10%, worst price 1.00%, 1 trade a day",
  );
  assert.equal(summarizeCall("withdraw", { token: "nep141:usdc", amount: "5", receiver_id: "m.near" }), "Withdraw 5 of nep141:usdc to m.near");
  assert.equal(summarizeCall("mystery", { a: 1 }), 'mystery {"a":1}');
});

test("each owner button proposes exactly one call on the vault", () => {
  const cases = [
    [{ kind: "accept", offeredBy: "alice.near" }, "accept_owner", {}],
    [{ kind: "pause" }, "pause", {}],
    [{ kind: "unpause" }, "unpause", {}],
    [{ kind: "revoke" }, "revoke_agent", {}],
    [{ kind: "restore", publicKey: "ed25519:abc", allowanceYocto: "250000000000000000000000" }, "set_agent", { public_key: "ed25519:abc", allowance_yocto: "250000000000000000000000" }],
  ] as const;
  for (const [action, method, args] of cases) {
    const p = ownerProposal(VAULT, action);
    assert.deepEqual(p.calls, [{ method, args }]);
    assert.ok(p.description.includes(VAULT), p.description);
    // What a voter sees decodes back to the same call.
    assert.deepEqual(describeCalls(vaultProposalKind(VAULT, p.calls)), [{ method, args }]);
  }
  const limits = { band_bps: 500, max_trade_bps: 1000, max_slippage_bps: 100, max_trades_per_day: 4, min_interval_secs: 14_400, settle_window_secs: 1_800 };
  const l = ownerProposal(VAULT, { kind: "limits", contractLimits: limits });
  assert.deepEqual(l.calls, [{ method: "set_limits", args: { limits } }]);
  assert.match(l.description, /steps in at 5 pts, biggest trade 10%, worst price 1\.00%, 4 trades a day/);
  assert.match(ownerProposal(VAULT, { kind: "restore", publicKey: "k", allowanceYocto: "250000000000000000000000" }).description, /0\.25 NEAR/);
});

test("rights come from the roles the account holds", () => {
  const policy = {
    roles: [
      { name: "all", kind: "Everyone", permissions: ["*:AddProposal"] },
      { name: "council", kind: { Group: ["carol.near", "dave.near"] }, permissions: ["*:*"] },
    ],
  };
  assert.deepEqual(rightsOf(policy, "carol.near"), { roles: ["all", "council"], propose: true, approve: true, tokenWeighted: false });
  assert.deepEqual(rightsOf(policy, "eve.near"), { roles: ["all"], propose: true, approve: false, tokenWeighted: false });
  assert.deepEqual(rightsOf(policy, null), { roles: ["all"], propose: true, approve: false, tokenWeighted: false });
  const narrow = { roles: [{ name: "council", kind: { Group: ["carol.near"] }, permissions: ["transfer:VoteApprove", "call:AddProposal"] }] };
  assert.deepEqual(rightsOf(narrow, "carol.near"), { roles: ["council"], propose: true, approve: false, tokenWeighted: false });
  const weighted = { roles: [{ name: "holders", kind: { Member: "1" }, permissions: ["*:*"] }] };
  assert.equal(rightsOf(weighted, "carol.near").tokenWeighted, true);
});

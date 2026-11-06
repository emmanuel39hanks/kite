import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NEAR } from "./config";
import { decodeArgs, encodeArgs, touchesVault, type ProposalKind } from "./dao";
import { moveIntoVaultProposal, sendUsdcToDaoActions, usdcFromInput } from "./dao-fund";
import { callRisk, summarizeCall } from "./dao-view";

const VAULT = "treasury.kitevaults.near";
const fc = (receiver_id: string, method_name: string, args: Record<string, unknown>): ProposalKind => ({
  FunctionCall: { receiver_id, actions: [{ method_name, args: encodeArgs(args), deposit: "1", gas: "100000000000000" }] },
});

describe("DAO funding", () => {
  it("reads dollar amounts the way people type them", () => {
    assert.equal(usdcFromInput("3"), 3_000_000n);
    assert.equal(usdcFromInput("3.5"), 3_500_000n);
    assert.equal(usdcFromInput(" 0.25 "), 250_000n);
    assert.equal(usdcFromInput("1.123456"), 1_123_456n);
    for (const bad of ["", "0", "0.00", "-1", "1.1234567", "1e3", "abc", "1,5"]) assert.equal(usdcFromInput(bad), null, bad);
  });

  it("moves the DAO's USDC to NEAR Intents for this vault, and nothing else", () => {
    const a = moveIntoVaultProposal(VAULT, 3_000_000n, 0n) as unknown as { functionCall: { methodName: string; args: Uint8Array } };
    assert.equal(a.functionCall.methodName, "add_proposal");
    const { proposal } = JSON.parse(new TextDecoder().decode(a.functionCall.args)) as { proposal: { kind: ProposalKind } };
    const call = proposal.kind.FunctionCall;
    assert.equal(call.receiver_id, NEAR.usdcContract);
    assert.equal(call.actions.length, 1);
    assert.equal(call.actions[0].method_name, "ft_transfer_call");
    assert.equal(call.actions[0].deposit, "1");
    assert.deepEqual(decodeArgs(call.actions[0].args), { receiver_id: NEAR.intents, amount: "3000000", msg: VAULT });
    assert.ok(touchesVault(proposal.kind, VAULT));
  });

  it("registers the DAO with the USDC contract only when it has to", () => {
    assert.equal(sendUsdcToDaoActions("x.sputnik-dao.near", 1n, true).length, 1);
    assert.equal(sendUsdcToDaoActions("x.sputnik-dao.near", 1n, false).length, 2);
  });

  it("counts a proposal as the vault's only when the money goes to this vault", () => {
    assert.ok(touchesVault(fc(VAULT, "pause", {}), VAULT));
    assert.ok(touchesVault(fc(NEAR.usdcContract, "ft_transfer_call", { receiver_id: NEAR.intents, amount: "1", msg: VAULT }), VAULT));
    // Another vault, another receiver inside the transfer, or another method: not this vault's.
    assert.ok(!touchesVault(fc(NEAR.usdcContract, "ft_transfer_call", { receiver_id: NEAR.intents, amount: "1", msg: "other.kitevaults.near" }), VAULT));
    assert.ok(!touchesVault(fc(NEAR.usdcContract, "ft_transfer_call", { receiver_id: "thief.near", amount: "1", msg: VAULT }), VAULT));
    assert.ok(!touchesVault(fc(NEAR.usdcContract, "ft_transfer", { receiver_id: VAULT, amount: "1" }), VAULT));
    assert.ok(!touchesVault({ Transfer: {} }, VAULT));
  });

  it("tells voters in plain words, and flags both as moving money", () => {
    assert.equal(summarizeCall("ft_transfer_call", { receiver_id: NEAR.intents, amount: "3000000", msg: VAULT }), `Move 3.00 USDC from the DAO into vault ${VAULT}`);
    assert.match(summarizeCall("allocate", { transfers: [{ amount: "1500000", to: "x", token: "y" }] }), /^Send an amount to a swap address\. Kite checks/);
    assert.equal(callRisk("ft_transfer_call"), "moves-money");
    assert.equal(callRisk("allocate"), "moves-money");
  });
});

import { verifyAllocateProposal } from "./allocate-check";
import { quotesUntil, usdcExact } from "./dao-fund";
import { allocateCalls } from "./vault";

const USDC = NEAR.usdc;
const BTC = "nep141:nbtc.bridge.near";
const NOW = Date.parse("2026-11-07T12:00:00Z");
const swap = (o: Record<string, unknown> = {}) => ({
  quoteResponse: {
    quoteRequest: {
      recipient: VAULT, refundTo: VAULT, recipientType: "INTENTS", refundType: "INTENTS", depositType: "INTENTS",
      originAsset: USDC, destinationAsset: BTC, amount: "1000000", dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100,
      appFees: [{ recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 20 }],
      deadline: "2026-11-08T12:00:00Z", ...o,
    },
  },
});
const check = (o: Record<string, unknown> = {}, t: Record<string, unknown> = {}) =>
  verifyAllocateProposal({ transfers: [{ token: USDC, amount: "1000000", to: "addr1", ...t }], vault: VAULT, planTokens: [BTC, USDC], nowMs: NOW, fetchStatus: async () => swap(o) });

describe("checking a DAO's invest proposal before offering a vote", () => {
  it("passes a swap that pays this vault, and says when its quote ends", async () => {
    const [s] = await check();
    assert.equal(s.buy, BTC);
    assert.equal(s.deadlineMs, Date.parse("2026-11-08T12:00:00Z"));
  });
  it("refuses anything else", async () => {
    for (const o of [{ recipient: "thief.near" }, { refundTo: "thief.near" }, { recipientType: "ORIGIN_CHAIN" }, { destinationAsset: "nep141:other" }, { amount: "999" }, { originAsset: BTC }, { dry: true }, { deadline: "2026-11-07T11:00:00Z" }, { referral: "x" }, { appFees: [{ recipient: "thief", fee: 20 }] }, { slippageTolerance: 900 }])
      await assert.rejects(check(o), JSON.stringify(o));
    await assert.rejects(check({}, { amount: "1e6" }));
    await assert.rejects(verifyAllocateProposal({ transfers: [], vault: VAULT, planTokens: [BTC], nowMs: NOW, fetchStatus: async () => swap() }));
    await assert.rejects(verifyAllocateProposal({ transfers: [{ token: USDC, amount: "1000000", to: "a" }], vault: VAULT, planTokens: [BTC], nowMs: NOW, fetchStatus: async () => { throw new Error("404"); } }));
  });
});

describe("invest helpers", () => {
  it("puts one transfer in each allocate call, because NEAR refuses a joint promise", () => {
    const calls = allocateCalls([{ token: USDC, amount: "1", to: "a" }, { token: USDC, amount: "2", to: "b" }]);
    assert.deepEqual(calls, [
      { method: "allocate", args: { transfers: [{ token: USDC, amount: "1", to: "a" }] } },
      { method: "allocate", args: { transfers: [{ token: USDC, amount: "2", to: "b" }] } },
    ]);
  });
  it("reads the quote deadline it wrote, and shows USDC exactly", () => {
    assert.equal(quotesUntil("…\nQuotes valid until 2026-11-09T16:47:47Z. If this passes later…"), Date.parse("2026-11-09T16:47:47Z"));
    assert.equal(quotesUntil("no date here"), null);
    assert.equal(usdcExact(3_456_789n), "3.456789");
    assert.equal(usdcExact(3_000_000n), "3");
    assert.equal(usdcExact(250_000n), "0.25");
  });
});

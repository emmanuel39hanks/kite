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
    assert.match(summarizeCall("allocate", { transfers: [{ amount: "1500000" }, { amount: "750000" }] }), /^Invest 2\.25 USDC in the plan: 2 swaps/);
    assert.equal(callRisk("ft_transfer_call"), "moves-money");
    assert.equal(callRisk("allocate"), "moves-money");
  });
});

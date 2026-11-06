/**
 * DAO-owned vaults. A SputnikDAO (the contract behind Trezu and most NEAR DAOs) can own a Kite vault:
 * a person creates the vault, offers it with `propose_owner`, and the DAO takes it by passing a proposal
 * that calls `accept_owner`. From then on every owner action is a DAO proposal that calls the vault.
 *
 * Proposal format checked against sputnik-dao-contract v3.2 (the factory's default code on mainnet):
 * `add_proposal` must attach exactly `policy.proposal_bond`, and `act_proposal` must repeat the proposal's
 * `kind` as stored, or v3 refuses it (ERR_WRONG_KIND).
 */
import { actionCreators } from "@near-js/transactions";
import { JsonRpcProvider } from "near-api-js";
import { NEAR } from "./config";

const TGAS = 10n ** 12n;
/** Gas each vault call gets when the proposal executes. Owner calls need well under this. */
const CALL_GAS = (100n * TGAS).toString();

export type VaultCall = { method: string; args: Record<string, unknown> };

export type ProposalKind = {
  FunctionCall: {
    receiver_id: string;
    actions: { method_name: string; args: string; deposit: string; gas: string }[];
  };
};

export type DaoProposal = {
  id: number;
  proposer: string;
  description: string;
  kind: ProposalKind | Record<string, unknown>;
  status: string;
  submission_time: string;
};

export type DaoInfo = { dao: string; bond: bigint; councilSize: number | null };

/** A SputnikDAO lives at `<name>.sputnik-dao.near` on mainnet. Other accounts are read but not assumed. */
export const looksLikeSputnikDao = (account: string) => /^[a-z0-9_-]{2,}\.sputnik-dao\.near$/.test(account);

/** JSON args as SputnikDAO stores them: base64 of the UTF-8 JSON. */
export function encodeArgs(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeArgs(b64: string): unknown {
  try {
    const s = atob(b64);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** The proposal kind for a set of calls on one vault. Each call attaches 1 yoctoNEAR, which owner methods need. */
export function vaultProposalKind(vault: string, calls: VaultCall[]): ProposalKind {
  return {
    FunctionCall: {
      receiver_id: vault,
      actions: calls.map((c) => ({ method_name: c.method, args: encodeArgs(c.args), deposit: "1", gas: CALL_GAS })),
    },
  };
}

/** A council member (or anyone the DAO's policy allows) asks the DAO to make these calls on the vault. */
export function addProposalAction(vault: string, description: string, calls: VaultCall[], bond: bigint) {
  return actionCreators.functionCall(
    "add_proposal",
    { proposal: { description, kind: vaultProposalKind(vault, calls) } },
    150n * TGAS,
    bond,
  );
}

/** Approve a proposal. The vote that reaches the threshold runs the calls, so it carries enough gas for them. */
export function approveAction(id: number, kind: DaoProposal["kind"]) {
  return actionCreators.functionCall("act_proposal", { id, action: "VoteApprove", proposal: kind }, 300n * TGAS, 0n);
}

/* ───────────── reads ───────────── */

const provider = new JsonRpcProvider({ url: NEAR.rpc });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

/** The DAO's proposal bond and, when the policy has a council role, how many members it has. */
export async function readDao(dao: string): Promise<DaoInfo> {
  const policy = await view<{ proposal_bond: string; roles?: { name: string; kind: { Group?: string[] } | string }[] }>(dao, "get_policy");
  const council = policy.roles?.find((r) => r.name === "council" && typeof r.kind === "object" && Array.isArray(r.kind.Group));
  return {
    dao,
    bond: BigInt(policy.proposal_bond),
    councilSize: council && typeof council.kind === "object" ? (council.kind.Group?.length ?? null) : null,
  };
}

/** The DAO's most recent proposals that call this vault, newest first. */
export async function vaultProposals(dao: string, vault: string, scan = 100): Promise<DaoProposal[]> {
  const last = await view<number>(dao, "get_last_proposal_id");
  const from = Math.max(0, last - scan);
  const list = await view<DaoProposal[]>(dao, "get_proposals", { from_index: from, limit: scan });
  return list
    .filter((p) => {
      const fc = (p.kind as ProposalKind).FunctionCall;
      return fc && fc.receiver_id === vault;
    })
    .reverse();
}

/** What a proposal would call on the vault, decoded for display. */
export function describeCalls(kind: DaoProposal["kind"]): { method: string; args: unknown }[] {
  const fc = (kind as ProposalKind).FunctionCall;
  return fc ? fc.actions.map((a) => ({ method: a.method_name, args: decodeArgs(a.args) })) : [];
}

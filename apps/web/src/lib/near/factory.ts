/**
 * Kite's vault factory (contracts/factory). A DAO creates its own vault by passing a proposal that calls
 * `create_vault` on the factory: the vault is `<name>.<factory>`, the DAO owns it from the first block, and
 * no person's wallet ever holds it. The factory is locked (no keys) and deploys the same vault code as the app.
 */
import { actionCreators } from "@near-js/transactions";
import type { Slice } from "@/lib/mix";
import type { Guardrails } from "@/lib/store";
import { NEAR } from "./config";
import { decodeArgs, encodeArgs, type DaoProposal, type ProposalKind } from "./dao";
import { toContractLimits, toContractPlan } from "./vault";
import { nearProvider } from "@/lib/near/rpc";

const TGAS = 10n ** 12n;
/** Gas for `create_vault` when the proposal runs: create, deploy ~239 KB, `new`, the key, and the callback. */
const CREATE_GAS = (150n * TGAS).toString();

const yocto = (near: string) => {
  const [w, f = ""] = near.split(".");
  return BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
};
export const factoryDepositYocto = () => yocto(NEAR.factoryDepositNear);

export { factoryVaultId, isFactoryVault, validVaultName } from "./factory-names";
import { factoryVaultId } from "./factory-names";

/** `create_vault` args for a plan and its guardrails, with Kite's key. */
export function createVaultArgs(name: string, mix: Slice[], g: Guardrails) {
  return { name, plan: toContractPlan(mix), limits: toContractLimits(g), agent: NEAR.agentPublicKey || null };
}

/** The proposal kind: the DAO calls the factory, paying the vault's 2.6 NEAR from its own balance. */
export function createVaultKind(name: string, mix: Slice[], g: Guardrails): ProposalKind {
  return {
    FunctionCall: {
      receiver_id: NEAR.factory,
      actions: [{ method_name: "create_vault", args: encodeArgs(createVaultArgs(name, mix, g)), deposit: factoryDepositYocto().toString(), gas: CREATE_GAS }],
    },
  };
}

export function createVaultDescription(dao: string, name: string, mix: Slice[], g: Guardrails, assetName: (id: Slice["id"]) => string) {
  const mixText = mix.map((s) => `${assetName(s.id)} ${s.weight}%`).join(", ");
  return [
    `Create our Kite vault ${factoryVaultId(name)}.`,
    ``,
    `It belongs to ${dao} from the start: every change to it, and every withdrawal, needs a vote here. Kite's key on it can only call rebalance and settle, and the vault refuses any trade outside these limits.`,
    ``,
    `Target mix: ${mixText}.`,
    `Rebalance when anything drifts ${g.driftBand} points; at most ${g.maxTradePct}% of the vault in one trade; a trade may return at most ${g.slippageBps / 100}% less than fair value at Kite's prices; up to ${g.tradesPerDay} trades a day.`,
    ``,
    `Cost: ${NEAR.factoryDepositNear} NEAR from the DAO. The vault keeps it for its code's storage (about 2.39 NEAR) and for the gas Kite's checks spend (at most 0.25 NEAR before the key must be renewed); a few thousandths stay with the factory for its record. Whatever is left comes back to the DAO when the vault is closed. Made by ${NEAR.factory}, a contract with no keys that deploys the vault code published at usekite.xyz/vault/kite_vault.wasm.`,
  ].join("\n");
}

/** A council member asks the DAO to create the vault. */
export function createVaultProposalAction(dao: string, name: string, mix: Slice[], g: Guardrails, bond: bigint, assetName: (id: Slice["id"]) => string) {
  return actionCreators.functionCall(
    "add_proposal",
    { proposal: { description: createVaultDescription(dao, name, mix, g, assetName), kind: createVaultKind(name, mix, g) } },
    150n * TGAS,
    bond,
  );
}

/* ───────────── reads ───────────── */

const provider = nearProvider();
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

export type FactoryConfig = { vault_code_hash: string; vault_code_bytes: number; intents: string; min_deposit: string; max_deposit: string; agent_allowance: string; vaults: number };
export type FactoryVault = { vault: string; creator: string; created_ns: number };

/** The factory's settings, or null if it isn't deployed yet. */
export async function readFactory(): Promise<FactoryConfig | null> {
  try {
    return await view<FactoryConfig>(NEAR.factory, "get_config");
  } catch {
    return null;
  }
}

export const factoryVaultsBy = (creator: string) => view<FactoryVault[]>(NEAR.factory, "get_vaults_by", { creator, from_index: 0, limit: 100 });

/** NEAR the factory owes `account` from a creation that failed before its refund could be sent. */
export const refundOwed = async (account: string) => BigInt((await view<string>(NEAR.factory, "get_refund", { owner: account }).catch(() => "0")) ?? "0");

/** A DAO asks the factory for that refund. */
export function claimRefundProposalAction(bond: bigint) {
  return actionCreators.functionCall(
    "add_proposal",
    {
      proposal: {
        description: `Claim back the NEAR that ${NEAR.factory} owes this DAO from a vault creation that failed. The factory keeps it until the DAO asks.`,
        kind: { FunctionCall: { receiver_id: NEAR.factory, actions: [{ method_name: "claim_refund", args: encodeArgs({}), deposit: "0", gas: (30n * TGAS).toString() }] } },
      },
    },
    150n * TGAS,
    bond,
  );
}

/**
 * Whose vault `name` really is. A name is public while a DAO votes, so someone else can create it first; the
 * DAO's proposal then fails safely, but the name now belongs to them. Never treat it as the DAO's without this.
 */
export async function vaultBelongsTo(name: string, dao: string): Promise<boolean> {
  const id = factoryVaultId(name);
  const [entry, status] = await Promise.all([
    view<FactoryVault | null>(NEAR.factory, "get_vault", { vault: id }).catch(() => null),
    view<{ owner: string }>(id, "get_status").catch(() => null),
  ]);
  return entry?.creator === dao && status?.owner === dao;
}

/** Free when neither the factory nor NEAR knows the account. */
export async function vaultNameFree(name: string): Promise<boolean> {
  const id = factoryVaultId(name);
  const known = await view<FactoryVault | null>(NEAR.factory, "get_vault", { vault: id }).catch(() => null);
  if (known) return false;
  try {
    await provider.viewAccount({ accountId: id });
    return false;
  } catch {
    return true;
  }
}

/** The DAO's NEAR balance, less what its own storage locks. */
export async function spendableNear(account: string): Promise<bigint> {
  const a = await provider.viewAccount({ accountId: account });
  const locked = BigInt(a.storage_usage) * 10n ** 19n;
  return a.amount > locked ? a.amount - locked : 0n;
}

/** The newest proposal `proposer` filed on `dao` that asks the factory to create `name`, among the last `scan`. */
export async function findCreateProposal(dao: string, proposer: string, name: string, scan = 30): Promise<DaoProposal | null> {
  const last = await view<number>(dao, "get_last_proposal_id");
  const list = await view<DaoProposal[]>(dao, "get_proposals", { from_index: Math.max(0, last - scan), limit: scan });
  const mine = list.filter((p) => {
    const fc = (p.kind as ProposalKind).FunctionCall;
    const a = fc?.receiver_id === NEAR.factory && fc.actions.length === 1 && fc.actions[0].method_name === "create_vault" ? (decodeArgs(fc.actions[0].args) as { name?: unknown } | null) : null;
    return p.proposer === proposer && a?.name === name;
  });
  return mine.sort((a, b) => b.id - a.id)[0] ?? null;
}

/** The vault name a create proposal asks for, read from the proposal itself. */
export function proposalVaultName(p: DaoProposal): string | null {
  const fc = (p.kind as ProposalKind).FunctionCall;
  const a = fc?.actions[0] ? (decodeArgs(fc.actions[0].args) as { name?: unknown } | null) : null;
  return typeof a?.name === "string" ? a.name : null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

const sha256b58 = async (url: string) => {
  const r = await fetch(url).catch(() => null);
  return r?.ok ? base58(new Uint8Array(await crypto.subtle.digest("SHA-256", await r.arrayBuffer()))) : null;
};

/**
 * True only when the factory has no keys, runs exactly the factory code this site serves (checked against
 * NEAR's own code hash for the account, not the factory's word), and so deploys this site's vault code.
 */
export async function factoryVerified(cfg: FactoryConfig): Promise<{ locked: boolean; sameCode: boolean }> {
  const [keys, account, factoryHash, vaultHash] = await Promise.all([
    provider.viewAccessKeyList({ accountId: NEAR.factory }).catch(() => null),
    provider.viewAccount({ accountId: NEAR.factory }).catch(() => null),
    sha256b58(NEAR.factoryWasmUrl),
    sha256b58(NEAR.wasmUrl),
  ]);
  const sameCode = !!factoryHash && String(account?.code_hash) === factoryHash && !!vaultHash && vaultHash === cfg.vault_code_hash;
  return { locked: !!keys && keys.keys.length === 0, sameCode };
}

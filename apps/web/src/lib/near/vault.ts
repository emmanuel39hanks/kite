/**
 * Builds the vault transactions the console asks a wallet to sign, and reads
 * vault state from chain. Mirrors contracts/vault/src/lib.rs.
 */
import { actionCreators } from "@near-js/transactions";
import { PublicKey } from "@near-js/crypto";
import { JsonRpcProvider } from "near-api-js";
import { assetById } from "@/lib/assets";
import type { Slice } from "@/lib/mix";
import type { Guardrails } from "@/lib/store";
import { NEAR } from "./config";

export type ContractTarget = { token: string; target_bps: number; decimals: number; max_slippage_bps?: number };
export type ContractLimits = {
  band_bps: number;
  max_trade_bps: number;
  max_slippage_bps: number;
  max_trades_per_day: number;
  min_interval_secs: number;
  settle_window_secs: number;
};

const yocto = (near: string) => {
  const [w, f = ""] = near.split(".");
  return BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
};
const TGAS = 10n ** 12n;

function toContractPlan(mix: Slice[]): ContractTarget[] {
  return mix.map((s) => {
    const a = assetById(s.id);
    if (!a.live || !a.intentsId) throw new Error(`${a.name} can't be held yet`);
    return { token: a.intentsId, target_bps: Math.round(s.weight * 100), decimals: a.decimals, ...(a.slippageBps ? { max_slippage_bps: a.slippageBps } : {}) };
  });
}

export function toContractLimits(g: Guardrails): ContractLimits {
  return {
    band_bps: g.driftBand * 100,
    max_trade_bps: g.maxTradePct * 100,
    max_slippage_bps: g.slippageBps,
    max_trades_per_day: g.tradesPerDay,
    min_interval_secs: 14_400, // four hours: at most 6 trades a day however many the owner allows
    settle_window_secs: 1_800,
  };
}

/** The contract's limits as the console's guardrails. */
export function fromContractLimits(l: ContractLimits): Guardrails {
  return { driftBand: l.band_bps / 100, maxTradePct: l.max_trade_bps / 100, slippageBps: l.max_slippage_bps, tradesPerDay: l.max_trades_per_day };
}

/** Gas allowance put on Kite's key when it is restored: NEAR.agentAllowanceNear in yoctoNEAR. */
export const agentAllowanceYocto = () => yocto(NEAR.agentAllowanceNear).toString();

/**
 * One transaction, signed by the owner, sent to `kite.<owner>`:
 * create the account, fund its storage, deploy the vault, initialise it, and
 * add Kite's key limited to `rebalance` and `settle`.
 */
export async function createVaultActions(owner: string, vault: string, mix: Slice[], g: Guardrails) {
  const code = new Uint8Array(await (await fetch(NEAR.wasmUrl)).arrayBuffer());
  const agent = PublicKey.fromString(NEAR.agentPublicKey);
  return [
    actionCreators.createAccount(),
    actionCreators.transfer(yocto(NEAR.vaultStorageNear)),
    actionCreators.deployContract(code),
    actionCreators.functionCall(
      "new",
      { owner, plan: toContractPlan(mix), limits: toContractLimits(g), agent: NEAR.agentPublicKey, intents: NEAR.intents },
      100n * TGAS,
      0n,
    ),
    actionCreators.addKey(agent, actionCreators.functionCallAccessKey(vault, ["rebalance", "settle"], yocto(NEAR.agentAllowanceNear))),
  ];
}

/** Owner calls on the vault carry 1 yoctoNEAR, which forces a full-access signature. */
export const ownerCall = (method: string, args: object, tgas = 100n) => actionCreators.functionCall(method, args, tgas * TGAS, 1n);

/** Deposit USDC held in the owner's NEAR wallet straight into the vault's NEAR Intents balance. */
export const depositUsdcFromWallet = (vault: string, amountBase: bigint) =>
  actionCreators.functionCall(
    "ft_transfer_call",
    { receiver_id: NEAR.intents, amount: amountBase.toString(), msg: vault },
    100n * TGAS,
    1n,
  );

/* ───────────── reads ───────────── */

const provider = new JsonRpcProvider({ url: NEAR.rpc });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

export type VaultStatus = {
  owner: string;
  /** An account the owner offered the vault to (e.g. a DAO), until it accepts. Absent on older vaults. */
  pending_owner?: string | null;
  agent: string | null;
  paused: boolean;
  pending: null | { sell: string; buy: string; amount_in: string; min_out: string; deposit_address: string; started_ns: number };
  trades_today: number;
  last_trade_ns: number;
};

export type VaultState = { plan: ContractTarget[]; limits: ContractLimits; status: VaultStatus; balances: bigint[] };

export async function vaultExists(vault: string): Promise<boolean> {
  try {
    await view<ContractTarget[]>(vault, "get_plan");
    return true;
  } catch {
    return false;
  }
}

export async function readVault(vault: string): Promise<VaultState> {
  const [plan, limits, status] = await Promise.all([
    view<ContractTarget[]>(vault, "get_plan"),
    view<ContractLimits>(vault, "get_limits"),
    view<VaultStatus>(vault, "get_status"),
  ]);
  const balances = await view<string[]>(NEAR.intents, "mt_batch_balance_of", { account_id: vault, token_ids: plan.map((t) => t.token) });
  return { plan, limits, status, balances: balances.map((b) => BigInt(b)) };
}

/**
 * NEAR Kite's key can still spend on gas, or null if unknown: the smaller of the key's allowance and the
 * vault's NEAR not locked for storage. The keeper refuses to trade under 0.05; the owner tops it up.
 */
export async function kiteGasLeft(vault: string): Promise<number | null> {
  if (!NEAR.agentPublicKey) return null;
  try {
    const q = (r: Record<string, string>) => provider.query({ finality: "final", account_id: vault, ...r } as never) as unknown;
    const [key, acct] = (await Promise.all([q({ request_type: "view_access_key", public_key: NEAR.agentPublicKey }), q({ request_type: "view_account" })])) as [
      { permission?: { FunctionCall?: { allowance?: string | null } } | string },
      { amount: string; storage_usage: number },
    ];
    const free = BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n;
    let left = free > 0n ? free : 0n;
    const allowance = typeof key.permission === "object" ? key.permission.FunctionCall?.allowance : null;
    if (allowance != null && BigInt(allowance) < left) left = BigInt(allowance);
    return Number(left / 10n ** 18n) / 1e6;
  } catch {
    return null;
  }
}

/** Spendable NEAR on an account, in NEAR (not yocto). */
export async function nearBalance(account: string): Promise<number> {
  try {
    const r = (await provider.query({ request_type: "view_account", finality: "final", account_id: account })) as unknown as { amount: string };
    return Number(BigInt(r.amount) / 10n ** 18n) / 1e6;
  } catch {
    return 0;
  }
}

export async function usdcBalance(account: string): Promise<bigint> {
  try {
    return BigInt(await view<string>(NEAR.usdcContract, "ft_balance_of", { account_id: account }));
  } catch {
    return 0n;
  }
}

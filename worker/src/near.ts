import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import type { Limits, Target } from "./drift.js";

export const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.fastnear.com";
export const INTENTS = process.env.INTENTS_CONTRACT ?? "intents.near";

export const provider = new JsonRpcProvider({ url: RPC });

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

export type Status = {
  owner: string;
  agent: string | null;
  paused: boolean;
  pending: null | { sell: string; buy: string; amount_in: string; min_out: string; deposit_address: string; started_ns: number };
  trades_today: number;
  last_trade_ns: number;
};

export async function readVault(vault: string) {
  const [plan, limits, status] = await Promise.all([
    view<Target[]>(vault, "get_plan"),
    view<Limits>(vault, "get_limits"),
    view<Status>(vault, "get_status"),
  ]);
  const balances = await view<string[]>(INTENTS, "mt_batch_balance_of", {
    account_id: vault,
    token_ids: plan.map((t) => t.token),
  });
  return { plan, limits, status, balances: balances.map((b) => BigInt(b)) };
}

/** The agent signs as the vault account, with its function-call key (rebalance/settle only). */
function agent(vault: string) {
  const key = process.env.KITE_AGENT_KEY as KeyPairString | undefined;
  if (!key) throw new Error("KITE_AGENT_KEY is not set (the vault's function-call private key)");
  return new Account(vault, provider, key);
}

/** Minimal view of a transaction outcome: the hash and whether it failed. */
export type TxResult = { hash: string | undefined; outcome: unknown };

export async function callRebalance(
  vault: string,
  args: { quote: string; signature: string; prices: { token: string; usd_e6: string }[] },
): Promise<TxResult> {
  const outcome = await agent(vault).signAndSendTransaction({
    receiverId: vault,
    actions: [actions.functionCall("rebalance", args, teraToGas("200"), 0n)],
  });
  return { hash: (outcome as { transaction?: { hash?: string } }).transaction?.hash, outcome };
}

export async function callSettle(vault: string): Promise<TxResult> {
  const outcome = await agent(vault).signAndSendTransaction({
    receiverId: vault,
    actions: [actions.functionCall("settle", {}, teraToGas("150"), 0n)],
  });
  return { hash: (outcome as { transaction?: { hash?: string } }).transaction?.hash, outcome };
}

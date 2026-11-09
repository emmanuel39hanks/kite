import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import type { Limits, Target } from "./drift.ts";

/** Tried in order when a server is busy or down. NEAR_RPC, if set, goes first. All are free public mainnet servers. */
export const RPCS = [
  ...(process.env.NEAR_RPC ? [process.env.NEAR_RPC] : []),
  "https://rpc.mainnet.fastnear.com",
  "https://free.rpc.fastnear.com",
  "https://rpc.mainnet.near.org",
  "https://near.drpc.org",
];
export const INTENTS = process.env.INTENTS_CONTRACT ?? "intents.near";

/** Busy or unreachable: worth asking another server. Anything else (a contract panic, a refused key) is the chain's real answer. */
export function isBusy(e: unknown): boolean {
  if (e instanceof SyntaxError) return true; // an HTML error page where JSON was expected
  const cause = (e as { cause?: unknown } | null)?.cause;
  if (typeof cause === "number" && [408, 429, 500, 502, 503, 504].includes(cause)) return true;
  const s = e instanceof Error ? `${e.message} ${JSON.stringify(e)}` : JSON.stringify(e ?? "");
  return /\b429\b|rate limit|too many requests|exceeded \d+ attempts|fetch failed|failed to fetch|econn|enotfound|etimedout|timed? ?out|\b50[0234]\b|bad gateway|unavailable|internal server error/i.test(s);
}

/** One provider that moves to the next server when the current one is busy or down, and passes real answers straight through. */
export function failoverProvider(urls: string[]): JsonRpcProvider {
  // Few, quick retries per server: the next server is a better bet than waiting on a busy one.
  const all = urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 300 }));
  let preferred = 0;
  return new Proxy(all[0], {
    get(_target, prop) {
      const first = Reflect.get(all[0], prop);
      if (typeof first !== "function") return first;
      return async (...args: unknown[]) => {
        let last: unknown;
        for (let n = 0; n < all.length; n++) {
          const i = (preferred + n) % all.length;
          try {
            const r = await (Reflect.get(all[i], prop) as (...a: unknown[]) => unknown).apply(all[i], args);
            preferred = i;
            return r;
          } catch (e) {
            if (!isBusy(e)) throw e;
            last = e;
          }
        }
        throw last;
      };
    },
  });
}

export const provider = failoverProvider(RPCS);

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

const YOCTO_PER_BYTE = 10n ** 19n;
/** Each call reserves about 0.05 NEAR of gas up front (refunded a few blocks later; a whole rebalance really costs ~0.0017, measured in contracts/integration-tests). Below this, the next call would be refused. */
export const MIN_GAS_YOCTO = 5n * 10n ** 22n; // 0.05 NEAR

/**
 * What Kite's key can still spend on gas, in yoctoNEAR: the smaller of the key's allowance and the
 * vault's NEAR not locked for storage. When it runs out the key stops working, so check it before trading.
 */
export function gasLeft(allowance: string | null | undefined, amount: bigint, storageUsage: number): bigint {
  const free = amount - BigInt(storageUsage) * YOCTO_PER_BYTE;
  const spare = free > 0n ? free : 0n;
  return allowance == null ? spare : (BigInt(allowance) < spare ? BigInt(allowance) : spare);
}

export async function readGasLeft(vault: string, agentPk: string): Promise<bigint> {
  const [key, acct] = await Promise.all([
    provider.viewAccessKey({ accountId: vault, publicKey: agentPk }),
    provider.viewAccount({ accountId: vault }),
  ]);
  const perm = key.permission as { FunctionCall?: { allowance?: string | null } } | string;
  const allowance = typeof perm === "object" ? perm.FunctionCall?.allowance : undefined;
  return gasLeft(allowance, BigInt(acct.amount), acct.storage_usage);
}

/** The agent signs as the vault account, with its function-call key (rebalance/settle only). */
function agent(vault: string) {
  const key = process.env.KITE_AGENT_KEY as KeyPairString | undefined;
  if (!key) throw new Error("KITE_AGENT_KEY is not set (the vault's function-call private key)");
  return new Account(vault, provider, key);
}

/** Minimal view of a transaction outcome: the hash and whether it failed. */
export type TxResult = { hash: string | undefined; outcome: unknown };

/** Throws if any receipt of the transaction failed. The policy check runs in a callback receipt, so a refused rebalance still "succeeds" at first. */
function assertOk(outcome: unknown, what: string) {
  const o = outcome as { status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] };
  const failed = (s: unknown) => !!s && typeof s === "object" && "Failure" in (s as object);
  if (failed(o.status) || (o.receipts_outcome ?? []).some((r) => failed(r.outcome?.status))) {
    throw new Error(`${what} was refused on chain: ${JSON.stringify(o.status ?? o.receipts_outcome).slice(0, 300)}`);
  }
}

/** The JSON value the last receipt returned (the vault's callback answer), or undefined. */
export function returned(outcome: unknown): unknown {
  const v = (outcome as { status?: { SuccessValue?: string } }).status?.SuccessValue;
  if (!v) return undefined;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function callRebalance(
  vault: string,
  args: { quote: string; signature: string; prices: { token: string; usd_e6: string }[] },
): Promise<TxResult> {
  const outcome = await agent(vault).signAndSendTransaction({
    receiverId: vault,
    actions: [actions.functionCall("rebalance", args, teraToGas("200"), 0n)],
  });
  assertOk(outcome, "The rebalance");
  // on_rebalance_sent answers false when the transfer to 1Click failed: nothing left the vault.
  if (returned(outcome) === false) throw new Error("The transfer to the swap address failed. Nothing left the vault.");
  return { hash: (outcome as { transaction?: { hash?: string } }).transaction?.hash, outcome };
}

/** Settles a pending swap. `answer` is the vault's reply: settled, refunded, breaker, waiting or none. */
export async function callSettle(vault: string): Promise<TxResult & { answer: string }> {
  const outcome = await agent(vault).signAndSendTransaction({
    receiverId: vault,
    actions: [actions.functionCall("settle", {}, teraToGas("150"), 0n)],
  });
  assertOk(outcome, "Settling");
  const answer = returned(outcome);
  return { hash: (outcome as { transaction?: { hash?: string } }).transaction?.hash, outcome, answer: typeof answer === "string" ? answer : "unknown" };
}

/**
 * Putting money into a DAO-owned vault. Three steps, because a DAO only moves its own money by vote:
 *   1. Anyone sends USDC to the DAO's account (an ordinary transfer; from a wallet, the console offers it).
 *   2. The DAO votes to move it into the vault: `ft_transfer_call` on the USDC contract to NEAR Intents,
 *      with the vault as the receiver. Only the DAO can do this; the vault never pulls money.
 *   3. The DAO votes to invest it: `vault.allocate` with 1Click deposit addresses that swap into the plan and
 *      pay back to the vault. The quotes last as long as the DAO's voting window (up to 72 hours); if they
 *      lapse or the price moves past 1%, 1Click refunds the USDC to the vault and the DAO can file again.
 */
import { actionCreators } from "@near-js/transactions";
import { JsonRpcProvider } from "near-api-js";
import { verifyAllocation, type Transfer } from "./allocate-check";
import { NEAR } from "./config";
import { addProposalAction } from "./dao";
import { usdcText } from "./dao-view";

const TGAS = 10n ** 12n;
/** What the USDC contract charges to register an account (NEP-145 storage). */
const USDC_STORAGE = 1_250_000_000_000_000_000_000n;
/** Each allocate transfer gets 15 Tgas in the vault; eight of them plus the call itself. */
const ALLOCATE_TGAS = 150;

const provider = new JsonRpcProvider({ url: NEAR.rpc });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

/** USDC an account holds on NEAR (not inside NEAR Intents), in base units. */
export const usdcInWallet = async (account: string) => BigInt(await view<string>(NEAR.usdcContract, "ft_balance_of", { account_id: account }));

/** USDC an account holds inside NEAR Intents, where a vault keeps everything. */
export const usdcInIntents = async (account: string) => BigInt(await view<string>(NEAR.intents, "mt_balance_of", { account_id: account, token_id: NEAR.usdc }));

/** Whether the USDC contract knows this account; a transfer to an unknown account fails. */
export const usdcRegistered = async (account: string) => !!(await view<unknown>(NEAR.usdcContract, "storage_balance_of", { account_id: account }));

/** Dollars typed by a person → USDC base units, or null if it isn't a positive amount with at most 6 decimals. */
export function usdcFromInput(s: string): bigint | null {
  const m = s.trim().match(/^(\d{1,9})(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  const v = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  return v > 0n ? v : null;
}

/** Step 1, from a wallet: register the DAO with the USDC contract if needed, then send it USDC. One transaction. */
export function sendUsdcToDaoActions(dao: string, amount: bigint, registered: boolean) {
  return [
    ...(registered ? [] : [actionCreators.functionCall("storage_deposit", { account_id: dao, registration_only: true }, 30n * TGAS, USDC_STORAGE)]),
    actionCreators.functionCall("ft_transfer", { receiver_id: dao, amount: amount.toString(), memo: "Kite: for the DAO's vault" }, 30n * TGAS, 1n),
  ];
}

/** Step 2: the DAO moves its USDC into the vault's NEAR Intents balance. */
export function moveIntoVaultProposal(vault: string, amount: bigint, bond: bigint) {
  const description = `Move ${usdcText(amount.toString())} USDC from this DAO into its Kite vault ${vault}. It lands in the vault's NEAR Intents balance, where only this DAO can take it out (by vote). Kite's key can't withdraw it; it can only rebalance inside the vault's limits.`;
  return addProposalAction(NEAR.usdcContract, description, [{ method: "ft_transfer_call", args: { receiver_id: NEAR.intents, amount: amount.toString(), msg: vault } }], bond);
}

/**
 * Step 3: quotes for investing the vault's USDC in its plan, checked against NEAR Intents itself, then the
 * proposal that calls `allocate` with them. The quotes stay good for `hours`.
 */
export async function investProposal(opts: { vault: string; plan: { token: string; target_bps: number }[]; usdc: bigint; bond: bigint; hours: number; names: (token: string) => string }) {
  const { vault, plan, usdc, bond, hours, names } = opts;
  const r = await fetch("/api/allocate/quotes", { method: "POST", body: JSON.stringify({ vault, usdc: usdc.toString(), plan, hours }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Couldn't get quotes");
  const quoted = d.transfers as (Transfer & { buy: string; amountOutUsd?: string })[];
  if (!quoted.length) throw new Error("Each share of this vault's USDC is under $0.25, too small to swap. Move more USDC in first.");
  // The DAO votes on addresses a server handed us: check each one with NEAR Intents before anyone files it.
  await verifyAllocation({ transfers: quoted, plan, usdc, usdcToken: NEAR.usdc, vault });
  const transfers = quoted.map(({ token, amount, to }) => ({ token, amount, to }));
  const spent = transfers.reduce((n, t) => n + BigInt(t.amount), 0n);
  const until = new Date(Date.now() + hours * 3600_000).toUTCString().replace(":00 GMT", " UTC");
  const lines = quoted.map((q) => `- ${usdcText(q.amount)} USDC → ${names(q.buy)}${q.amountOutUsd ? ` (about $${Number(q.amountOutUsd).toFixed(2)} after fees)` : ""}`);
  const description = [
    `Invest ${usdcText(spent.toString())} USDC from Kite vault ${vault} in its plan, through NEAR Intents (1Click):`,
    ...lines,
    ``,
    `Every swap pays back to the vault itself. These quotes are good until ${until}. If this passes later, or a price moves more than 1%, 1Click refunds the USDC to the vault and nothing is lost; file again.${spent < usdc ? ` ${usdcText((usdc - spent).toString())} USDC stays in the vault as USDC (shares under $0.25 aren't worth a swap).` : ""}`,
  ].join("\n");
  return { action: addProposalAction(vault, description, [{ method: "allocate", args: { transfers } }], bond, ALLOCATE_TGAS), spent, quoted };
}

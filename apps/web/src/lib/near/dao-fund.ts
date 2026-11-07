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
import { ALLOCATE_TGAS_EACH, allocateCalls } from "./vault";
import { convertQuotes } from "./convert";

const TGAS = 10n ** 12n;
/** What the USDC contract charges to register an account (NEP-145 storage). */
const USDC_STORAGE = 1_250_000_000_000_000_000_000n;

const provider = new JsonRpcProvider({ url: NEAR.rpc });
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

/** When an invest proposal's quotes end, from its description (written by investProposal). Only for display and for
 *  not blocking a new proposal; whether a vote is offered is decided by checking the swaps themselves. */
export function quotesUntil(description: string): number | null {
  const m = description.match(/Quotes valid until (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/);
  return m ? Date.parse(m[1]) : null;
}

/** USDC base units as an exact decimal string, e.g. 3456789n → "3.456789", 3000000n → "3". */
export function usdcExact(base: bigint): string {
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

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
  const until = new Date(Date.now() + hours * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const lines = quoted.map((q) => `- ${usdcText(q.amount)} USDC → ${names(q.buy)}${q.amountOutUsd ? ` (about $${Number(q.amountOutUsd).toFixed(2)} after fees)` : ""}`);
  const description = [
    `Invest ${usdcText(spent.toString())} USDC from Kite vault ${vault} in its plan, through NEAR Intents (1Click):`,
    ...lines,
    ``,
    `Every swap pays back to the vault itself. Quotes valid until ${until}. If this passes later, or a price moves more than 1%, 1Click refunds the USDC to the vault and nothing is lost; file again.${spent < usdc ? ` ${usdcText((usdc - spent).toString())} USDC stays in the vault as USDC (shares under $0.25 aren't worth a swap).` : ""}`,
  ].join("\n");
  // One allocate per swap (see allocateCalls): up to eight actions of 30 Tgas inside act_proposal's 300.
  return { action: addProposalAction(vault, description, allocateCalls(transfers), bond, Number(ALLOCATE_TGAS_EACH)), spent, quoted };
}

/**
 * Everything out of the vault and back to the DAO as USDC, in one proposal. Each holding (USDC too) goes by `withdraw`
 * to a 1Click address that swaps it to USDC and delivers it to the DAO's own NEAR account, refunding to the DAO's
 * NEAR Intents balance if a swap can't complete. The quotes last the voting window (up to 72 hours); voters' pages
 * check each address again before offering a vote.
 */
export async function withdrawAllProposal(opts: { vault: string; dao: string; holdings: { token: string; amount: bigint }[]; hours: number; names: (token: string) => string }) {
  const { vault, dao, holdings, hours, names } = opts;
  const { transfers, skipped } = await convertQuotes(dao, holdings, { includeUsdc: true, hours });
  if (!transfers.length) throw new Error("Nothing in the vault is large enough for NEAR Intents to send back right now.");
  if (transfers.length > 8) throw new Error("More than eight holdings: withdraw in two proposals.");
  const until = new Date(Date.now() + hours * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const total = transfers.reduce((n, t) => n + t.outUsd, 0);
  const description = [
    `Withdraw everything from Kite vault ${vault} back to this DAO as USDC (about $${total.toFixed(2)} after fees):`,
    ...transfers.map((t) => `- ${names(t.token)} → USDC, paid to ${dao}`),
    ``,
    `Quotes valid until ${until}. If this passes later, or a price moves more than 1%, the tokens come back to this DAO's NEAR Intents balance instead.${skipped.length ? ` Too small to send now: ${skipped.map((h) => names(h.token)).join(", ")}.` : ""}`,
  ].join("\n");
  return { description, calls: transfers.map((t) => ({ method: "withdraw", args: { token: t.token, amount: t.amount, receiver_id: t.to } })), gasTgas: 35, total, skipped };
}

/** Close the vault once it's empty: the vault deletes itself and its NEAR deposit goes back to the DAO. */
export const closeVaultCalls = () => ({ calls: [{ method: "close_vault", args: { also_check: [NEAR.usdc] } }], gasTgas: 150 });

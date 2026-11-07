/**
 * Getting money out as dollars. Kite's vault holds many tokens inside NEAR Intents; when money leaves, people want
 * back what they put in (USDC, in their wallet), not a handful of tokens in an Intents account they can't see.
 *  - From the vault: each token goes to a checked 1Click address that swaps it to USDC and delivers it to the owner's
 *    wallet; the vault's own USDC goes to the owner's Intents balance and then out to the wallet.
 *  - From the owner's own Intents balance (e.g. an earlier withdraw): the same, signed by the owner on intents.near.
 */
import { actionCreators } from "@near-js/transactions";
import { JsonRpcProvider } from "near-api-js";
import { ASSETS } from "@/lib/assets";
import { verifyConvert } from "./allocate-check";
import { NEAR } from "./config";

const TGAS = 10n ** 12n;
const provider = new JsonRpcProvider({ url: NEAR.rpc });

export type Holding = { token: string; amount: bigint };
export type ConvertTransfer = { token: string; amount: string; to: string; outUsd: number };

/** Every token Kite knows that `account` holds inside NEAR Intents, non-zero only. */
export async function intentsHoldings(account: string): Promise<Holding[]> {
  const tokens = [...new Set(ASSETS.filter((a) => a.live && a.intentsId).map((a) => a.intentsId!))];
  const res = (await provider.callFunction({ contractId: NEAR.intents, method: "mt_batch_balance_of", args: { account_id: account, token_ids: tokens } })) as string[];
  return tokens.map((token, i) => ({ token, amount: BigInt(res[i] ?? "0") })).filter((h) => h.amount > 0n);
}

/** Quotes to swap each non-USDC holding into USDC delivered to `owner`'s wallet, checked with NEAR Intents itself. */
export async function convertQuotes(owner: string, holdings: Holding[]): Promise<{ transfers: ConvertTransfer[]; skipped: Holding[] }> {
  const others = holdings.filter((h) => h.token !== NEAR.usdc && h.amount > 0n);
  if (!others.length) return { transfers: [], skipped: [] };
  const r = await fetch("/api/convert/quotes", { method: "POST", body: JSON.stringify({ owner, holdings: others.map((h) => ({ token: h.token, amount: h.amount.toString() })) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Couldn't get quotes to convert to USDC");
  const transfers = (d.transfers ?? []) as ConvertTransfer[];
  await verifyConvert({ transfers, owner, usdcToken: NEAR.usdc });
  const done = new Set(transfers.map((t) => t.token));
  return { transfers, skipped: others.filter((h) => !done.has(h.token)) };
}

/** The owner's own Intents balance out to their wallet: each token into a USDC swap, and USDC itself withdrawn. */
export function ownerIntentsToWalletActions(owner: string, transfers: ConvertTransfer[], usdc: bigint) {
  return [
    ...transfers.map((t) => actionCreators.functionCall("mt_transfer", { receiver_id: t.to, token_id: t.token, amount: t.amount, memo: "kite: to USDC in my wallet" }, 30n * TGAS, 1n)),
    ...(usdc > 0n ? [actionCreators.functionCall("ft_withdraw", { token: NEAR.usdcContract, receiver_id: owner, amount: usdc.toString(), memo: "kite: USDC to my wallet" }, 100n * TGAS, 1n)] : []),
  ];
}

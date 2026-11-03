/** Minimal client for the NEAR Intents 1Click API. Docs: https://docs.near-intents.org */

import { createHash, createPublicKey, verify } from "node:crypto";

export const ONECLICK = process.env.ONECLICK_URL ?? "https://1click.chaindefuser.com/v0";

const headers = (): Record<string, string> => ({
  "content-type": "application/json",
  ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}),
});

export type Token = { assetId: string; symbol: string; price: number; decimals: number; blockchain: string; priceUpdatedAt: string };

export async function tokens(): Promise<Token[]> {
  const r = await fetch(`${ONECLICK}/tokens`, { headers: headers() });
  if (!r.ok) throw new Error(`1Click /tokens ${r.status}`);
  return r.json();
}

export async function prices(ids: string[]): Promise<Record<string, number>> {
  const all = await tokens();
  return Object.fromEntries(ids.map((id) => [id, all.find((t) => t.assetId === id)?.price ?? 0]));
}

export type QuoteRequest = {
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  amount: string;
  /** The vault: swapped funds and refunds both go back to it inside NEAR Intents. */
  account: string;
  slippageBps: number;
  deadlineSecs: number;
  /** Attack demo only: ask for a quote that pays (or refunds) someone else. The vault must refuse it. */
  recipientOverride?: string;
  refundOverride?: string;
};

export type Quote = {
  depositAddress?: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountInUsd: string;
  amountOutUsd: string;
  timeEstimate: number;
  deadline?: string;
};

/** A full /quote response: what the vault needs to verify 1Click's signature on-chain. */
export type QuoteResponse = { quote: Quote & Record<string, unknown>; quoteRequest: Record<string, unknown>; signature: string; timestamp: string };

export async function quote(q: QuoteRequest): Promise<Quote> {
  return (await quoteFull(q)).quote;
}

export async function quoteFull(q: QuoteRequest): Promise<QuoteResponse> {
  const body = {
    dry: q.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: q.slippageBps,
    originAsset: q.originAsset,
    depositType: "INTENTS",
    destinationAsset: q.destinationAsset,
    amount: q.amount,
    refundTo: q.refundOverride ?? q.account,
    refundType: "INTENTS",
    recipient: q.recipientOverride ?? q.account,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + q.deadlineSecs * 1000).toISOString(),
  };
  const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || !d.quote) throw new Error(`1Click /quote: ${d.message ?? r.status}`);
  return d as QuoteResponse;
}

/* ───────────── 1Click quote signatures ─────────────
 * 1Click signs ed25519(base58(sha256(json))) where json is the fields below with
 * keys sorted (json-stable-stringify). Mirrors quote-signature.ts in
 * @defuse-protocol/one-click-sdk-typescript 0.1.26. The vault checks the same
 * signature on-chain, so this is only a local pre-check that saves gas.
 */

export const ONE_CLICK_SIGNER = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(buf: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
export function b58decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  const lead = [...s].findIndex((c) => c !== "1");
  return Buffer.concat([Buffer.alloc(lead < 0 ? s.length : lead), n === 0n ? Buffer.alloc(0) : Buffer.from(h, "hex")]);
}

/** JSON with sorted keys and undefined dropped: json-stable-stringify's output for plain data. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

const opt = (x: unknown) => (x ? x : undefined);

/** The exact JSON string 1Click signed for this response. */
export function signedPayload(r: QuoteResponse): string {
  const rq = r.quoteRequest;
  const q = r.quote;
  const request = {
    dry: rq.dry,
    swapType: rq.swapType,
    slippageTolerance: rq.slippageTolerance,
    originAsset: rq.originAsset,
    depositType: rq.depositType,
    destinationAsset: rq.destinationAsset,
    amount: rq.amount,
    refundTo: rq.refundTo,
    refundType: rq.refundType,
    recipient: rq.recipient,
    recipientType: rq.recipientType,
    deadline: rq.deadline,
    quoteWaitingTimeMs: opt(rq.quoteWaitingTimeMs),
    referral: opt(rq.referral),
    virtualChainRecipient: opt(rq.virtualChainRecipient),
    virtualChainRefundRecipient: opt(rq.virtualChainRefundRecipient),
    customRecipientMsg: opt(rq.customRecipientMsg),
  };
  const common = {
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountInUsd: q.amountInUsd,
    minAmountIn: q.minAmountIn,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd,
    minAmountOut: q.minAmountOut,
  };
  const quoted = rq.dry
    ? common
    : {
        ...common,
        depositAddress: opt(q.depositAddress),
        depositMemo: opt(q.depositMemo),
        deadline: opt(q.deadline),
        timeWhenInactive: opt(q.timeWhenInactive),
        timeEstimate: opt(q.timeEstimate),
        refundFee: opt(q.refundFee),
        withdrawFee: opt(q.withdrawFee),
      };
  return stableStringify({ ...request, ...quoted, timestamp: r.timestamp });
}

/** Check a signed payload the way the vault does on-chain. */
export function verifyPayload(payload: string, signature: string, signer = ONE_CLICK_SIGNER): boolean {
  try {
    const message = b58encode(createHash("sha256").update(payload).digest());
    const raw = b58decode(signer.replace(/^ed25519:/, ""));
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message), key, b58decode(signature.replace(/^ed25519:/, "")));
  } catch {
    return false;
  }
}

/** Tell 1Click which transaction funded the deposit address, so solvers start immediately. */
export async function submitDeposit(txHash: string, depositAddress: string): Promise<void> {
  await fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: headers(), body: JSON.stringify({ txHash, depositAddress }) });
}

export async function status(depositAddress: string): Promise<{ status: string; [k: string]: unknown }> {
  const r = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: headers() });
  return r.json();
}

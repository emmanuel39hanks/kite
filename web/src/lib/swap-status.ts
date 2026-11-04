"use client";

import { useEffect, useState } from "react";

/** 1Click's swap statuses (docs.near-intents.org → Check swap execution status). */
export type SwapState = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

type Tx = { hash: string; explorerUrl: string };
export type SwapStatus = {
  status: SwapState | "UNKNOWN";
  updatedAt?: string;
  swapDetails?: {
    originChainTxHashes?: Tx[];
    destinationChainTxHashes?: Tx[];
    nearTxHashes?: string[];
    amountInFormatted?: string;
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
  };
  correlationId?: string;
};

export const isTerminal = (s: SwapStatus["status"]) => s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";

/** Where the money is, in plain words, for each status. */
export function describe(s: SwapStatus["status"]): { step: 1 | 2 | 3; tone: "blue" | "green" | "red" | "amber"; label: string; where: string } {
  switch (s) {
    case "SUCCESS":
      return { step: 3, tone: "green", label: "Delivered", where: "The swap finished and the new asset is in your vault." };
    case "REFUNDED":
      return { step: 3, tone: "amber", label: "Refunded", where: "The swap didn't complete. NEAR Intents sent your money back to your vault. Kite retries on its next check." };
    case "FAILED":
      return { step: 3, tone: "red", label: "Failed", where: "The swap failed. Where the money is now is being checked against your vault balance; nothing is shown as delivered." };
    case "INCOMPLETE_DEPOSIT":
      return { step: 2, tone: "amber", label: "Short deposit", where: "Less arrived at the swap address than the quote needed. NEAR Intents will refund it." };
    case "PROCESSING":
    case "KNOWN_DEPOSIT_TX":
      return { step: 2, tone: "blue", label: "Swapping", where: "Your money is at NEAR Intents' swap address, being exchanged by a solver." };
    default:
      return { step: 1, tone: "blue", label: "Sent", where: "Your vault sent the money to the swap address. Waiting for NEAR Intents to see it." };
  }
}

/** Poll one swap until it reaches a final status. */
export function useSwapStatus(address: string | null) {
  const [st, setSt] = useState<SwapStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!address) return;
    let stop = false;
    let delay = 4000;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/deposit/status?address=${encodeURIComponent(address)}`, { cache: "no-store" });
        const d = (await r.json()) as SwapStatus;
        if (!stop && r.ok) {
          setSt(d);
          setCheckedAt(Date.now());
          if (isTerminal(d.status)) return;
        }
      } catch {}
      delay = Math.min(delay * 1.4, 30_000);
      if (!stop) t = setTimeout(tick, delay);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [address]);
  return { status: st, checkedAt };
}

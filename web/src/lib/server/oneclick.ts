import "server-only";
import { cacheLife } from "next/cache";
import { ASSETS } from "@/lib/assets";

export const ONECLICK = "https://1click.chaindefuser.com/v0";

type Token = { assetId: string; symbol: string; price: number; priceUpdatedAt: string; decimals: number; blockchain: string };

export type LivePrices = {
  /** USD price per asset, keyed by our asset id (btc, eth, …). */
  prices: Record<string, number>;
  updatedAt: string | null;
  source: "near-intents" | "fallback";
};

/** Live USD prices for Kite's routable assets, from NEAR Intents 1Click `/tokens`. Cached for a minute. */
export async function getLivePrices(): Promise<LivePrices> {
  "use cache";
  cacheLife("minutes");
  try {
    const res = await fetch(`${ONECLICK}/tokens`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`1Click /tokens ${res.status}`);
    const tokens = (await res.json()) as Token[];
    const prices: Record<string, number> = {};
    let updatedAt: string | null = null;
    for (const a of ASSETS) {
      if (!a.intentsId) continue;
      const t = tokens.find((x) => x.assetId === a.intentsId);
      if (t && t.price > 0) {
        prices[a.id] = t.price;
        if (!updatedAt || t.priceUpdatedAt > updatedAt) updatedAt = t.priceUpdatedAt;
      }
    }
    return { prices, updatedAt, source: "near-intents" };
  } catch {
    return { prices: Object.fromEntries(ASSETS.map((a) => [a.id, a.price])), updatedAt: null, source: "fallback" };
  }
}

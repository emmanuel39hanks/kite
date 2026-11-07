import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/server/oneclick";
import { clientIp, crossSite, refuseCrossSite, isNearAccount, limited } from "@/lib/server/guards";

/**
 * POST { owner, holdings: [{ token, amount }] }
 * → one 1Click quote per holding: that token, sent from inside NEAR Intents, swapped to USDC and delivered to the
 * owner's NEAR wallet. If a swap can't complete, 1Click refunds the token to the owner's NEAR Intents account.
 * Used when money leaves Kite, so people get back the dollars they put in rather than a pile of tokens.
 * A holding too small for 1Click to quote comes back in `skipped`.
 */
export async function POST(req: Request) {
  if (crossSite(req)) return refuseCrossSite();
  if (limited(`conv:${clientIp(req)}`, 12, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  let body: { owner?: unknown; holdings?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { owner, holdings } = (body ?? {}) as { owner: string; holdings: { token: string; amount: string }[] };
  const sane =
    isNearAccount(owner) &&
    Array.isArray(holdings) && holdings.length >= 1 && holdings.length <= 12 &&
    holdings.every((h) => typeof h?.token === "string" && !!assetByIntentsId(h.token) && h.token !== NEAR.usdc && typeof h.amount === "string" && /^[1-9]\d{0,38}$/.test(h.amount)) &&
    new Set(holdings.map((h) => h.token)).size === holdings.length;
  if (!sane) return Response.json({ error: "Bad request" }, { status: 400 });

  const transfers: { token: string; amount: string; to: string; outUsd: number }[] = [];
  const skipped: { token: string; amount: string; reason: string }[] = [];
  for (const h of holdings) {
    const r = await fetch(`${ONECLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
      body: JSON.stringify({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: h.token,
        depositType: "INTENTS",
        destinationAsset: NEAR.usdc,
        amount: h.amount,
        recipient: owner,
        recipientType: "DESTINATION_CHAIN",
        refundTo: owner,
        refundType: "INTENTS",
        deadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    const q = (d as { quote?: { depositAddress?: string; amountOutUsd?: string } }).quote;
    if (!r?.ok || !q?.depositAddress) {
      const m = (d as { message?: unknown }).message;
      skipped.push({ token: h.token, amount: h.amount, reason: typeof m === "string" ? m.slice(0, 160) : "no quote" });
      continue;
    }
    transfers.push({ token: h.token, amount: h.amount, to: q.depositAddress, outUsd: Number(q.amountOutUsd) || 0 });
  }
  return Response.json({ transfers, skipped });
}

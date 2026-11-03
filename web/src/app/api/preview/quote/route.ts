import { ASSETS } from "@/lib/assets";
import { SOURCES } from "@/lib/near/sources";
import { ONECLICK } from "@/lib/oneclick";

const PREVIEW_VAULT = "kite.preview.near";
const KNOWN = new Set([...ASSETS.map((a) => a.intentsId).filter(Boolean), ...Object.values(SOURCES).map((s) => s.asset)]);

/**
 * POST { from, to, amount (base units of `from`), origin?: boolean }
 * → a real NEAR Intents 1Click quote with `dry: true`: real solver prices and fees,
 * but no deposit address is issued and nothing can be sent. Powers the console's preview mode.
 */
export async function POST(req: Request) {
  const { from, to, amount, origin } = (await req.json()) as { from: string; to: string; amount: string; origin?: boolean };
  if (!KNOWN.has(from) || !KNOWN.has(to) || from === to || !/^\d+$/.test(amount ?? "") || amount === "0") {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const r = await fetch(`${ONECLICK}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: from,
      depositType: origin ? "ORIGIN_CHAIN" : "INTENTS",
      destinationAsset: to,
      amount,
      refundTo: PREVIEW_VAULT,
      refundType: "INTENTS",
      recipient: PREVIEW_VAULT,
      recipientType: "INTENTS",
      deadline: new Date(Date.now() + 3600_000).toISOString(),
    }),
  }).catch(() => null);
  const d = r ? await r.json().catch(() => null) : null;
  if (!r?.ok || !d?.quote?.amountOut) return Response.json({ error: d?.message ?? "NEAR Intents returned no quote. Try a larger amount." }, { status: 502 });
  const q = d.quote;
  return Response.json({
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    amountInUsd: Number(q.amountInUsd),
    amountOutUsd: Number(q.amountOutUsd),
    amountInFormatted: q.amountInFormatted,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOut: q.minAmountOut,
    timeEstimate: q.timeEstimate,
    correlationId: d.correlationId,
    at: d.timestamp,
  });
}

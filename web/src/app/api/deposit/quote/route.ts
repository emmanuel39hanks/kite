import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/oneclick";
import { SOURCES } from "@/lib/near/sources";

/**
 * POST { source, amount (in source base units), vault, owner }
 * → a real 1Click deposit address. Whatever arrives is swapped to USDC and
 * credited to the vault inside NEAR Intents; refunds go to the owner's Intents account.
 */
export async function POST(req: Request) {
  const { source, amount, vault, owner } = (await req.json()) as { source: string; amount: string; vault: string; owner: string };
  const src = SOURCES[source];
  if (!src || !/^\d+$/.test(amount) || !vault?.startsWith("kite.") || !owner) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const body = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: src.asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR.usdc,
    amount,
    refundTo: owner,
    refundType: "INTENTS",
    recipient: vault,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 2 * 3600_000).toISOString(),
  };
  const r = await fetch(`${ONECLICK}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok || !d.quote?.depositAddress) return Response.json({ error: d.message ?? "No quote" }, { status: 502 });
  return Response.json(d.quote);
}

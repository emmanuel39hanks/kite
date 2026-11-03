import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/oneclick";

/**
 * POST { vault, usdc (base units), plan: [{ token, target_bps }] }
 * → one 1Click quote per plan asset: USDC inside Intents → that asset, paid back to the vault.
 * The console then asks the owner to sign `vault.allocate` with these deposit addresses.
 */
export async function POST(req: Request) {
  const { vault, usdc, plan } = (await req.json()) as { vault: string; usdc: string; plan: { token: string; target_bps: number }[] };
  if (!vault?.startsWith("kite.") || !/^\d+$/.test(usdc) || !Array.isArray(plan)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const total = BigInt(usdc);
  const slices = plan.filter((t) => t.token !== NEAR.usdc && assetByIntentsId(t.token));
  const transfers = [];
  for (const t of slices) {
    const amount = (total * BigInt(t.target_bps)) / 10_000n;
    if (amount < 1_000_000n) continue; // under $1: not worth a swap
    const r = await fetch(`${ONECLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
      body: JSON.stringify({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: NEAR.usdc,
        depositType: "INTENTS",
        destinationAsset: t.token,
        amount: amount.toString(),
        refundTo: vault,
        refundType: "INTENTS",
        recipient: vault,
        recipientType: "INTENTS",
        deadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.quote?.depositAddress) return Response.json({ error: `${assetByIntentsId(t.token)?.name}: ${d.message ?? "no quote"}` }, { status: 502 });
    transfers.push({ token: NEAR.usdc, amount: amount.toString(), to: d.quote.depositAddress, buy: t.token, amountOutUsd: d.quote.amountOutUsd });
  }
  return Response.json({ transfers });
}

import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/server/oneclick";
import { clientIp, isKiteVault, limited } from "@/lib/server/guards";

/**
 * POST { vault, usdc (base units), plan: [{ token, target_bps }] }
 * → one 1Click quote per plan asset: USDC inside Intents → that asset, paid back to the vault.
 * The console then asks the owner to sign `vault.allocate` with these deposit addresses.
 */
export async function POST(req: Request) {
  if (limited(`alloc:${clientIp(req)}`, 10, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  let body: { vault?: unknown; usdc?: unknown; plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { vault, usdc, plan } = body as { vault: string; usdc: string; plan: { token: string; target_bps: number }[] };
  const sane =
    isKiteVault(vault) &&
    typeof usdc === "string" && /^\d{1,13}$/.test(usdc) && // at most 10 million USDC
    Array.isArray(plan) && plan.length >= 1 && plan.length <= 12 &&
    plan.every((t) => typeof t?.token === "string" && Number.isInteger(t.target_bps) && t.target_bps >= 0 && t.target_bps <= 10_000) &&
    new Set(plan.map((t) => t.token)).size === plan.length &&
    plan.reduce((n, t) => n + t.target_bps, 0) <= 10_000;
  if (!sane) return Response.json({ error: "Bad request" }, { status: 400 });
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
    const d = await r.json().catch(() => ({}) as { message?: string; quote?: { depositAddress?: string; amountOutUsd?: string } });
    if (!r.ok || !d.quote?.depositAddress) return Response.json({ error: `${assetByIntentsId(t.token)?.name}: ${typeof d.message === "string" ? d.message.slice(0, 200) : "no quote"}` }, { status: 502 });
    transfers.push({ token: NEAR.usdc, amount: amount.toString(), to: d.quote.depositAddress, buy: t.token, amountOutUsd: d.quote.amountOutUsd });
  }
  return Response.json({ transfers });
}

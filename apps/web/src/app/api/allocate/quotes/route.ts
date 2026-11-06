import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/server/oneclick";
import { clientIp, crossSite, refuseCrossSite, isKiteVault, limited } from "@/lib/server/guards";

/**
 * POST { vault, usdc (base units), plan: [{ token, target_bps }], hours? }
 * → one 1Click quote per plan asset: USDC inside Intents → that asset, paid back to the vault.
 * The console then asks the owner to sign `vault.allocate` with these deposit addresses.
 * `hours` (1 to 72, default 1) is how long the quotes stay good: a DAO votes before the swaps run, so it
 * asks for longer. If they lapse, or the price moves past the limit, 1Click refunds the USDC to the vault.
 */
const MIN_SWAP = 250_000n; // $0.25: smaller slices aren't worth a swap; they stay in the vault as USDC
export async function POST(req: Request) {
  if (crossSite(req)) return refuseCrossSite();
  if (limited(`alloc:${clientIp(req)}`, 10, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  let body: { vault?: unknown; usdc?: unknown; plan?: unknown; hours?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "Bad request" }, { status: 400 });
  const { vault, usdc, plan, hours = 1 } = body as { vault: string; usdc: string; plan: { token: string; target_bps: number }[]; hours?: number };
  const sane =
    isKiteVault(vault) &&
    typeof usdc === "string" && /^\d{1,13}$/.test(usdc) && // at most 10 million USDC
    Array.isArray(plan) && plan.length >= 1 && plan.length <= 12 &&
    plan.every((t) => typeof t?.token === "string" && Number.isInteger(t.target_bps) && t.target_bps >= 0 && t.target_bps <= 10_000) &&
    new Set(plan.map((t) => t.token)).size === plan.length &&
    plan.reduce((n, t) => n + t.target_bps, 0) <= 10_000 &&
    Number.isInteger(hours) && hours >= 1 && hours <= 72;
  if (!sane) return Response.json({ error: "Bad request" }, { status: 400 });
  const total = BigInt(usdc);
  const slices = plan.filter((t) => t.token !== NEAR.usdc && assetByIntentsId(t.token));
  const transfers = [];
  for (const t of slices) {
    const amount = (total * BigInt(t.target_bps)) / 10_000n;
    if (amount < MIN_SWAP) continue;
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
        deadline: new Date(Date.now() + hours * 3600_000).toISOString(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const d = await r.json().catch(() => ({}) as { message?: string; quote?: { depositAddress?: string; amountOutUsd?: string } });
    if (!r.ok || !d.quote?.depositAddress) return Response.json({ error: `${assetByIntentsId(t.token)?.name}: ${typeof d.message === "string" ? d.message.slice(0, 200) : "no quote"}` }, { status: 502 });
    transfers.push({ token: NEAR.usdc, amount: amount.toString(), to: d.quote.depositAddress, buy: t.token, amountOutUsd: d.quote.amountOutUsd });
  }
  return Response.json({ transfers });
}

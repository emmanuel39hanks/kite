import { NEAR } from "@/lib/near/config";
import { ONECLICK } from "@/lib/server/oneclick";
import { SOURCES } from "@/lib/near/sources";
import { clientIp, crossSite, refuseCrossSite, isKiteVault, isNearAccount, limited } from "@/lib/server/guards";
import { isFactoryVault } from "@/lib/near/factory-names";
import { nearProvider } from "@/lib/near/rpc";

const provider = nearProvider();

/** Refunds go to `owner`, so only quote for the owner's own vault: `kite.<owner>`, or a factory vault it owns on chain. */
async function ownsVault(owner: string, vault: string): Promise<boolean> {
  if (vault === `kite.${owner}`) return true;
  if (!isFactoryVault(vault)) return false;
  const status = (await provider.callFunction({ contractId: vault, method: "get_status", args: {} }).catch(() => null)) as { owner?: string } | null;
  return status?.owner === owner;
}

/**
 * POST { source, amount (in source base units), vault, owner }
 * → a real 1Click deposit address. Whatever arrives is swapped to USDC and
 * credited to the vault inside NEAR Intents; refunds go to the owner's Intents account.
 */
export async function POST(req: Request) {
  if (crossSite(req)) return refuseCrossSite();
  if (limited(`dep:${clientIp(req)}`, 15, 10 * 60_000)) return Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!b || typeof b !== "object") return Response.json({ error: "Bad request" }, { status: 400 });
  const { source, amount, vault, owner } = b as { source: string; amount: string; vault: string; owner: string };
  const src = typeof source === "string" && Object.hasOwn(SOURCES, source) ? SOURCES[source] : undefined;
  if (!src || typeof amount !== "string" || !/^\d{1,30}$/.test(amount) || !isKiteVault(vault) || !isNearAccount(owner)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await ownsVault(owner, vault))) return Response.json({ error: "That vault isn't yours" }, { status: 400 });
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
  const d = await r.json().catch(() => ({}) as { message?: string; quote?: { depositAddress?: string } });
  if (!r.ok || !d.quote?.depositAddress) return Response.json({ error: typeof d.message === "string" ? d.message.slice(0, 200) : "No quote" }, { status: 502 });
  return Response.json(d.quote);
}

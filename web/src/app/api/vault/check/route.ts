import { runOnce } from "kite-worker";
import { clientIp, crossSite, refuseCrossSite, isKiteVault, limited } from "@/lib/server/guards";

/**
 * POST { vault } → what Kite would do for this vault right now: real balances and a real quote, nothing sent.
 * Always a dry run. This route is public, and a real run spends the agent key's gas allowance, so real
 * rebalances come only from the daily cron (which needs CRON_SECRET) or the worker CLI.
 */
export async function POST(req: Request) {
  if (crossSite(req)) return refuseCrossSite();
  if (limited(`check:${clientIp(req)}`, 20, 10 * 60_000)) return Response.json({ error: "Too many checks. Try again in a few minutes." }, { status: 429 });
  let vault: unknown;
  try {
    ({ vault } = (await req.json()) as { vault?: unknown });
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isKiteVault(vault)) return Response.json({ error: "Bad vault id" }, { status: 400 });
  const lines: string[] = [];
  try {
    const result = await runOnce({ vault, dry: true, log: (l) => lines.push(l) });
    return Response.json({ action: result.action, dry: true, lines });
  } catch (e) {
    console.error("vault check failed", vault, e);
    return Response.json({ error: "The check couldn't finish. Try again in a moment.", dry: true, lines }, { status: 502 });
  }
}

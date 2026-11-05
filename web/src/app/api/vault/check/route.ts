import { runOnce } from "kite-worker";
import { allowedVaults, clientIp, isKiteVault, limited } from "@/lib/server-guards";

/**
 * POST { vault } → one check of the vault, with the same code as the daily cron.
 * It sends real transactions only for vaults listed in KITE_VAULTS and only when the
 * server holds KITE_AGENT_KEY. For any other vault it is a dry run: real balances and
 * a real quote, nothing sent. The vault's own rules bound what a real run can do.
 */
export async function POST(req: Request) {
  if (limited(`check:${clientIp(req)}`, 20, 10 * 60_000)) return Response.json({ error: "Too many checks. Try again in a few minutes." }, { status: 429 });
  let vault: unknown;
  try {
    ({ vault } = (await req.json()) as { vault?: unknown });
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!isKiteVault(vault)) return Response.json({ error: "Bad vault id" }, { status: 400 });
  const lines: string[] = [];
  const dry = !process.env.KITE_AGENT_KEY || !allowedVaults().includes(vault);
  try {
    const result = await runOnce({ vault, dry, log: (l) => lines.push(l) });
    return Response.json({ action: result.action, dry, lines });
  } catch (e) {
    console.error("vault check failed", vault, e);
    return Response.json({ error: "The check couldn't finish. Try again in a moment.", dry, lines }, { status: 502 });
  }
}

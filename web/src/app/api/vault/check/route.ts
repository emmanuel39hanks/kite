import { runOnce } from "kite-worker";

/**
 * POST { vault } → run one check of the vault now, with the same code as the daily cron.
 * Without KITE_AGENT_KEY on the server it runs dry: real balances, real quote, nothing sent.
 */
export async function POST(req: Request) {
  const { vault } = (await req.json()) as { vault?: string };
  if (!vault || !/^kite\.[a-z0-9._-]+\.near$/.test(vault)) return Response.json({ error: "Bad vault id" }, { status: 400 });
  const lines: string[] = [];
  const dry = !process.env.KITE_AGENT_KEY;
  try {
    const result = await runOnce({ vault, dry, log: (l) => lines.push(l) });
    return Response.json({ action: result.action, dry, lines });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e), dry, lines }, { status: 502 });
  }
}

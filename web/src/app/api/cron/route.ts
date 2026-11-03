import { connection } from "next/server";
import { runOnce } from "kite-worker";

/**
 * Daily check for every vault in KITE_VAULTS (comma-separated).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  await connection(); // always run at request time, never at build
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const vaults = (process.env.KITE_VAULTS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const dry = !process.env.KITE_AGENT_KEY;
  const results = [];
  for (const vault of vaults) {
    const lines: string[] = [];
    try {
      const r = await runOnce({ vault, dry, log: (l) => lines.push(l) });
      results.push({ vault, action: r.action, lines });
    } catch (e) {
      results.push({ vault, error: e instanceof Error ? e.message : String(e), lines });
    }
  }
  return Response.json({ dry, results });
}

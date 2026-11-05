import { connection } from "next/server";
import { runOnce } from "kite-worker";
import { allowedVaults, safeEqual } from "@/lib/server-guards";

/**
 * Daily check for every vault in KITE_VAULTS (comma-separated).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 * Fails closed: without CRON_SECRET configured, nobody can call it.
 */
export async function GET(req: Request) {
  await connection(); // always run at request time, never at build
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const vaults = allowedVaults();
  const dry = !process.env.KITE_AGENT_KEY;
  const results = [];
  for (const vault of vaults) {
    const lines: string[] = [];
    try {
      const r = await runOnce({ vault, dry, log: (l) => lines.push(l) });
      results.push({ vault, action: r.action, lines });
    } catch (e) {
      console.error("cron check failed", vault, e);
      results.push({ vault, error: "check failed", lines });
    }
  }
  return Response.json({ dry, results });
}

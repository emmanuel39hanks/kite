import { connection } from "next/server";
import { runOnce } from "@kite/keeper";
import { allowedVaults, safeEqual } from "@/lib/server/guards";

// A run trades, waits for the swap to land (up to two minutes), and settles it.
export const maxDuration = 300;
/** Stop starting new vaults once this much of the budget is used. */
const BUDGET_MS = 150_000;

/**
 * Daily check for every vault in KITE_VAULTS (comma-separated).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 * Fails closed: without CRON_SECRET configured, nobody can call it.
 * Answers 500 if any vault failed, so the failure shows up in Vercel instead of looking like a success.
 */
export async function GET(req: Request) {
  await connection(); // always run at request time, never at build
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const vaults = allowedVaults();
  // Without the agent key a run is a dry run. Say so loudly instead of looking like a working cron.
  const dry = !process.env.KITE_AGENT_KEY;
  if (dry) console.warn(JSON.stringify({ cron: "dry-run", reason: "KITE_AGENT_KEY is not set; nothing will be traded" }));
  const started = Date.now();
  const results = [];
  for (const vault of vaults) {
    if (Date.now() - started > BUDGET_MS) {
      results.push({ vault, skipped: "out of time; next run" });
      continue;
    }
    const lines: string[] = [];
    try {
      const r = await runOnce({ vault, dry, log: (l) => lines.push(l) });
      results.push({ vault, action: r.action, lines });
      console.log(JSON.stringify({ cron: "vault", vault, action: r.action, dry }));
    } catch (e) {
      // Log the message only, with any URL removed: an RPC address can carry a key.
      const message = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
      console.error(JSON.stringify({ cron: "vault-failed", vault, message }));
      results.push({ vault, error: "check failed", lines });
    }
  }
  const failed = results.some((r) => "error" in r);
  return Response.json({ dry, results }, { status: failed ? 500 : 200 });
}

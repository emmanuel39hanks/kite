import { connection } from "next/server";
import { runOnce } from "@kite/keeper";
import { view } from "@/lib/server/chain-view";
import { NEAR } from "@/lib/near/config";
import { allowedVaults, safeEqual } from "@/lib/server/guards";

// A run trades, waits for the swap to land, and settles it.
export const maxDuration = 300;
/** Stop starting new vaults once this much of the budget is used (listing included). */
const BUDGET_MS = 150_000;
/** The longest one vault may wait for its swap. Past this, the next run settles it. */
const SETTLE_WAIT_MS = 120_000;
/** Leave this much of maxDuration unused, so a slow last vault can't get the function killed mid-log. */
const SAFETY_MS = 20_000;
/** Time a vault needs outside its swap wait: a 1Click quote, the rebalance, status polls, and settle. */
const VAULT_OVERHEAD_MS = 70_000;

/**
 * Hourly check for every vault in KITE_VAULTS (comma-separated), then vaults Kite's factory made that carry
 * Kite's key. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET nobody can.
 *
 * Anyone can make a factory vault with Kite's public key, so those come second and in a different order each
 * day: a crowd of them can't keep the allowlisted vaults, or any one vault, from being checked. Each vault pays
 * its own gas through its key. Answers 500 only if an allowlisted vault failed; other failures are logged.
 */
export async function GET(req: Request) {
  await connection(); // always run at request time, never at build
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const started = Date.now();
  const listed = allowedVaults();
  const fromFactory = shuffle((await factoryVaults()).filter((v) => !listed.includes(v)), Math.floor(started / 86_400_000));
  // Without the agent key a run is a dry run. Say so loudly instead of looking like a working cron.
  const dry = !process.env.KITE_AGENT_KEY;
  if (dry) console.warn(JSON.stringify({ cron: "dry-run", reason: "KITE_AGENT_KEY is not set; nothing will be traded" }));
  const results: { vault: string; listed: boolean; action?: string; error?: string; skipped?: string; lines?: string[] }[] = [];
  for (const vault of [...listed, ...fromFactory]) {
    const isListed = listed.includes(vault);
    const elapsed = Date.now() - started;
    if (elapsed > BUDGET_MS) {
      results.push({ vault, listed: isListed, skipped: "out of time; next run" });
      continue;
    }
    const lines: string[] = [];
    try {
      // At most 150 s in, 300 - 20 - 150 - 70 = 60 s of waiting is left, so the run ends inside maxDuration.
      const settleWaitMs = Math.max(0, Math.min(SETTLE_WAIT_MS, maxDuration * 1000 - SAFETY_MS - elapsed - VAULT_OVERHEAD_MS));
      const r = await runOnce({ vault, dry, settleWaitMs, log: (l) => lines.push(l) });
      results.push({ vault, listed: isListed, action: r.action, lines });
      // The transaction hash and the vault's settle answer go in the log, so a run can be checked against the chain.
      console.log(JSON.stringify({ cron: "vault", vault, action: r.action, dry, tx: "tx" in r ? r.tx : undefined, settle: "settle" in r ? r.settle : undefined }));
    } catch (e) {
      // Log the message only, with any URL removed: an RPC address can carry a key.
      const message = (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
      console.error(JSON.stringify({ cron: "vault-failed", vault, listed: isListed, message }));
      results.push({ vault, listed: isListed, error: "check failed", lines });
    }
  }
  const failed = results.some((r) => r.error && r.listed);
  return Response.json({ dry, results }, { status: failed ? 500 : 200 });
}

/** The list in a different order each day (a shuffle seeded by the day), so every vault gets a fair turn. */
function shuffle<T>(xs: T[], day: number): T[] {
  const out = [...xs];
  let seed = (day * 2654435761) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Vaults from Kite's factory whose agent is Kite's key, read in at most 15 seconds. Empty if the factory can't be read. */
async function factoryVaults(): Promise<string[]> {
  const kite = NEAR.agentPublicKey;
  if (!kite) return [];
  const deadline = Date.now() + 15_000;
  const list: string[] = [];
  try {
    for (let from = 0; from < 2_000 && Date.now() < deadline; from += 100) {
      const page = await view<{ vault: string }[]>(NEAR.factory, "get_vaults", { from_index: from, limit: 100 });
      list.push(...page.map((v) => v.vault));
      if (page.length < 100) break;
    }
  } catch (e) {
    console.warn(JSON.stringify({ cron: "factory-list-failed", message: e instanceof Error ? e.message : String(e) }));
    return [];
  }
  // Ten status reads at a time, so a public RPC doesn't rate-limit us into skipping vaults silently.
  const ours: string[] = [];
  let unreadable = 0;
  for (let i = 0; i < list.length && Date.now() < deadline; i += 10) {
    const batch = await Promise.all(list.slice(i, i + 10).map((v) => view<{ agent: string | null }>(v, "get_status", {}).then((s) => (s.agent === kite ? v : null)).catch(() => (unreadable++, null))));
    ours.push(...batch.filter((v): v is string => !!v));
  }
  if (unreadable) console.warn(JSON.stringify({ cron: "factory-status-unreadable", count: unreadable }));
  return ours;
}

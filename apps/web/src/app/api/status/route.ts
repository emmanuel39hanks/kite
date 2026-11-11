import { NEAR } from "@/lib/near/config";
import { ChainError, view } from "@/lib/server/chain-view";

/**
 * GET → what Kite's keeper has done lately, read from the chain at request time. Nothing here is Kite's own record:
 * every field comes from the factory's vault list and each vault's `get_status`, so anyone can re-read it over RPC.
 *
 * For each open vault that carries Kite's key: when it last traded, how many trades it made today, whether a swap
 * is in flight, and whether it is paused. The keeper runs every hour from a cron (apps/web/vercel.json, "0 * * * *").
 */
export async function GET() {
  const kite = NEAR.agentPublicKey;
  try {
    const listed = await view<{ vault: string; creator: string }[]>(NEAR.factory, "get_vaults", { from_index: 0, limit: 100 });
    const rows = await Promise.all(
      listed.map(async ({ vault }) => {
        try {
          const s = await view<{ owner: string; agent: string | null; paused: boolean; pending: unknown; trades_today: number; last_trade_ns: number }>(vault, "get_status", {});
          return {
            vault,
            open: true,
            owner: s.owner,
            kite_key: !!kite && s.agent === kite,
            paused: s.paused,
            swap_in_flight: s.pending !== null,
            trades_today: s.trades_today,
            last_trade: s.last_trade_ns ? new Date(s.last_trade_ns / 1e6).toISOString() : null,
          };
        } catch (e) {
          // The chain says the account is gone: the vault was closed. Anything else is "couldn't read".
          return e instanceof ChainError ? { vault, open: false } : { vault, open: null, error: "could not read" };
        }
      }),
    );
    return Response.json(
      {
        source: "NEAR mainnet, read at request time",
        factory: NEAR.factory,
        keeper_schedule: "hourly, on the hour (UTC)",
        read_at: new Date().toISOString(),
        vaults_ever_made: listed.length,
        vaults: rows,
      },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=300" } },
    );
  } catch {
    return Response.json({ error: "Could not reach NEAR. Try again in a moment." }, { status: 502 });
  }
}

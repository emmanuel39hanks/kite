import { assetByIntentsId } from "@/lib/assets";
import { deepJson } from "@/lib/server/deep-json";
import { clientIp, isKiteVault, limited } from "@/lib/server/guards";

const NEARBLOCKS = "https://api.nearblocks.io/v1";

export type ChainEvent = {
  hash: string;
  at: number;
  method: "rebalance" | "settle";
  ok: boolean;
  /** Only for rebalance: what Kite swapped, read from the signed quote in the call's arguments. */
  swap?: { sell: string; buy: string; sellUnits: number; buyUnits: number };
};

type Tx = {
  transaction_hash: string;
  predecessor_account_id?: string;
  block_timestamp: string;
  receiver_account_id: string;
  outcomes?: { status?: boolean };
  actions?: { action: string; method?: string; args?: string }[];
};

const num = (base: string, decimals: number) => Number(base) / 10 ** decimals;

/** GET ?vault=… → Kite's own rebalance and settle calls on this vault, from NearBlocks. Works for calls the keeper made, not just ones from this browser. */
export async function GET(req: Request) {
  const vault = new URL(req.url).searchParams.get("vault") ?? "";
  if (!isKiteVault(vault)) return Response.json({ error: "bad vault" }, { status: 400 });
  if (limited(`hist:${clientIp(req)}`, 60, 10 * 60_000)) return Response.json({ error: "Too many requests" }, { status: 429 });
  try {
    const r = await fetch(`${NEARBLOCKS}/account/${vault}/txns?per_page=100&order=desc`, { next: { revalidate: 20 } });
    if (!r.ok) return Response.json({ error: "NearBlocks unavailable" }, { status: 502 });
    const { txns = [] } = (await r.json()) as { txns?: Tx[] };
    // A rebalance is a call plus a callback receipt that runs the real policy check. If the callback
    // panics, the first receipt still says success, so a tx is only good if none of its receipts failed.
    const failed = new Set(txns.filter((t) => t.outcomes?.status === false).map((t) => t.transaction_hash));
    const seen = new Set<string>();
    const out: ChainEvent[] = [];
    for (const t of txns) {
      // Kite's key signs as the vault itself, so a call from anyone else is a stranger poking the vault, not Kite.
      if (t.receiver_account_id !== vault || t.predecessor_account_id !== vault || seen.has(t.transaction_hash)) continue;
      const a = t.actions?.find((x) => x.action === "FUNCTION_CALL" && (x.method === "rebalance" || x.method === "settle"));
      if (!a) continue;
      const ev: ChainEvent = { hash: t.transaction_hash, at: Math.floor(Number(t.block_timestamp) / 1e6), method: a.method as "rebalance" | "settle", ok: !failed.has(t.transaction_hash) };
      if (ev.method === "rebalance" && a.args) {
        try {
          const q = deepJson((deepJson(a.args) as { quote?: unknown } | null)?.quote) as { originAsset: string; destinationAsset: string; amountIn: string; amountOut: string };
          const s = assetByIntentsId(q.originAsset);
          const b = assetByIntentsId(q.destinationAsset);
          if (s && b) ev.swap = { sell: s.id, buy: b.id, sellUnits: num(q.amountIn, s.decimals), buyUnits: num(q.amountOut, b.decimals) };
        } catch {}
      }
      seen.add(t.transaction_hash);
      out.push(ev);
    }
    return Response.json({ events: out }, { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=600" } });
  } catch {
    return Response.json({ error: "NearBlocks unavailable" }, { status: 502 });
  }
}

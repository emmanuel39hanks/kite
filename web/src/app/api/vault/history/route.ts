import { assetByIntentsId } from "@/lib/assets";
import { isKiteVault } from "@/lib/server/guards";

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
  block_timestamp: string;
  receiver_account_id: string;
  outcomes?: { status?: boolean };
  actions?: { action: string; method?: string; args?: string }[];
};

const num = (base: string, decimals: number) => Number(base) / 10 ** decimals;

/** GET ?vault=… → Kite's own rebalance and settle calls on this vault, from NearBlocks. Works for calls the worker made, not just ones from this browser. */
export async function GET(req: Request) {
  const vault = new URL(req.url).searchParams.get("vault") ?? "";
  if (!isKiteVault(vault)) return Response.json({ error: "bad vault" }, { status: 400 });
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
      if (t.receiver_account_id !== vault || seen.has(t.transaction_hash)) continue;
      const a = t.actions?.find((x) => x.action === "FUNCTION_CALL" && (x.method === "rebalance" || x.method === "settle"));
      if (!a) continue;
      const ev: ChainEvent = { hash: t.transaction_hash, at: Math.floor(Number(t.block_timestamp) / 1e6), method: a.method as "rebalance" | "settle", ok: !failed.has(t.transaction_hash) };
      if (ev.method === "rebalance" && a.args) {
        try {
          const q = JSON.parse(JSON.parse(a.args).quote) as { originAsset: string; destinationAsset: string; amountIn: string; amountOut: string };
          const s = assetByIntentsId(q.originAsset);
          const b = assetByIntentsId(q.destinationAsset);
          if (s && b) ev.swap = { sell: s.id, buy: b.id, sellUnits: num(q.amountIn, s.decimals), buyUnits: num(q.amountOut, b.decimals) };
        } catch {}
      }
      seen.add(t.transaction_hash);
      out.push(ev);
    }
    return Response.json({ events: out });
  } catch {
    return Response.json({ error: "NearBlocks unavailable" }, { status: 502 });
  }
}

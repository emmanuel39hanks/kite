import { connection } from "next/server";
import { assetByIntentsId, type LogoId } from "@/lib/assets";
import { getHistory } from "@/lib/market/market";
import { NEAR } from "@/lib/near/config";
import { deepJson } from "@/lib/server/deep-json";
import { clientIp, isKiteVault, limited } from "@/lib/server/guards";

const NEARBLOCKS = "https://api.nearblocks.io/v1";

type Tx = {
  transaction_hash: string;
  predecessor_account_id?: string;
  receiver_account_id: string;
  block_timestamp: string;
  outcomes?: { status?: boolean };
  actions?: { action: string; method?: string; args?: string }[];
};

export type VaultSummary = {
  vault: string;
  owner: string | null;
  createdAt: number | null;
  closedAt: number | null;
  plan: { id: LogoId; weight: number }[];
  /** USDC the owner invested (allocate calls). */
  investedUsd: number;
  trades: { at: number; hash: string; sell: LogoId; buy: LogoId; inUsd: number; outUsd: number }[];
  withdrawals: { at: number; hash: string; id: LogoId; units: number; usd: number }[];
  withdrawnUsd: number;
  /** Withdrawn less invested, in dollars, once something came back. */
  resultUsd: number | null;
};

const parse = (s?: string) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/**
 * GET ?vault=… → a vault's whole life rebuilt from its public transactions: when it was made and with what plan,
 * the USDC put to work, every trade Kite made (at the signed quote's USD figures), what came out and when it closed.
 * Works after a vault is closed: its account is gone but its transactions aren't.
 */
export async function GET(req: Request) {
  await connection();
  const vault = new URL(req.url).searchParams.get("vault") ?? "";
  if (!isKiteVault(vault)) return Response.json({ error: "bad vault" }, { status: 400 });
  if (limited(`sum:${clientIp(req)}`, 40, 10 * 60_000)) return Response.json({ error: "Too many requests" }, { status: 429 });

  const r = await fetch(`${NEARBLOCKS}/account/${vault}/txns?per_page=100&order=asc`, { next: { revalidate: 60 } }).catch(() => null);
  if (!r?.ok) return Response.json({ error: "NearBlocks unavailable" }, { status: 502 });
  const { txns = [] } = (await r.json()) as { txns?: Tx[] };
  const failed = new Set(txns.filter((t) => t.outcomes?.status === false).map((t) => t.transaction_hash));
  const at = (t: Tx) => Math.floor(Number(t.block_timestamp) / 1e6);

  const s: VaultSummary = { vault, owner: null, createdAt: null, closedAt: null, plan: [], investedUsd: 0, trades: [], withdrawals: [], withdrawnUsd: 0, resultUsd: null };
  const seen = new Set<string>();
  for (const t of txns) {
    if (t.receiver_account_id !== vault || failed.has(t.transaction_hash)) continue;
    for (const [i, a] of (t.actions ?? []).entries()) {
      if (a.action !== "FUNCTION_CALL" || !a.method) continue;
      const key = `${t.transaction_hash}:${a.method}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const args = parse(a.args);
      if (a.method === "new" && args) {
        s.createdAt = at(t);
        s.owner = typeof args.owner === "string" ? args.owner : null;
        s.plan = (args.plan ?? []).flatMap((p: { token: string; target_bps: number }) => {
          const x = assetByIntentsId(p.token);
          return x ? [{ id: x.id, weight: p.target_bps / 100 }] : [];
        });
      } else if (a.method === "allocate" && args && t.predecessor_account_id !== vault) {
        for (const tr of args.transfers ?? []) if (tr.token === NEAR.usdc) s.investedUsd += Number(tr.amount) / 1e6;
      } else if (a.method === "rebalance" && t.predecessor_account_id === vault && args?.quote) {
        const q = deepJson(args.quote) as { originAsset?: string; destinationAsset?: string; amountInUsd?: string; amountOutUsd?: string } | null;
        const sell = q?.originAsset ? assetByIntentsId(q.originAsset) : undefined;
        const buy = q?.destinationAsset ? assetByIntentsId(q.destinationAsset) : undefined;
        if (sell && buy) s.trades.push({ at: at(t), hash: t.transaction_hash, sell: sell.id, buy: buy.id, inUsd: Number(q!.amountInUsd) || 0, outUsd: Number(q!.amountOutUsd) || 0 });
      } else if (a.method === "withdraw" && args && t.predecessor_account_id !== vault) {
        const x = assetByIntentsId(args.token);
        if (x) s.withdrawals.push({ at: at(t), hash: t.transaction_hash, id: x.id, units: Number(args.amount) / 10 ** x.decimals, usd: 0 });
      } else if (a.method === "close_vault" && t.predecessor_account_id !== vault) {
        s.closedAt = at(t);
      }
    }
  }

  // Price each withdrawal at that day's close (dollars at $1). An estimate for the day, not the minute.
  if (s.withdrawals.length) {
    const h = await getHistory(365).catch(() => null);
    for (const w of s.withdrawals) {
      if (w.id === "usdc" || w.id === "usdt") {
        w.usd = w.units;
        continue;
      }
      const series = h?.prices[w.id];
      if (!h || !series?.length) continue;
      let i = h.dates.findIndex((d) => d > w.at) - 1;
      if (i < 0) i = h.dates[0] > w.at ? 0 : series.length - 1;
      w.usd = w.units * series[i];
    }
    s.withdrawnUsd = s.withdrawals.reduce((n, w) => n + w.usd, 0);
    if (s.investedUsd > 0) s.resultUsd = s.withdrawnUsd - s.investedUsd;
  }
  return Response.json(s, { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=600" } });
}

import { isKiteVault } from "@/lib/server-guards";

const RPC = "https://rpc.mainnet.near.org";
const ARCHIVAL = "https://archival-rpc.mainnet.near.org";

export type WhyFacts = { sell: string; buy: string; amountIn: string; minOut: string; driftBps: number };

/** GET ?vault=…&hash=… → what the vault logged when it started this rebalance (rebalance_started). Read from the chain, not from anyone's say-so. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const vault = q.get("vault") ?? "";
  const hash = q.get("hash") ?? "";
  if (!isKiteVault(vault) || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) return Response.json({ error: "bad request" }, { status: 400 });
  const ask = async (url: string) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: vault, wait_until: "EXECUTED" } }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return (await r.json()) as { result?: { receipts_outcome?: { outcome: { logs: string[]; executor_id?: string } }[] }; error?: unknown };
  };
  try {
    let d = await ask(RPC);
    // The regular node only keeps a few days; older trades live on the archival node.
    if (!d.result && d.error) d = await ask(ARCHIVAL);
    for (const ro of d.result?.receipts_outcome ?? []) {
      // Only the vault itself may speak for the vault: another contract could print a look-alike event.
      if (ro.outcome.executor_id !== vault) continue;
      for (const log of ro.outcome.logs) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        try {
          const e = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: Record<string, unknown> };
          if (e.standard === "kite" && e.event === "rebalance_started") {
            const x = e.data;
            const digits = (v: unknown) => typeof v === "string" && /^\d{1,40}$/.test(v);
            if (!digits(x.amount_in) || !digits(x.min_out) || !Number.isFinite(Number(x.drift_bps)) || typeof x.sell !== "string" || typeof x.buy !== "string") continue;
            return Response.json({ facts: { sell: String(x.sell), buy: String(x.buy), amountIn: String(x.amount_in), minOut: String(x.min_out), driftBps: Number(x.drift_bps) } satisfies WhyFacts });
          }
        } catch {}
      }
    }
    if (!d.result) return Response.json({ error: "The chain couldn't find that transaction." }, { status: 404 });
    return Response.json({ error: "This transaction has no rebalance event, so the trade may have been refused." }, { status: 404 });
  } catch {
    return Response.json({ error: "Couldn't read the transaction from the chain." }, { status: 502 });
  }
}

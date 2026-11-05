const RPC = "https://rpc.mainnet.near.org";

export type WhyFacts = { sell: string; buy: string; amountIn: string; minOut: string; driftBps: number };

/** GET ?vault=…&hash=… → what the vault logged when it started this rebalance (rebalance_started). Read from the chain, not from anyone's say-so. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const vault = q.get("vault") ?? "";
  const hash = q.get("hash") ?? "";
  if (!/^[a-z0-9._-]{2,64}$/.test(vault) || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hash, sender_account_id: vault, wait_until: "EXECUTED" } }),
      next: { revalidate: 3600 },
    });
    const d = (await r.json()) as { result?: { receipts_outcome?: { outcome: { logs: string[] } }[] } };
    for (const ro of d.result?.receipts_outcome ?? []) {
      for (const log of ro.outcome.logs) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        try {
          const e = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: Record<string, unknown> };
          if (e.standard === "kite" && e.event === "rebalance_started") {
            const x = e.data;
            return Response.json({ facts: { sell: String(x.sell), buy: String(x.buy), amountIn: String(x.amount_in), minOut: String(x.min_out), driftBps: Number(x.drift_bps) } satisfies WhyFacts });
          }
        } catch {}
      }
    }
    return Response.json({ error: "No rebalance event found in that transaction." }, { status: 404 });
  } catch {
    return Response.json({ error: "Couldn't read the transaction from the chain." }, { status: 502 });
  }
}

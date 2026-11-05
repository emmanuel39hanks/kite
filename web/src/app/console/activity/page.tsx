"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChainEvent } from "@/app/api/vault/history/route";
import { assetById, units } from "@/lib/assets";
import { ActivityList } from "@/components/console/activity-list";
import { ConnectGate } from "@/components/console/connect-gate";
import { Button, Card, Empty, PageTitle, Segmented } from "@/components/console/ui";
import { accountUrl } from "@/lib/near/config";
import { useWallet } from "@/lib/near/wallet";
import { useKite, type ActivityEvent } from "@/lib/store";

const FILTERS = ["All", "Trades", "Money in", "Blocked", "Settings"] as const;
type Filter = (typeof FILTERS)[number];
const MATCH: Record<Filter, (e: ActivityEvent) => boolean> = {
  All: () => true,
  Trades: (e) => e.kind === "trade",
  "Money in": (e) => e.kind === "deposit",
  Blocked: (e) => e.kind === "blocked",
  Settings: (e) => e.kind === "guardrails" || e.kind === "key" || e.kind === "created",
};

/** Kite's own calls on the vault, read from the chain, so trades made while this browser was closed show up too. */
function useChainEvents(vault: string | null | undefined, enabled: boolean): ActivityEvent[] {
  const [raw, setRaw] = useState<ChainEvent[]>([]);
  useEffect(() => {
    if (!vault || !enabled) return;
    let alive = true;
    const load = () =>
      fetch(`/api/vault/history?vault=${encodeURIComponent(vault)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d?.events && setRaw(d.events))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [vault, enabled]);
  return useMemo(
    () =>
      raw.map((e) => {
        const sell = e.swap && assetById(e.swap.sell as never);
        const buy = e.swap && assetById(e.swap.buy as never);
        return {
          id: `chain:${e.hash}`,
          at: e.at,
          kind: e.ok ? ("trade" as const) : ("blocked" as const),
          title: !e.ok
            ? `Kite's ${e.method} was refused`
            : e.method === "settle"
              ? "Swap settled"
              : sell && buy && e.swap
                ? `Kite rebalanced: ${units(e.swap.sellUnits)} ${sell.ticker} for about ${units(e.swap.buyUnits)} ${buy.ticker}`
                : "Kite started a rebalance",
          detail: e.ok ? "Made by Kite's rebalance-only key. Read from the chain." : "The vault's rules said no, so nothing moved.",
          tx: e.hash,
          canExplain: e.ok && e.method === "rebalance" && !!e.swap,
        };
      }),
    [raw],
  );
}

export default function ActivityPage() {
  const k = useKite();
  const w = useWallet();
  const [filter, setFilter] = useState<Filter>("All");
  const chain = useChainEvents(k.portfolio?.vault, !w.preview);
  if (!k.ready || !w.ready) return null;
  if (!w.accountId)
    return (
      <>
        <PageTitle>Activity</PageTitle>
        <ConnectGate />
      </>
    );
  const seen = new Set(k.activity.map((e) => e.tx).filter(Boolean));
  const events = [...k.activity, ...chain.filter((e) => !seen.has(e.tx))].sort((a, b) => b.at - a.at).filter(MATCH[filter]);
  return (
    <>
      <PageTitle
        actions={
          k.portfolio && !w.preview && (
            <Button href={accountUrl(k.portfolio.vault)} external icon="external">
              Full history on NearBlocks
            </Button>
          )
        }
      >
        Activity
      </PageTitle>
      <div className="mb-4 overflow-x-auto">
        <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Filter activity" />
      </div>
      <Card className="overflow-hidden">
        {events.length ? (
          <div className="bg-white">
            <ActivityList events={events} vault={k.portfolio?.vault} />
          </div>
        ) : (
          <Empty
            title={filter === "All" ? "Nothing yet" : `No ${filter.toLowerCase()} yet`}
            text="Actions you take from this browser show up here with a link to the transaction. Every vault call is also on NearBlocks."
          />
        )}
      </Card>
    </>
  );
}

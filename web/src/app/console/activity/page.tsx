"use client";

import { useState } from "react";
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

export default function ActivityPage() {
  const k = useKite();
  const w = useWallet();
  const [filter, setFilter] = useState<Filter>("All");
  if (!k.ready || !w.ready) return null;
  if (!w.accountId)
    return (
      <>
        <PageTitle>Activity</PageTitle>
        <ConnectGate />
      </>
    );
  const events = k.activity.filter(MATCH[filter]);
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
            <ActivityList events={events} />
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

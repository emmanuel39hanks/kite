"use client";

import { Badge, Card } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { Logo } from "@/components/logo";
import { assetByIntentsId } from "@/lib/assets";
import { txUrl } from "@/lib/near/config";
import { cleanIncident, INCIDENT_SCHEMA, incidentPrompt } from "@/lib/ai/incident";
import { askPrivately } from "@/lib/ai/private-ai";
import { safeHttps } from "@/lib/ai/text-guard";
import { describe, useSwapStatus } from "@/lib/near/swap-status";
import { useState } from "react";

const STEPS = ["Left your vault", "Being swapped", "Back in your vault"];

/** A rebalance in flight: where the money is now, and how it ended. Data comes from the vault and from 1Click's status API. */
export function SwapTracker({ sell, buy, depositAddress }: { sell: string; buy: string; depositAddress: string }) {
  const { status, checkedAt } = useSwapStatus(depositAddress);
  const s = describe(status?.status ?? "PENDING_DEPOSIT");
  const a = assetByIntentsId(sell);
  const b = assetByIntentsId(buy);
  const d = status?.swapDetails;
  // 1Click's reason is free text from outside. Only a plain code like PARTIALLY_FILLED is used or shown.
  const reasonCode = typeof d?.refundReason === "string" && /^[A-Z][A-Z0-9_]{2,39}$/.test(d.refundReason) ? d.refundReason : null;
  const links = [
    ...(d?.nearTxHashes ?? []).map((h) => ({ label: "Vault transfer", href: txUrl(h) })),
    ...(d?.destinationChainTxHashes ?? []).flatMap((t) => {
      const href = safeHttps(t.explorerUrl);
      return href ? [{ label: "Delivery", href }] : [];
    }),
    { label: "NEAR Intents explorer", href: `https://explorer.near-intents.org/transactions/${depositAddress}` },
  ];
  const failed = status?.status === "REFUNDED" || status?.status === "FAILED";
  const [whyRaw, setWhy] = useState<{ status: string; text: string; next: string; fromModel: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  // An explanation belongs to the status it was written for; a new status needs a new one.
  const why = whyRaw && whyRaw.status === status?.status ? whyRaw : null;
  const explainable = failed || status?.status === "INCOMPLETE_DEPOSIT";
  const explain = async () => {
    if (!status) return;
    setAsking(true);
    try {
      const { data } = await askPrivately({
        system: incidentPrompt,
        user: JSON.stringify({ status: status.status, from: a?.ticker, to: b?.ticker, refundReason: reasonCode }),
        schema: INCIDENT_SCHEMA,
        maxTokens: 500,
      });
      setWhy({ status: status.status, ...cleanIncident(data, status.status, s.where) });
    } catch {
      setWhy({ status: status.status, text: s.where, next: "", fromModel: false });
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card className="col-span-full p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {a && <Logo id={a.id} size={32} />}
          <Icon name="refresh" size={16} />
          {b && <Logo id={b.id} size={32} />}
          <div className="leading-tight">
            <div className="text-[16px] tracking-[-0.02em]">
              Rebalance in flight{a && b ? `: ${a.ticker} to ${b.ticker}` : ""}
            </div>
            <div className="text-[13px] text-[#909090]">{d?.amountInFormatted && d?.amountOutFormatted ? `${d.amountInFormatted} in, ${d.amountOutFormatted} expected out` : "Through NEAR Intents"}</div>
          </div>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>

      <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Swap progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < s.step || (n === 3 && status?.status === "SUCCESS");
          const here = n === s.step && !done;
          const bad = n === 3 && failed;
          return (
            <li key={label} className="min-w-0">
              <div className={`h-1.5 rounded-full ${bad ? (status?.status === "FAILED" ? "bg-[#d33]" : "bg-[#e8a317]") : done ? "bg-[#05a800]" : here ? "animate-pulse bg-[#8cc6f6]" : "bg-black/10"}`} />
              <div className={`mt-1.5 text-[12px] ${done || here || bad ? "text-black" : "text-[#909090]"}`}>{label}</div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[14px] leading-5">{s.where}</p>
      {reasonCode && <p className="mt-1 text-[13px] text-[#909090]">Reason given: {reasonCode.replace(/_/g, " ").toLowerCase()}</p>}
      {d?.refundedAmountFormatted && <p className="mt-1 text-[13px] text-[#909090]">Returned: {d.refundedAmountFormatted}</p>}

      {explainable && !why && (
        <button type="button" onClick={explain} disabled={asking} className="mt-3 cursor-pointer text-[13px] underline underline-offset-4 hover:text-black/70 disabled:cursor-default disabled:opacity-60">
          {asking ? "Explaining privately…" : "Explain what happened"}
        </button>
      )}
      {why && (
        <div className="mt-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[13px] leading-5">
          <p>{why.text}</p>
          {why.next && <p className="mt-1 text-black/70">{why.next}</p>}
          <p className="mt-1.5 text-[12px] text-[#909090]">
            {why.fromModel ? "Written by a private model on NEAR AI from the status above. The status line, not this text, is the source of truth." : "Standard explanation."}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        {links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-black/60 hover:text-black">
            {l.label} <Icon name="external" size={12} />
          </a>
        ))}
        <span className="text-[#909090]">{checkedAt ? `Checked ${new Date(checkedAt).toLocaleTimeString()}` : "Checking…"}</span>
        {failed && status?.correlationId && <span className="text-[#909090]">Ref {status.correlationId.slice(0, 8)}</span>}
      </div>
    </Card>
  );
}

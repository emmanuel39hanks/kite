"use client";

import { Badge, Card } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { Logo } from "@/components/logo";
import { assetByIntentsId } from "@/lib/assets";
import { txUrl } from "@/lib/near/config";
import { describe, useSwapStatus } from "@/lib/swap-status";

const STEPS = ["Left your vault", "Being swapped", "Back in your vault"];

/** A rebalance in flight: where the money is now, and how it ended. Data comes from the vault and from 1Click's status API. */
export function SwapTracker({ sell, buy, depositAddress }: { sell: string; buy: string; depositAddress: string }) {
  const { status, checkedAt } = useSwapStatus(depositAddress);
  const s = describe(status?.status ?? "PENDING_DEPOSIT");
  const a = assetByIntentsId(sell);
  const b = assetByIntentsId(buy);
  const d = status?.swapDetails;
  const links = [
    ...(d?.nearTxHashes ?? []).map((h) => ({ label: "Vault transfer", href: txUrl(h) })),
    ...(d?.destinationChainTxHashes ?? []).map((t) => ({ label: "Delivery", href: t.explorerUrl })),
    { label: "NEAR Intents explorer", href: `https://explorer.near-intents.org/transactions/${depositAddress}` },
  ];
  const failed = status?.status === "REFUNDED" || status?.status === "FAILED";

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
      {d?.refundReason && <p className="mt-1 text-[13px] text-[#909090]">Reason given: {d.refundReason}</p>}
      {d?.refundedAmountFormatted && <p className="mt-1 text-[13px] text-[#909090]">Returned: {d.refundedAmountFormatted}</p>}

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

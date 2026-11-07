"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Disclosure, StatusNote } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { assetById } from "@/lib/assets";
import { askPrivately, warmUp, type Receipt } from "@/lib/ai/private-ai";
import { cleanReview, reviewPrompt, REVIEW_SCHEMA, reviewStats, statValue, SUGGESTIONS, type ReviewStats } from "@/lib/ai/review";
import type { Portfolio } from "@/lib/store";
import { useKite } from "@/lib/store";
import { useHistory, useYields } from "@/lib/market/use-market";

type Result = { stats: ReviewStats; verdict: "ok" | "watch" | "change"; bullets: { stat: Parameters<typeof statValue>[1]; text: string }[]; suggestion: string; receipt: Receipt };

const VERDICT = {
  ok: { tone: "green", label: "Looks fine" },
  watch: { tone: "amber", label: "One thing to watch" },
  change: { tone: "red", label: "Worth changing" },
} as const;

/** The numbers come from real price history, computed here. The model, running privately on NEAR AI, only says what they mean. */
export function VaultReview({ p }: { p: Portfolio }) {
  const k = useKite();
  const h = useHistory(365);
  const yields = useYields();
  useEffect(() => warmUp(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stats: ReviewStats | null = h ? reviewStats(h, p.target, p.current, k.guardrails, yields) : null;

  const run = async () => {
    if (!stats || busy) return;
    setBusy("Starting…");
    setErr(null);
    setRes(null);
    try {
      // Only percentages and fixed ids leave the browser: no amounts, no wallet or vault name.
      const user = JSON.stringify({ ...stats, topAsset: stats.topAsset.weightPct });
      const { data, receipt } = await askPrivately({
        system: reviewPrompt,
        user,
        schema: REVIEW_SCHEMA,
        maxTokens: 1200,
        onStage: (st) => setBusy(st === "verify" ? "Checking NEAR AI's attestation…" : st === "ask" ? "Reviewing privately…" : "Checking the signature…"),
      });
      setRes({ ...cleanReview(data), receipt, stats });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!h) return null;
  if (!stats)
    return (
      <Card className="p-5">
        <div className="text-[16px] tracking-[-0.02em]">Review your plan</div>
        <p className="mt-1 text-[14px] text-[#6b6b6b]">Price history isn&apos;t available for every part of this plan yet, so there&apos;s nothing to review.</p>
      </Card>
    );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[16px] tracking-[-0.02em]">Review your plan</div>
          <p className="mt-0.5 max-w-[58ch] text-[13px] leading-5 text-[#6b6b6b]">
            Real numbers from the last {stats.days} days of prices, worked out here in your browser. A private model on NEAR AI explains what they mean. It sees percentages only, never your amounts or wallet.{p.target.some((t) => assetById(t.id).earn) && " For the earning parts, history is an estimate built from the plain asset."}
          </p>
        </div>
        {res ? (
          <Badge tone={VERDICT[res.verdict].tone}>{VERDICT[res.verdict].label}</Badge>
        ) : (
          <Button size="sm" icon="lock" onClick={run} loading={!!busy}>
            {busy ?? "Review privately"}
          </Button>
        )}
      </div>

      {err && (
        <StatusNote tone="err" className="mt-3">
          {err}
        </StatusNote>
      )}

      {res ? (
        <>
          <ul className="mt-4 divide-y divide-black/[0.06] rounded-2xl bg-white ring-1 ring-inset ring-black/[0.06] shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            {res.bullets.map((b) => (
              <li key={b.stat} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-5">
                <div className="text-[15px] tracking-[-0.02em] tabular-nums">{statValue(res.stats, b.stat)}</div>
                <p className="text-[14px] leading-5 text-black/65">{b.text}</p>
              </li>
            ))}
            <li className="flex items-center gap-2.5 px-4 py-3.5 text-[14px]">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${res.suggestion === "none" ? "bg-[#05a800]" : "bg-[#d98a00]"}`}>
                {res.suggestion === "none" ? <Icon name="check" size={11} stroke={2.4} /> : <span className="text-[11px] leading-none font-semibold">!</span>}
              </span>
              <span>
                <span className="text-[#6b6b6b]">Suggestion: </span>
                {SUGGESTIONS[res.suggestion]}
              </span>
            </li>
          </ul>
          <Disclosure
            className="mt-2"
            icon={
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#05a800]/10 text-[#05a800]">
                <Icon name="check" size={11} stroke={2.4} />
              </span>
            }
            title={res.receipt.signatureKind === "provider_tee" ? "Answered privately and signed by the model's hardware" : "Signed by NEAR AI's gateway"}
          >
            The numbers above are computed in code, and any sentence containing a number of its own is thrown away. The model can&apos;t change your plan or settings. Signature id{" "}
            <span className="font-mono text-[12px]">{res.receipt.completionId.slice(0, 12)}…</span>, checked in this browser.
          </Disclosure>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setRes(null)} className="mt-3">
            Review again
          </Button>
        </>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(
            [
              ["With rebalancing", `${stats.planReturnPct >= 0 ? "+" : ""}${stats.planReturnPct}%`, `past ${stats.days} days`],
              ["Never rebalanced", `${stats.holdReturnPct >= 0 ? "+" : ""}${stats.holdReturnPct}%`, "same start, left alone"],
              ["Worst fall", `-${stats.maxDrawdownPct}%`, "peak to bottom"],
              ["Ups and downs", `${stats.volatilityPct}%`, `a year, about ${stats.rebalancesPerYear} rebalance${stats.rebalancesPerYear === 1 ? "" : "s"}`],
            ] as const
          ).map(([label, value, note]) => (
            <div key={label} className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-inset ring-black/[0.05]">
              <dt className="text-[13px] text-[#6b6b6b]">{label}</dt>
              <dd className="mt-0.5 text-[22px] leading-7 tracking-[-0.04em] tabular-nums">{value}</dd>
              <dd className="text-[12px] text-[#6b6b6b]">{note}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

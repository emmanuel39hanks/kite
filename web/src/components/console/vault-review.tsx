"use client";

import { useState } from "react";
import { Badge, Button, Card, StatusNote } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { askPrivately, type Receipt } from "@/lib/private-ai";
import { cleanReview, reviewPrompt, REVIEW_SCHEMA, reviewStats, statValue, SUGGESTIONS, type ReviewStats } from "@/lib/review";
import type { Portfolio } from "@/lib/store";
import { useKite } from "@/lib/store";
import { useHistory, useYields } from "@/lib/use-market";

type Result = { verdict: "ok" | "watch" | "change"; bullets: { stat: Parameters<typeof statValue>[1]; text: string }[]; suggestion: string; receipt: Receipt };

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
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stats: ReviewStats | null = h ? reviewStats(h, p.target, p.current, k.guardrails, yields) : null;

  const run = async () => {
    if (!stats) return;
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
      setRes({ ...cleanReview(data), receipt });
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
        <p className="mt-1 text-[14px] text-[#909090]">Price history isn&apos;t available for every part of this plan yet, so there&apos;s nothing to review.</p>
      </Card>
    );

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[16px] tracking-[-0.02em]">Review your plan</div>
          <p className="mt-0.5 max-w-[58ch] text-[13px] leading-5 text-[#909090]">
            Real numbers from the last {stats.days} days of prices, worked out here in your browser. A private model on NEAR AI explains what they mean. It sees percentages only, never your amounts or wallet.
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
          <ul className="mt-4 space-y-3">
            {res.bullets.map((b) => (
              <li key={b.stat} className="grid gap-1 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-4">
                <div className="text-[14px] tabular-nums">{statValue(stats, b.stat)}</div>
                <p className="text-[14px] leading-5 text-black/70">{b.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px]">{SUGGESTIONS[res.suggestion]}</p>
          <details className="mt-3 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[12px] leading-5 text-black/60">
            <summary className="cursor-pointer text-[13px] text-black [&::-webkit-details-marker]:hidden">
              <Icon name="check" size={12} className="mr-1.5 inline text-[#05a800]" />
              {res.receipt.signatureKind === "provider_tee" ? "Answered privately and signed by the model's hardware" : "Signed by NEAR AI's gateway"}
            </summary>
            <p className="mt-1.5">
              The numbers above are computed in code, and any sentence containing a number of its own is thrown away. The model can&apos;t change your plan or settings. Signature id {res.receipt.completionId.slice(0, 12)}…, checked in this browser.
            </p>
          </details>
          <button type="button" onClick={() => setRes(null)} className="mt-2 cursor-pointer text-[13px] text-black/50 hover:text-black">
            Review again
          </button>
        </>
      ) : (
        <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {(["plan_return", "volatility", "max_drawdown", "rebalances"] as const).map((key) => (
            <li key={key} className="text-[14px] tabular-nums text-black/70">
              {statValue(stats, key)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

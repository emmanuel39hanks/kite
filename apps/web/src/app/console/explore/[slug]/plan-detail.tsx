"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MixBar } from "@/components/charts";
import { Icon } from "@/components/console/icons";
import { Button, Card, Change, Money, Segmented } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import { assetById, price as fmtPrice } from "@/lib/assets";
import { planBySlug } from "@/lib/plans";
import { useKite } from "@/lib/store";
import { backtest, useHistory, useMarket } from "@/lib/market/use-market";

const RANGES = ["1M", "3M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const DAYS: Record<Range, number> = { "1M": 30, "3M": 90, "1Y": 365 };
const SWINGS = ["Calmer", "Medium", "Bigger swings"];

export function PlanDetail({ slug }: { slug: string }) {
  const plan = planBySlug(slug)!;
  const router = useRouter();
  const k = useKite();
  const { quote } = useMarket();
  const [range, setRange] = useState<Range>("1Y");
  const h = useHistory(DAYS[range]);
  const series = useMemo(() => (h ? backtest(h, plan.mix) : []), [h, plan]);
  const end = series.length ? series[series.length - 1] : 1000;
  const change = series.length > 1 ? (end / series[0] - 1) * 100 : null;

  const customise = () => {
    k.setDraft({ name: `My ${plan.name}`, mix: plan.mix });
    router.push("/console/create");
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5 pt-8 pb-7 sm:pt-10">
        <div>
          <Link href="/console/explore" className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-[#6b6b6b] hover:text-black">
            <Icon name="arrow-left" size={16} /> Explore
          </Link>
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              {plan.mix.map((s) => (
                <Logo key={s.id} id={s.id} size={40} className="ring-2 ring-[#fcfcfd]" />
              ))}
            </div>
            <h1 className="text-[30px] leading-9 tracking-[-0.05em]">{plan.name}</h1>
          </div>
          <p className="mt-2 text-[16px] text-[#6b6b6b]">{plan.who}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={customise} icon="notepad">
            Change the mix
          </Button>
          {k.vaultFound ? (
            <Button variant="primary" href="/console" iconRight="arrow-right">
              You already have a vault
            </Button>
          ) : (
            <Button variant="primary" href={`/console/start/${plan.slug}`} iconRight="arrow-right">
              Start this plan
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex min-h-[340px] flex-col overflow-hidden pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6">
            <div>
              <div className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">$1,000 in this plan, rebalanced daily</div>
              <Money value={end} className="text-[48px] leading-[56px] tracking-[-0.04em]" />
              <div className="text-[14px]">
                <Change value={change} /> <span className="text-[#6b6b6b]">past {range === "1Y" ? "year" : range === "3M" ? "3 months" : "month"}</span>
              </div>
            </div>
            <Segmented options={RANGES} value={range} onChange={setRange} label="Chart range" />
          </div>
          <div className="mt-auto pt-4">
            <ValueChart data={series} dates={h?.dates.slice(-series.length)} height={190} />
          </div>
          <p className="px-6 pb-3 text-[11px] text-black/35">Real daily closing prices (Kraken). Before swap costs. Past returns don&apos;t predict future ones.</p>
        </Card>

        <Card className="p-2">
          <dl className="rounded-2xl bg-white px-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <Row label="Ups and downs" value={SWINGS[plan.swings - 1]} />
            <Row label="Checked" value="Every hour" />
            <Row label="Steps in at" value={`${k.guardrails.driftBand} pts off target`} />
            <Row label="Kite fee" value="None" />
            <Row label="Swap cost" value="About 0.3–0.7%" />
            <Row label="Withdraw" value="Any time, only you" />
          </dl>
          <p className="p-4 text-[14px] leading-5 text-[#6b6b6b]">{plan.goodFor}</p>
        </Card>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="p-5 pb-4">
          <h2 className="text-[22px] tracking-[-0.05em]">What&apos;s inside, and why</h2>
          <p className="mt-1 max-w-[62ch] text-[15px] text-[#6b6b6b]">{plan.idea}</p>
          <MixBar slices={plan.mix} className="mt-4 h-2" />
        </div>
        <ul className="divide-y divide-black/[0.05] bg-white">
          {plan.mix.map((s) => {
            const a = assetById(s.id);
            const q = quote(s.id);
            return (
              <li key={s.id} className="flex items-center gap-4 px-5 py-4">
                <Logo id={s.id} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] tracking-[-0.02em]">{a.name}</span>
                    <span className="text-[13px] text-[#6b6b6b]">{a.ticker}</span>
                  </div>
                  <p className="text-[14px] text-[#6b6b6b]">{plan.why[s.id]}</p>
                </div>
                {a.live && (
                  <div className="hidden text-right sm:block">
                    <div className="text-[14px] tabular-nums">{fmtPrice(q.price)}</div>
                    <Change value={q.change24h} className="text-[12px]" />
                  </div>
                )}
                <span className="w-14 text-right text-[20px] tracking-[-0.04em] tabular-nums">{s.weight}%</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.05] py-3.5 text-[15px] last:border-0">
      <dt className="text-[#6b6b6b]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

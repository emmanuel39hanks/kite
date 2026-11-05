"use client";

import Link from "next/link";
import { MixBar } from "@/components/charts";
import { Ticker } from "@/components/console/ticker";
import { Badge, Button, Card, Change, PageTitle, SectionTitle } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import { ASSETS, price as fmtPrice } from "@/lib/assets";
import { PLAN_DATA } from "@/lib/plans";
import { backtest, useHistory, useMarket } from "@/lib/market/use-market";

export default function ExplorePage() {
  const h = useHistory(365);
  const { quote } = useMarket();

  return (
    <>
      <PageTitle actions={<Button href="/console/create" icon="create">Create a plan</Button>}>Explore</PageTitle>
      <Ticker />

      <div className="mt-10">
        <SectionTitle>Plans</SectionTitle>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PLAN_DATA.map((p) => {
          const series = h && !p.comingSoon ? backtest(h, p.mix) : [];
          const ret = series.length > 1 ? (series[series.length - 1] / series[0] - 1) * 100 : null;
          return (
            <Link key={p.slug} href={`/console/explore/${p.slug}`} className="group rounded-[20px] outline-offset-4">
              <Card className="flex h-full flex-col overflow-hidden transition-colors group-hover:bg-[#efeff2]">
                <div className="flex items-start justify-between p-5 pb-0">
                  <div className="flex -space-x-2">
                    {p.mix.map((s) => (
                      <Logo key={s.id} id={s.id} size={32} className="ring-2 ring-[#f5f5f7]" />
                    ))}
                  </div>
                  {p.comingSoon ? (
                    <Badge>Coming soon</Badge>
                  ) : (
                    <div className="text-right">
                      <Change value={ret} className="text-[18px] tracking-[-0.03em]" />
                      <div className="text-[12px] text-[#6b6b6b]">past year</div>
                    </div>
                  )}
                </div>
                <div className="px-5 pt-5">
                  <h3 className="text-[22px] tracking-[-0.04em]">{p.name}</h3>
                  <p className="mt-1 text-[14px] text-[#6b6b6b]">{p.who}</p>
                </div>
                <div className="mt-auto pt-4">
                  {p.comingSoon ? (
                    <div className="px-5 pb-5">
                      <MixBar slices={p.mix} className="h-1.5" />
                      <p className="mt-3 text-[12px] text-[#6b6b6b]">Holds stocks, which NEAR Intents can&apos;t route yet.</p>
                    </div>
                  ) : (
                    <ValueChart data={series} dates={h?.dates} height={90} />
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div id="assets" className="mt-12 scroll-mt-28">
        <SectionTitle>Everything you can hold</SectionTitle>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSETS.map((a) => {
          const q = quote(a.id);
          return (
            <Card key={a.id} className="flex items-center gap-4 p-4">
              <Logo id={a.id} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] tracking-[-0.02em]">{a.name}</span>
                  <span className="text-[13px] text-[#6b6b6b]">{a.ticker}</span>
                </div>
                <p className="truncate text-[13px] text-[#6b6b6b]">{a.blurb}</p>
              </div>
              <div className="shrink-0 text-right">
                {a.live ? (
                  <>
                    <div className="text-[15px] tabular-nums">{fmtPrice(q.price)}</div>
                    <Change value={q.change24h} className="text-[13px]" />
                  </>
                ) : (
                  <Badge>Coming soon</Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-black/40">Prices from NEAR Intents; 24-hour change from CoinGecko; past-year returns from Kraken daily closes. Past returns don&apos;t predict future ones.</p>
    </>
  );
}

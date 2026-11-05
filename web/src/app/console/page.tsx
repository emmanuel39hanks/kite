"use client";

import { VaultReview } from "@/components/console/vault-review";
import { SwapTracker } from "@/components/console/swap-tracker";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MixBar } from "@/components/charts";
import { ActivityList } from "@/components/console/activity-list";
import { ConnectGate } from "@/components/console/connect-gate";
import { Icon, type IconName } from "@/components/console/icons";
import { Badge, Button, Card, Change, Empty, Money, PageTitle, SectionTitle, Segmented, StatusNote } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import { assetById, earnVersionOf, units as fmtUnits, usd, price as fmtPrice } from "@/lib/assets";
import { useLive } from "@/lib/near/live";
import { useWallet } from "@/lib/near/wallet";
import { PLAN_DATA } from "@/lib/plans";
import { driftOf, useKite, type Portfolio } from "@/lib/store";
import { backtest, holdingsValue, useHistory, useMarket, useYields } from "@/lib/market/use-market";

const RANGES = ["1W", "1M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const DAYS: Record<Range, number> = { "1W": 7, "1M": 30, "1Y": 365 };
const RANGE_WORD: Record<Range, string> = { "1W": "week", "1M": "month", "1Y": "year" };

export default function Dashboard() {
  const w = useWallet();
  const k = useKite();
  if (!w.ready) return <Skeleton />;
  if (!w.accountId) {
    return (
      <>
        <PageTitle>Home</PageTitle>
        <ConnectGate />
      </>
    );
  }
  if (k.vaultFound === null) return <Skeleton />;
  if (!k.vaultFound || !k.portfolio) return <NoVault />;
  return <Live p={k.portfolio} />;
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-busy="true">
      <div className="pt-10 pb-8">
        <div className="h-9 w-48 rounded-lg bg-black/[0.06]" />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-[342px] rounded-[20px] bg-[#f5f5f7]" />
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[106px] rounded-[20px] bg-[#f5f5f7]" />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Connected, no vault yet ───────────── */

function NoVault() {
  const h = useHistory(365);
  return (
    <>
      <PageTitle actions={<Button href="/console/create" icon="create">Create a plan</Button>}>Home</PageTitle>
      <Card className="p-8 sm:p-12">
        <h2 className="text-[34px] leading-[1.05] tracking-[-0.05em]">You don&apos;t have a vault yet</h2>
        <p className="mt-3 max-w-[52ch] text-[16px] leading-6 text-[#909090]">
          Pick a plan to start. One signature creates your vault on NEAR; then add money from any chain and Kite keeps the mix on target.
        </p>
      </Card>
      <div className="mt-10">
        <SectionTitle>Start with a plan</SectionTitle>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {PLAN_DATA.map((p) => {
          const series = h && !p.comingSoon ? backtest(h, p.mix) : [];
          const ret = series.length > 1 ? (series[series.length - 1] / series[0] - 1) * 100 : null;
          return (
            <Link key={p.slug} href={`/console/explore/${p.slug}`} className="group rounded-[20px] outline-offset-4">
              <Card className="h-full p-5 transition-colors group-hover:bg-[#efeff2]">
                <div className="flex items-start justify-between">
                  <div className="flex -space-x-2">
                    {p.mix.map((s) => (
                      <Logo key={s.id} id={s.id} size={32} className="ring-2 ring-[#f5f5f7]" />
                    ))}
                  </div>
                  {p.comingSoon ? (
                    <Badge>Coming soon</Badge>
                  ) : (
                    <div className="text-right">
                      <Change value={ret} className="text-[15px]" />
                      <div className="text-[12px] text-[#909090]">past year</div>
                    </div>
                  )}
                </div>
                <h3 className="mt-6 text-[22px] tracking-[-0.04em]">{p.name}</h3>
                <p className="mt-1 text-[14px] text-[#909090]">{p.who}</p>
                <MixBar slices={p.mix} className="mt-5 h-1.5" />
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/* ───────────── Live dashboard ───────────── */

function Live({ p }: { p: Portfolio }) {
  const k = useKite();
  const live = useLive();
  const { quote } = useMarket();
  const yields = useYields();
  const [range, setRange] = useState<Range>("1M");
  const [now] = useState(() => Date.now());
  const h = useHistory(DAYS[range]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // The vault's own history when we have it (preview); otherwise current holdings at real past prices.
  // Either way the last point is today's live value.
  const series = useMemo(() => {
    if (p.series?.length) {
      const from = now - DAYS[range] * 86_400_000;
      const pts = p.series.filter((x) => x.t >= from);
      const all = [...pts, { t: now, v: p.value }];
      return { data: all.map((x) => x.v), dates: all.map((x) => x.t) };
    }
    if (!h) return { data: [] as number[], dates: [] as number[] };
    const past = holdingsValue(h, p.units).map((v) => v + p.cash);
    if (past.length < 2) return { data: [] as number[], dates: [] as number[] };
    return { data: [...past.slice(0, -1), p.value], dates: h.dates.slice(-past.length) };
  }, [h, p.units, p.cash, p.value, p.series, range, now]);
  const pnl = p.invested !== undefined && p.invested > 0 ? p.value - p.invested : null;
  const pnlPct = pnl !== null && p.invested ? (pnl / p.invested) * 100 : 0;
  const first = series.data[0] ?? p.value;
  const rangeChange = p.value - first;
  const rangePct = first > 0 ? (rangeChange / first) * 100 : 0;

  // 24h move of what's held now, from live 24h changes.
  const day = p.target.reduce((acc, t) => {
    const q = quote(t.id);
    const v = (p.units[t.id] ?? 0) * q.price;
    return q.change24h === null ? acc : acc + v - v / (1 + q.change24h / 100);
  }, 0);
  const dayPct = p.value - day > 0 ? (day / (p.value - day)) * 100 : 0;

  const rows = driftOf(p);
  // Earning holdings at today's yields, or the best yield the plan could have.
  const earnSummary = (() => {
    const held = p.target.filter((t) => assetById(t.id).earn);
    if (held.length) {
      const perYear = held.reduce((a, t) => a + (p.units[t.id] ?? 0) * quote(t.id).price * ((yields[t.id as keyof typeof yields]?.apy ?? 0) / 100), 0);
      return { earning: true as const, perYear, pct: p.value > 0 ? (perYear / p.value) * 100 : 0 };
    }
    const could = p.target
      .map((t) => earnVersionOf(t.id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ name: assetById(a.earn!.base).name, apy: yields[a.id as keyof typeof yields]?.apy ?? 0 }))
      .sort((x, y) => y.apy - x.apy)[0];
    return could ? { earning: false as const, ...could } : null;
  })();
  const invested = p.value - p.cash > 0.5;
  const worst = invested && rows.length ? Math.max(...rows.map((r) => Math.abs(r.drift))) : 0;
  const offPlan = invested && worst >= k.guardrails.driftBand;

  const act = async (name: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    setMsg(null);
    try {
      const r = (await fn()) as { error?: string; lines?: string[] } | string | undefined;
      if (r && typeof r === "object" && r.error) setMsg({ tone: "err", text: r.error });
      else setMsg({ tone: "ok", text: r && typeof r === "object" && r.lines?.length ? r.lines[r.lines.length - 1] : ok });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageTitle
        actions={
          <>
            <Button icon="refresh" onClick={() => act("check", live.checkNow, "Checked.")} loading={busy === "check"}>
              Check now
            </Button>
            <Button variant="primary" icon="deposit" href="/console/start/add-money">
              Add money
            </Button>
          </>
        }
      >
        {p.name}
      </PageTitle>

      {msg && (
        <StatusNote tone={msg.tone} className="mb-4">
          {msg.text}
        </StatusNote>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-h-[342px] flex-col overflow-hidden pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6">
            <div>
              <div className="text-[16px] tracking-[-0.02em] text-[#909090]">Total value</div>
              <Money value={p.value} className="text-[48px] leading-[56px] tracking-[-0.04em]" />
              <div className="text-[14px] tracking-[-0.02em]">
                <span className={rangeChange >= 0 ? "text-[#05a800]" : "text-rose-500"}>
                  {rangeChange >= 0 ? "+" : "−"}
                  {usd(Math.abs(rangeChange))} ({rangePct >= 0 ? "+" : ""}
                  {rangePct.toFixed(2)}%)
                </span>{" "}
                <span className="text-[#909090]">past {RANGE_WORD[range]}</span>
              </div>
              {pnl !== null && (
                <div className="mt-0.5 text-[14px] tracking-[-0.02em]">
                  <span className={pnl >= 0 ? "text-[#05a800]" : "text-rose-500"}>
                    {pnl >= 0 ? "+" : "−"}
                    {usd(Math.abs(pnl))} ({pnlPct >= 0 ? "+" : ""}
                    {pnlPct.toFixed(2)}%)
                  </span>{" "}
                  <span className="text-[#909090]">profit and loss on {usd(p.invested!)} put in</span>
                </div>
              )}
            </div>
            <Segmented options={RANGES} value={range} onChange={setRange} label="Chart range" />
          </div>
          <div className="mt-auto pt-4">
            <ValueChart data={series.data} dates={series.dates} height={175} />
          </div>
          <p className="px-6 pb-3 text-[11px] text-black/35">
            {p.series?.length ? "Your vault's value over time, at real prices." : "What your current holdings were worth at real past prices."}
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <Stat label="Last 24 hours">
            <span className="text-[28px] leading-9 tracking-[-0.05em] tabular-nums">
              {day >= 0 ? "+" : "−"}
              {usd(Math.abs(day))}
            </span>{" "}
            <Change value={invested ? dayPct : null} className="text-[14px]" />
          </Stat>
          <Stat
            label="Plan health"
            aside={p.paused ? <Badge tone="red">Paused</Badge> : !invested ? <Badge>Not invested</Badge> : offPlan ? <Badge tone="amber">Rebalance due</Badge> : <Badge tone="green">On plan</Badge>}
          >
            <span className="text-[28px] leading-9 tracking-[-0.05em] tabular-nums">{worst.toFixed(1)}</span>
            <span className="text-[14px] text-[#909090]"> of {k.guardrails.driftBand} pts allowed drift</span>
          </Stat>
          <Stat label="Next check" aside={k.keyActive ? <Badge tone="green">Kite&apos;s key on</Badge> : <Badge>Key revoked</Badge>}>
            <Countdown />
            {live.preview && <p className="mt-1 text-[12px] leading-4 text-[#909090]">Preview has no daily job. Press Check now to run it.</p>}
          </Stat>
        </div>
      </div>

      <Notices
        p={p}
        earn={earnSummary}
        busy={busy}
        onInvest={() => act("invest", live.allocate, live.preview ? "Invested at real NEAR Intents quotes." : "Invest transaction sent. Swaps settle in about a minute.")}
        onUnpause={() => act("unpause", live.unpause, "Vault unpaused.")}
      />

      <div className="mt-10">
        <SectionTitle actions={<Button size="sm" href="/console/guardrails" icon="shield">Guardrails</Button>}>Holdings</SectionTitle>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[15px] tracking-[-0.02em]">
              <thead>
                <tr className="text-left text-[14px] text-[#909090]">
                  <th className="px-5 py-3.5 font-normal">Asset</th>
                  <th className="px-5 py-3.5 text-right font-normal">Price</th>
                  <th className="px-5 py-3.5 text-right font-normal">Holding</th>
                  {p.cost && <th className="px-5 py-3.5 text-right font-normal">Return</th>}
                  <th className="px-5 py-3.5 text-right font-normal">Target</th>
                  <th className="px-5 py-3.5 text-right font-normal">Now</th>
                  <th className="w-[200px] px-5 py-3.5 font-normal">Drift</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = assetById(r.id);
                  const q = quote(r.id);
                  const units = p.units[r.id] ?? 0;
                  return (
                    <tr key={r.id} className="border-t border-black/[0.05] bg-white">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Logo id={r.id} size={32} />
                          <div className="leading-tight">
                            <div>{a.name}</div>
                            <div className="text-[13px] text-[#909090]">
                              {a.ticker}
                              {a.earn && yields[r.id as keyof typeof yields] && (
                                <span className="text-[#05a800]"> · earns {yields[r.id as keyof typeof yields]!.apy.toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="tabular-nums">{fmtPrice(q.price)}</div>
                        <Change value={q.change24h} className="text-[13px]" />
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="tabular-nums">{usd(units * q.price)}</div>
                        <div className="text-[13px] text-[#909090] tabular-nums">
                          {fmtUnits(units)} {a.ticker}
                        </div>
                      </td>
                      {p.cost && <ReturnCell value={units * q.price} cost={p.cost[r.id] ?? 0} />}
                      <td className="px-5 py-4 text-right text-[#909090] tabular-nums">{r.weight}%</td>
                      <td className="px-5 py-4 text-right tabular-nums">{invested ? `${r.current.toFixed(1)}%` : "–"}</td>
                      <td className="px-5 py-4">
                        <DriftMeter drift={invested ? r.drift : 0} band={k.guardrails.driftBand} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {invested && (
        <div className="mt-10">
          <VaultReview p={p} />
        </div>
      )}

      <div className="mt-10">
        <SectionTitle actions={<Button size="sm" href="/console/activity">See all</Button>}>Recent activity</SectionTitle>
        <Card className="overflow-hidden">
          {k.activity.length ? (
            <div className="bg-white">
              <ActivityList events={k.activity.slice(0, 5)} compact />
            </div>
          ) : (
            <Empty title="Nothing yet" text="Deposits, rebalances and guardrail changes you make from this browser show up here." />
          )}
        </Card>
      </div>
    </>
  );
}

function ReturnCell({ value, cost }: { value: number; cost: number }) {
  if (cost < 0.01) return <td className="px-5 py-4 text-right text-[#909090]">–</td>;
  const gain = value - cost;
  return (
    <td className="px-5 py-4 text-right">
      <div className={`tabular-nums ${gain >= 0 ? "text-[#05a800]" : "text-rose-500"}`}>
        {gain >= 0 ? "+" : "−"}
        {usd(Math.abs(gain))}
      </div>
      <Change value={(gain / cost) * 100} className="text-[13px]" />
    </td>
  );
}

function Stat({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="flex min-h-[106px] flex-col justify-between gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] tracking-[-0.02em] text-[#909090]">{label}</span>
        {aside}
      </div>
      <div>{children}</div>
    </Card>
  );
}

function Countdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const mins = Math.max(0, Math.round((next.getTime() - now) / 60_000));
  return (
    <>
      <span className="text-[28px] leading-9 tracking-[-0.05em] tabular-nums">
        {Math.floor(mins / 60)}h {mins % 60}m
      </span>
      <span className="text-[14px] text-[#909090]"> at 00:00 UTC</span>
    </>
  );
}

type EarnSummary = { earning: true; perYear: number; pct: number } | { earning: false; name: string; apy: number } | null;

function Notices({ p, earn, busy, onInvest, onUnpause }: { p: Portfolio; earn: EarnSummary; busy: string | null; onInvest: () => void; onUnpause: () => void }) {
  const items: React.ReactNode[] = [];
  if (earn?.earning && earn.perYear > 0.005)
    items.push(
      <Notice key="earn" icon="up" title={`Earning about ${usd(earn.perYear)} a year`} text={`${earn.pct.toFixed(2)}% on top of price moves, from the staked and lent parts of your plan at today's rates.`}>
        <Button size="sm" href="/console/earn">
          See what earns
        </Button>
      </Notice>,
    );
  if (earn && !earn.earning && earn.apy > 0)
    items.push(
      <Notice key="could-earn" icon="up" title={`Your ${earn.name} could earn ${earn.apy.toFixed(1)}%`} text="An earning version keeps the same price moves and adds a yield. See how it works and what it costs.">
        <Button size="sm" href="/console/earn">
          Earn
        </Button>
      </Notice>,
    );
  if (p.cash >= 2)
    items.push(
      <Notice key="cash" icon="deposit" title={`${usd(p.cash)} ready to invest`} text="New money is in your vault as USDC. One signature splits it across your plan.">
        <Button size="sm" variant="primary" onClick={onInvest} loading={busy === "invest"}>
          Invest now
        </Button>
      </Notice>,
    );
  if (p.paused)
    items.push(
      <Notice key="paused" icon="lock" title="Your vault is paused" text="A swap didn't deliver in time, so the vault stopped Kite from trading. Check the activity, then unpause.">
        <Button size="sm" onClick={onUnpause} loading={busy === "unpause"}>
          Unpause
        </Button>
      </Notice>,
    );
  if (p.pending) items.push(<SwapTracker key={p.pending.depositAddress} sell={p.pending.sell} buy={p.pending.buy} depositAddress={p.pending.depositAddress} />);
  if (p.value < 2)
    items.push(
      <Notice key="empty" icon="deposit" title="Add your first deposit" text="Send USDC, ETH, BTC or SOL from any chain. It lands in your vault in about a minute.">
        <Button size="sm" variant="primary" href="/console/start/add-money">
          Add money
        </Button>
      </Notice>,
    );
  if (!items.length) return null;
  return <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items}</div>;
}

function Notice({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-4 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] tracking-[-0.02em]">{title}</h3>
        <p className="mt-0.5 text-[13px] leading-5 text-[#909090]">{text}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </Card>
  );
}

/** Centred on target; the green band is where Kite leaves it alone. */
function DriftMeter({ drift, band }: { drift: number; band: number }) {
  const scale = band * 2.5;
  const pos = Math.max(-1, Math.min(1, drift / scale));
  const bandPct = (band / scale) * 50;
  const over = Math.abs(drift) >= band;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-1.5 w-full rounded-full bg-black/[0.07]">
        <div className="absolute inset-y-0 rounded-full bg-[#8cc6f6]/45" style={{ left: `${50 - bandPct}%`, width: `${bandPct * 2}%` }} />
        <div className="absolute -inset-y-1 left-1/2 w-px bg-black/20" />
        <div
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${over ? "bg-[#e8a317]" : "bg-black"}`}
          style={{ left: `${50 + pos * 50}%` }}
        />
      </div>
      <span className={`w-11 text-right text-[13px] tabular-nums ${over ? "text-[#8a5a00]" : "text-[#909090]"}`}>
        {drift > 0 ? "+" : ""}
        {drift.toFixed(1)}
      </span>
    </div>
  );
}

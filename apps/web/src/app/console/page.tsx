"use client";

import { VaultReview } from "@/components/console/vault-review";
import { SwapTracker } from "@/components/console/swap-tracker";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Donut, MixBar } from "@/components/charts";
import { ActivityList } from "@/components/console/activity-list";
import { ConnectGate } from "@/components/console/connect-gate";
import { DaoOwnedNotice, daoViewHref, useForeignOwner } from "@/components/console/dao-owned";
import { Icon, type IconName } from "@/components/console/icons";
import { Badge, Button, Card, Change, Empty, Money, PageTitle, SectionTitle, Segmented, StatusNote } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import { assetById, earnVersionOf, units as fmtUnits, usd, price as fmtPrice } from "@/lib/assets";
import { accountUrl, NEAR } from "@/lib/near/config";
import { useLive } from "@/lib/near/live";
import { useWallet } from "@/lib/near/wallet";
import { pickMyVault, useMyVault } from "@/lib/near/my-vault";
import { PLAN_DATA } from "@/lib/plans";
import { driftOf, useKite, type Guardrails, type Portfolio } from "@/lib/store";
import { nextTradeUsd, tradeBigEnough } from "@/lib/minimums";
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
  const w = useWallet();
  const k = useKite();
  const mine = useMyVault(w.preview ? null : w.accountId);
  // Chose "New vault" while already owning one: say so, and offer the way back.
  const others = mine?.open ?? [];
  return (
    <>
      <PageTitle actions={<Button href="/console/create" icon="notepad">Create a plan</Button>}>Home</PageTitle>
      <Card className="p-8 sm:p-12">
        <h2 className="text-[34px] leading-[1.05] tracking-[-0.05em]">{others.length ? "Set up a new vault" : "You don't have a vault yet"}</h2>
        <p className="mt-3 max-w-[52ch] text-[16px] leading-6 text-[#6b6b6b]">
          {others.length
            ? `Pick a plan for your next vault. It will be ${mine!.next}, with its own ${NEAR.factoryDepositNear} NEAR deposit, and your other vaults keep running as they are.`
            : "Pick a plan to start. One signature creates your vault on NEAR; then add money from any chain and Kite keeps the mix on target."}
        </p>
        {others.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {others.map((v) => (
              <Button key={v} size="sm" icon="arrow-left" onClick={() => pickMyVault(w.accountId!, v)}>
                Back to {k.names[v]?.name ?? v.replace(`.${NEAR.factory}`, "")}
              </Button>
            ))}
          </div>
        )}
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
                      <div className="text-[12px] text-[#6b6b6b]">past year</div>
                    </div>
                  )}
                </div>
                <h3 className="mt-6 text-[22px] tracking-[-0.04em]">{p.name}</h3>
                <p className="mt-1 text-[14px] text-[#6b6b6b]">{p.who}</p>
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
  const ownedBy = useForeignOwner();
  const { quote } = useMarket();
  const yields = useYields();
  const [range, setRange] = useState<Range>("1M");
  const [now] = useState(() => Date.now());
  const h = useHistory(DAYS[range]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Kite traded while this page was open: say so, so the new numbers don't change silently.
  const [seenTrade, setSeenTrade] = useState(p.lastTradeMs ?? 0);
  if ((p.lastTradeMs ?? 0) > seenTrade) {
    setSeenTrade(p.lastTradeMs ?? 0);
    setMsg({ tone: "ok", text: "Kite just rebalanced your vault. The new mix is below; Activity has the transaction." });
  }
  // A message left by another page that sent us back here (e.g. "Target mix saved").
  useEffect(() => {
    try {
      const flash = sessionStorage.getItem("kite-flash");
      if (flash) {
        sessionStorage.removeItem("kite-flash");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a one-time message from storage
        setMsg({ tone: "ok", text: flash });
      }
    } catch {}
  }, []);

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
  // Off plan, but the trade it calls for is under the vault's $1 floor: say so instead of promising a rebalance.
  const tooSmall = offPlan && !tradeBigEnough(nextTradeUsd(p.value - p.cash, driftOf(p).map((d) => d.drift), k.guardrails));

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
            {!ownedBy && (
              <Button icon="withdraw" href="/console/guardrails#withdraw">
                Withdraw
              </Button>
            )}
            {!ownedBy && (
              <Button variant="primary" icon="deposit" href="/console/start/add-money">
                Add money
              </Button>
            )}
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

      {ownedBy && <DaoOwnedNotice owner={ownedBy} vault={p.vault} className="mb-3" />}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-h-[342px] flex-col overflow-hidden pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6">
            <div>
              <div className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">Total value</div>
              <Money value={p.value} className="text-[48px] leading-[56px] tracking-[-0.04em]" />
              <div className="text-[14px] tracking-[-0.02em]">
                <span className={rangeChange >= 0 ? "text-[#05a800]" : "text-rose-500"}>
                  {rangeChange >= 0 ? "+" : "−"}
                  {usd(Math.abs(rangeChange))} ({rangePct >= 0 ? "+" : ""}
                  {rangePct.toFixed(2)}%)
                </span>{" "}
                <span className="text-[#6b6b6b]">past {RANGE_WORD[range]}</span>
              </div>
              {pnl !== null && (
                <div className="mt-0.5 text-[14px] tracking-[-0.02em]">
                  <span className={pnl >= 0 ? "text-[#05a800]" : "text-rose-500"}>
                    {pnl >= 0 ? "+" : "−"}
                    {usd(Math.abs(pnl))} ({pnlPct >= 0 ? "+" : ""}
                    {pnlPct.toFixed(2)}%)
                  </span>{" "}
                  <span className="text-[#6b6b6b]">profit and loss on {usd(p.invested!)} put in</span>
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
            aside={p.paused ? <Badge tone="red">Paused</Badge> : !invested ? <Badge>Not invested</Badge> : offPlan ? (tooSmall ? <Badge tone="amber">Trade too small</Badge> : <Badge tone="amber">Rebalance due</Badge>) : <Badge tone="green">On plan</Badge>}
          >
            <span className="text-[28px] leading-9 tracking-[-0.05em] tabular-nums">{worst.toFixed(1)}</span>
            <span className="text-[14px] text-[#6b6b6b]"> of {k.guardrails.driftBand} pts allowed drift</span>
            {tooSmall && !ownedBy && (
              <p className="mt-1 text-[12px] leading-4 text-[#8a5a00]">
                The trade Kite needs is under the vault&apos;s $1 minimum.{" "}
                <a href="/console/guardrails#rules" className="underline underline-offset-2">
                  Raise the biggest trade
                </a>{" "}
                or add money.
              </p>
            )}
          </Stat>
          <Stat label="Next check" aside={k.keyActive ? <Badge tone="green">Kite&apos;s key on</Badge> : <Badge>Key revoked</Badge>}>
            <Countdown />
            {!live.preview && p.lastTradeMs ? (
              <p className="mt-1 text-[12px] leading-4 text-[#6b6b6b]">
                Kite last traded <Ago ms={p.lastTradeMs} />.{" "}
                <a href="/console/activity" className="underline underline-offset-2 hover:text-black">
                  See it
                </a>
              </p>
            ) : null}
            {live.preview && <p className="mt-1 text-[12px] leading-4 text-[#6b6b6b]">Preview has no daily job. Press Check now to run it.</p>}
          </Stat>
        </div>
      </div>

      <Notices
        p={p}
        earn={earnSummary}
        busy={busy}
        ownedBy={ownedBy}
        onInvest={() => act("invest", live.allocate, live.preview ? "Invested at real NEAR Intents quotes." : "Invest transaction sent. Swaps settle in about a minute.")}
        onUnpause={() => act("unpause", live.unpause, "Vault unpaused.")}
      />

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <MixCard p={p} invested={invested} editable={!ownedBy} />
        <RulesCard g={k.guardrails} paused={p.paused} editable={!ownedBy} />
        <VaultCard p={p} keyOn={k.keyActive} ownedBy={ownedBy} preview={live.preview} />
      </div>

      <div className="mt-10">
        <SectionTitle actions={<Button size="sm" href="/console/guardrails" icon="shield">Guardrails</Button>}>Holdings</SectionTitle>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[15px] tracking-[-0.02em]">
              <thead>
                <tr className="text-left text-[14px] text-[#6b6b6b]">
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
                            <div className="text-[13px] text-[#6b6b6b]">
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
                        <div className="text-[13px] text-[#6b6b6b] tabular-nums">
                          {fmtUnits(units)} {a.ticker}
                        </div>
                      </td>
                      {p.cost && <ReturnCell value={units * q.price} cost={p.cost[r.id] ?? 0} />}
                      <td className="px-5 py-4 text-right text-[#6b6b6b] tabular-nums">{r.weight}%</td>
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
  if (cost < 0.01) return <td className="px-5 py-4 text-right text-[#6b6b6b]">–</td>;
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
        <span className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">{label}</span>
        {aside}
      </div>
      <div>{children}</div>
    </Card>
  );
}

/** "3 min ago", kept current. */
function Ago({ ms }: { ms: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  const text = m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  return <time dateTime={new Date(ms).toISOString()}>{text}</time>;
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
      <span className="text-[14px] text-[#6b6b6b]"> at 00:00 UTC</span>
    </>
  );
}

type EarnSummary = { earning: true; perYear: number; pct: number } | { earning: false; name: string; apy: number } | null;

function Notices({ p, earn, busy, ownedBy, onInvest, onUnpause }: { p: Portfolio; earn: EarnSummary; busy: string | null; ownedBy: string | null; onInvest: () => void; onUnpause: () => void }) {
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
      ownedBy ? (
        <Notice key="cash" icon="deposit" title={`${usd(p.cash)} not invested yet`} text={`New money is in the vault as USDC. Only its owner, ${ownedBy}, can split it across the plan.`} />
      ) : (
        <Notice key="cash" icon="deposit" title={`${usd(p.cash)} ready to invest`} text="New money is in your vault as USDC. One signature splits it across your plan.">
          <Button size="sm" variant="primary" onClick={onInvest} loading={busy === "invest"}>
            Invest now
          </Button>
        </Notice>
      ),
    );
  if (p.paused)
    items.push(
      ownedBy ? (
        <Notice key="paused" icon="lock" title="The vault is paused" text={`Kite can't trade. Unpausing is a proposal on ${ownedBy}.`}>
          <Button size="sm" href={daoViewHref(p.vault)}>
            Open the DAO view
          </Button>
        </Notice>
      ) : (
        <Notice key="paused" icon="lock" title="Your vault is paused" text="A swap didn't deliver in time, so the vault stopped Kite from trading. Check the activity, then unpause.">
          <Button size="sm" onClick={onUnpause} loading={busy === "unpause"}>
            Unpause
          </Button>
        </Notice>
      ),
    );
  if (p.pending) items.push(<SwapTracker key={p.pending.depositAddress} sell={p.pending.sell} buy={p.pending.buy} depositAddress={p.pending.depositAddress} />);
  if (p.value < 2 && !ownedBy)
    items.push(
      <Notice key="empty" icon="deposit" title="Add your first deposit" text="Send USDC, ETH, BTC or SOL from any chain. It lands in your vault in about a minute.">
        <Button size="sm" variant="primary" href="/console/start/add-money">
          Add money
        </Button>
      </Notice>,
    );
  if (!items.length) return null;
  return <div className={`mt-3 grid gap-3 ${items.length > 1 ? "md:grid-cols-2" : ""} ${items.length > 2 ? "xl:grid-cols-3" : ""}`}>{items}</div>;
}

function Notice({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: React.ReactNode }) {
  return (
    <Card className="@container p-4">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4 @2xl:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <Icon name={icon} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] tracking-[-0.02em]">{title}</h3>
            <p className="mt-0.5 text-[13px] leading-5 text-[#6b6b6b]">{text}</p>
          </div>
        </div>
        {children && <div className="pl-14 @2xl:shrink-0 @2xl:pl-0">{children}</div>}
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
      <span className={`w-11 text-right text-[13px] tabular-nums ${over ? "text-[#8a5a00]" : "text-[#6b6b6b]"}`}>
        {drift > 0 ? "+" : ""}
        {drift.toFixed(1)}
      </span>
    </div>
  );
}

/* ───────────── At a glance ───────────── */

/** Where the money sits now, against the plan. */
function MixCard({ p, invested, editable }: { p: Portfolio; invested: boolean; editable: boolean }) {
  const now = p.target.map((t) => ({ ...t, weight: invested ? Math.round(p.current[t.id] ?? 0) : t.weight }));
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] tracking-[-0.02em]">Your mix</h3>
        {editable && (
          <Button size="sm" icon="refresh" href="/console/guardrails#mix">
            Change mix
          </Button>
        )}
      </div>
      <div className="mt-1 flex justify-end gap-0 text-[12px] text-[#6b6b6b]">
        <span className="w-10 text-right">now</span>
        <span className="w-10 text-right">target</span>
      </div>
      <div className="mt-4 flex items-center gap-5">
        <div className="relative shrink-0">
          <Donut slices={now} size={112} thickness={5} />
          <div className="absolute inset-0 grid place-items-center text-center leading-tight">
            <div>
              <div className="text-[22px] tracking-[-0.04em] tabular-nums">{p.target.length}</div>
              <div className="text-[11px] text-[#6b6b6b]">{p.target.length === 1 ? "asset" : "assets"}</div>
            </div>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-2">
          {p.target.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-[14px] tracking-[-0.02em]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
              <span className="min-w-0 flex-1 truncate">{assetById(t.id).name}</span>
              <span className="w-10 text-right tabular-nums">{invested ? `${(p.current[t.id] ?? 0).toFixed(0)}%` : "–"}</span>
              <span className="w-10 text-right text-[#6b6b6b] tabular-nums">{t.weight}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** The guardrails, in plain words. The vault enforces them, not Kite. */
function RulesCard({ g, paused, editable }: { g: Guardrails; paused: boolean; editable: boolean }) {
  const rules: [IconName, string][] = [
    ["refresh", `Rebalances when anything drifts ${g.driftBand} points`],
    ["deposit", `Moves at most ${g.maxTradePct}% in one trade`],
    ["shield", `Gives up at most ${(g.slippageBps / 100).toFixed(g.slippageBps % 100 ? 1 : 0)}% of value in a trade`],
    ["clock", `Up to ${g.tradesPerDay} trades a day`],
  ];
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] tracking-[-0.02em]">Your rules</h3>
        {editable && (
          <Button size="sm" icon="shield" href="/console/guardrails#rules">
            Edit rules
          </Button>
        )}
      </div>
      <ul className="mt-3 space-y-2.5">
        {rules.map(([icon, text]) => (
          <li key={text} className="flex items-center gap-2.5 text-[14px] tracking-[-0.02em]">
            <Icon name={icon} size={16} className="text-black/45" />
            {text}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-[12px] leading-4 text-[#6b6b6b]">{paused ? "Paused: Kite can't trade until it's unpaused." : "Checked by your vault on NEAR before every trade, not by Kite."}</p>
    </Card>
  );
}

/** Who can do what with the vault. */
function VaultCard({ p, keyOn, ownedBy, preview }: { p: Portfolio; keyOn: boolean; ownedBy: string | null; preview: boolean }) {
  const rows: [string, React.ReactNode][] = [
    ["Owner", ownedBy ?? "You"],
    ["Can withdraw", ownedBy ? "Only the DAO, by vote" : "Only you, any time"],
    ["Kite's key", keyOn ? "Rebalance and settle only" : "Revoked"],
  ];
  return (
    <Card className="flex flex-col p-5">
      <h3 className="text-[16px] tracking-[-0.02em]">Your vault</h3>
      <div className="mt-1 truncate font-mono text-[12px] text-[#6b6b6b]" title={p.vault}>
        {p.vault}
      </div>
      <dl className="mt-3 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-[14px] tracking-[-0.02em]">
            <dt className="text-[#6b6b6b]">{k}</dt>
            <dd className="truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        {!ownedBy && (
          <Button size="sm" icon="withdraw" href="/console/guardrails#withdraw">
            Withdraw
          </Button>
        )}
        {preview ? (
          <p className="text-[12px] leading-4 text-[#6b6b6b]">In the preview this vault lives in your browser. A real one is a contract on NEAR you can inspect.</p>
        ) : (
          <a href={accountUrl(p.vault)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] underline underline-offset-2 hover:text-black/70">
            See it on NearBlocks <Icon name="external" size={13} />
          </a>
        )}
      </div>
    </Card>
  );
}

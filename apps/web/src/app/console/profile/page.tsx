"use client";

import { useEffect, useMemo, useState } from "react";
import { MixBar } from "@/components/charts";
import { ConnectGate } from "@/components/console/connect-gate";
import { DaoHandoff } from "@/components/console/dao-handoff";
import { PastVaults } from "@/components/console/past-vaults";
import { IntentsBalance } from "@/components/console/intents-balance";
import { daoViewHref } from "@/components/console/dao-owned";
import { Icon } from "@/components/console/icons";
import { Avatar, Badge, Button, Card, Change, Empty, Money, PageTitle, SectionTitle, Segmented } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import { assetById, units as fmtUnits, usd } from "@/lib/assets";
import { accountUrl } from "@/lib/near/config";
import { nearBalance, usdcBalance } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import { usePreview } from "@/lib/preview/engine";
import type { LogoId } from "@/lib/assets";
import { useKite } from "@/lib/store";
import { holdingsValue, useHistory, useMarket } from "@/lib/market/use-market";

const RANGES = ["1W", "1M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const DAYS: Record<Range, number> = { "1W": 7, "1M": 30, "1Y": 365 };

export default function ProfilePage() {
  const w = useWallet();
  if (!w.ready) return null;
  if (!w.accountId)
    return (
      <>
        <PageTitle>My profile</PageTitle>
        <ConnectGate />
      </>
    );
  return <Profile account={w.accountId} preview={w.preview} />;
}

function Profile({ account, preview }: { account: string; preview: boolean }) {
  const k = useKite();
  const { quote } = useMarket();
  const p = k.portfolio;
  const [range, setRange] = useState<Range>("1M");
  const [now] = useState(() => Date.now());
  const h = useHistory(DAYS[range]);
  const [chainWallet, setWallet] = useState<Record<string, number> | null>(null);
  const pv = usePreview(preview);
  const wallet = preview ? (pv?.wallet ?? null) : chainWallet;
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    Promise.all([nearBalance(account), usdcBalance(account)]).then(([near, usdc]) => alive && setWallet({ near, usdc: Number(usdc) / 1e6 }));
    return () => {
      alive = false;
    };
  }, [account, preview]);

  const series = useMemo(() => {
    if (p?.series?.length) {
      const from = now - DAYS[range] * 86_400_000;
      const all = [...p.series.filter((x) => x.t >= from), { t: now, v: p.value }];
      return { data: all.map((x) => x.v), dates: all.map((x) => x.t) };
    }
    if (!h || !p) return { data: [] as number[], dates: [] as number[] };
    const past = holdingsValue(h, p.units).map((v) => v + p.cash);
    if (past.length < 2) return { data: [] as number[], dates: [] as number[] };
    return { data: [...past.slice(0, -1), p.value], dates: h.dates.slice(-past.length) };
  }, [h, p, range, now]);
  const first = series.data[0];
  const change = p && first ? ((p.value - first) / first) * 100 : null;

  const walletValue = wallet ? Object.entries(wallet).reduce((a, [id, n]) => a + n * quote(id).price, 0) : null;
  const walletRows: [LogoId, number | undefined][] = wallet
    ? Object.entries(wallet)
        .filter(([id, n]) => n > 1e-9 || id === "near" || id === "usdc")
        .map(([id, n]) => [id as LogoId, n])
    : [
        ["near", undefined],
        ["usdc", undefined],
      ];
  const total = (p?.value ?? 0) + (walletValue ?? 0);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  };

  const share = () => {
    const text = p
      ? `My money runs on autopilot: "${p.name}" (${p.target.map((t) => `${assetById(t.id).ticker} ${t.weight}%`).join(", ")}), rebalanced by Kite on @NEARProtocol. Self-custodied, Kite can't withdraw.`
      : "Setting up a self-custodied, auto-rebalancing portfolio on NEAR with Kite.";
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.origin)}`, "_blank", "noopener");
  };

  return (
    <div className="pt-8 sm:pt-10">
      <Card className="p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 pt-2 sm:px-0 sm:pt-0">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5">
            <span className="grid shrink-0 place-items-center rounded-full bg-white p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <Avatar seed={account} size={96} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[28px] leading-9 tracking-[-0.05em] sm:text-[36px] sm:leading-[44px]">{account}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copy(account)}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-white px-3 text-[13px] text-black/60 ring-1 ring-inset ring-black/[0.08] hover:text-black"
                >
                  <Icon name={copied === account ? "check" : "copy"} size={13} />
                  {copied === account ? "Copied" : "Copy"}
                </button>
                {!preview && <a
                  href={accountUrl(account)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] text-black/60 ring-1 ring-inset ring-black/[0.08] hover:text-black"
                >
                  NearBlocks <Icon name="external" size={13} />
                </a>}
                {preview && <Badge>Preview account</Badge>}
              </div>
            </div>
          </div>
          <Button size="sm" iconRight="share" onClick={share}>
            Share on X
          </Button>
        </div>

        <div className="mt-6 rounded-2xl bg-white pt-5 shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5">
            <div>
              <div className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">Total value</div>
              {walletValue === null && k.vaultFound === null ? (
                <div className="mt-1 h-14 w-56 animate-pulse rounded-xl bg-black/[0.05]" />
              ) : (
                <Money value={total} className="text-[44px] leading-[52px] tracking-[-0.04em]" />
              )}
              <div className="text-[14px] text-[#6b6b6b]">
                Vault {usd(p?.value ?? 0)} · Wallet {walletValue === null ? "–" : usd(walletValue)}
              </div>
            </div>
            {p && <Segmented options={RANGES} value={range} onChange={setRange} label="Chart range" />}
          </div>
          {p && series.data.length ? (
            <>
              <div className="px-5 pt-1 text-[14px]">
                <Change value={change} /> <span className="text-[#6b6b6b]">vault, past {range === "1W" ? "week" : range === "1M" ? "month" : "year"}</span>
              </div>
              <div className="mt-3">
                <ValueChart data={series.data} dates={series.dates} height={180} />
              </div>
            </>
          ) : (
            <div className="grid h-[200px] place-items-center px-5 text-center text-[15px] text-[#6b6b6b]">
              {k.vaultFound === false ? "No vault yet, so there's no history to chart." : "Loading history…"}
            </div>
          )}
        </div>
      </Card>

      <div className="mt-10 grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle actions={p && <Button size="sm" href="/console">Open home</Button>}>Kite vault</SectionTitle>
          <Card className="overflow-hidden">
            {p ? (
              <>
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[18px] tracking-[-0.03em]">{p.name}</div>
                      <button type="button" onClick={() => copy(p.vault)} className="mt-0.5 flex cursor-pointer items-center gap-1.5 text-[13px] text-[#6b6b6b] hover:text-black">
                        {p.vault} <Icon name={copied === p.vault ? "check" : "copy"} size={12} />
                      </button>
                    </div>
                    {p.paused ? <Badge tone="red">Paused</Badge> : k.keyActive ? <Badge tone="green">Kite&apos;s key on</Badge> : <Badge>Key revoked</Badge>}
                  </div>
                  <MixBar slices={p.target} className="mt-4 h-1.5" />
                </div>
                <ul className="divide-y divide-black/[0.05] bg-white">
                  {p.target.map((t) => {
                    const a = assetById(t.id);
                    const units = p.units[t.id] ?? 0;
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-5 py-3.5">
                        <Logo id={t.id} size={32} />
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="text-[15px]">{a.name}</div>
                          <div className="text-[13px] text-[#6b6b6b] tabular-nums">
                            {fmtUnits(units)} {a.ticker} · target {t.weight}%
                          </div>
                        </div>
                        <div className="text-right text-[15px] tabular-nums">{usd(units * quote(t.id).price)}</div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : k.vaultFound === false ? (
              <Empty title="No vault yet" text="Pick a plan and create your vault in one signature." action={<Button variant="primary" href="/console/explore">Explore plans</Button>} />
            ) : (
              <div className="h-[220px] animate-pulse" />
            )}
          </Card>
        </div>

        <div>
          <SectionTitle actions={!preview && <Button size="sm" href={accountUrl(account)} external icon="external">NearBlocks</Button>}>Wallet</SectionTitle>
          <Card className="overflow-hidden">
            <p className="p-5 pb-4 text-[14px] leading-5 text-[#6b6b6b]">{preview ? "The simulated wallet the preview starts you with, plus anything you withdraw from the vault." : "What's in your NEAR account itself, outside the vault."} Creating a vault takes a 2.6 NEAR deposit (you get it back when you close it) plus a little for fees.</p>
            <ul className="divide-y divide-black/[0.05] bg-white">
              {walletRows.map(([id, amount]) => [id, assetById(id).ticker, amount] as const).map(([id, ticker, amount]) => (
                <li key={id} className="flex items-center gap-3 px-5 py-3.5">
                  <Logo id={id} size={32} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-[15px]">{assetById(id).name}</div>
                    <div className="text-[13px] text-[#6b6b6b] tabular-nums">{amount === undefined ? "…" : `${fmtUnits(amount)} ${ticker}`}</div>
                  </div>
                  <div className="text-right text-[15px] tabular-nums">{amount === undefined ? "–" : usd(amount * quote(id).price)}</div>
                </li>
              ))}
            </ul>
          </Card>
          {!preview && <IntentsBalance account={account} />}
        </div>
      </div>

      {!preview && <PastVaults account={account} current={k.vaultFound ? (p?.vault ?? null) : null} />}

      {p && (
        <div className="mt-10">
          <SectionTitle actions={!preview && <Button size="sm" href={daoViewHref(p.vault)} icon="users">DAO view</Button>}>
            {!preview && p.owner && p.owner !== account ? "Owned by a DAO" : "Give this vault to a DAO"}
          </SectionTitle>
          <DaoHandoff account={account} vault={p.vault} owner={p.owner} pendingOwner={p.pendingOwner} />
        </div>
      )}
    </div>
  );
}

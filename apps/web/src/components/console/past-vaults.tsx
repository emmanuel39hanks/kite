"use client";

import { useEffect, useState } from "react";
import type { VaultSummary } from "@/app/api/vault/summary/route";
import { Icon } from "@/components/console/icons";
import { Card, Change, Disclosure, SectionTitle } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { assetById, units as fmtUnits, usd } from "@/lib/assets";
import { accountUrl, txUrl } from "@/lib/near/config";
import { factoryVaultsBy } from "@/lib/near/factory";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
function lasted(from: number, to: number) {
  const h = (to - from) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
}

/**
 * Vaults this account made with Kite's factory and has since closed, each rebuilt from its public transactions:
 * what went in, every trade Kite made, what came out. A closed vault's account is gone, its history isn't.
 */
export function PastVaults({ account, current }: { account: string; current: string | null }) {
  const [list, setList] = useState<VaultSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const made = (await factoryVaultsBy(account)).map((v) => v.vault).filter((v) => v !== current);
      const out: VaultSummary[] = [];
      // One at a time: NearBlocks rate-limits bursts.
      for (const v of made.reverse()) {
        const r = await fetch(`/api/vault/summary?vault=${encodeURIComponent(v)}`);
        if (!r.ok) throw new Error("summary");
        const s = (await r.json()) as VaultSummary;
        if (s.closedAt) out.push(s);
      }
      if (alive) setList(out);
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [account, current]);

  if (failed) return null;
  if (list === null) return null;
  if (!list.length) return null;

  return (
    <div className="mt-10">
      <SectionTitle>Past vaults</SectionTitle>
      <div className="space-y-3">
        {list.map((s) => {
          const pct = s.resultUsd !== null && s.investedUsd > 0 ? (s.resultUsd / s.investedUsd) * 100 : null;
          return (
            <Card key={s.vault} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{s.vault}</span>
                    <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[12px] text-[#6b6b6b]">Closed</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[#6b6b6b]">
                    {s.createdAt ? day(s.createdAt) : "?"} to {day(s.closedAt!)}
                    {s.createdAt ? `, ${lasted(s.createdAt, s.closedAt!)}` : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.plan.map((p) => (
                      <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-white py-1 pr-2.5 pl-1 text-[13px] shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                        <Logo id={p.id} size={18} />
                        {assetById(p.id).ticker} {p.weight}%
                      </span>
                    ))}
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-right">
                  {(
                    [
                      ["Put in", usd(s.investedUsd)],
                      ["Took out", s.withdrawals.length ? usd(s.withdrawnUsd) : "–"],
                      ["Kite trades", String(s.trades.length)],
                    ] as const
                  ).map(([l, v]) => (
                    <div key={l} className="rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                      <dt className="text-[12px] text-[#6b6b6b]">{l}</dt>
                      <dd className="text-[17px] tracking-[-0.03em] tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {s.resultUsd !== null && (
                <p className="mt-3 text-[14px]">
                  Result: <span className="tabular-nums">{s.resultUsd >= 0 ? "+" : "−"}{usd(Math.abs(s.resultUsd))}</span> <Change value={pct} className="text-[14px]" />
                  <span className="text-[13px] text-[#6b6b6b]"> before the vault&apos;s NEAR deposit, which came back on close.</span>
                </p>
              )}
              <Disclosure className="mt-3" title="What happened">
                <ul className="space-y-2">
                  {s.trades.map((t) => (
                    <li key={t.hash} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Icon name="refresh" size={14} className="text-black/45" />
                      <span className="text-black">Kite sold {usd(t.inUsd)} of {assetById(t.sell).ticker} for {assetById(t.buy).ticker}</span>
                      <span>({t.inUsd > 0 ? (((t.inUsd - t.outUsd) / t.inUsd) * 100).toFixed(2) : "–"}% cost), {day(t.at)}</span>
                      <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-black">
                        tx
                      </a>
                    </li>
                  ))}
                  {s.withdrawals.map((w, i) => (
                    <li key={`${w.hash}${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Icon name="withdraw" size={14} className="text-black/45" />
                      <span className="text-black">
                        Withdrew {fmtUnits(w.units)} {assetById(w.id).ticker}
                      </span>
                      <span>about {usd(w.usd)} that day</span>
                      <a href={txUrl(w.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-black">
                        tx
                      </a>
                    </li>
                  ))}
                  {!s.trades.length && !s.withdrawals.length && <li>No trades or withdrawals.</li>}
                </ul>
                <p className="mt-3">
                  Put in counts the USDC you invested; took out values what you withdrew at that day&apos;s price.{" "}
                  <a href={accountUrl(s.vault)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-black">
                    All its transactions on NearBlocks
                  </a>
                </p>
              </Disclosure>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

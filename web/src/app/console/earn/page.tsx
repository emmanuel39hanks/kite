"use client";

import { Badge, Button, Card, PageTitle, SectionTitle } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { Logo } from "@/components/logo";
import { ASSETS, assetById, usd, type EarnId } from "@/lib/assets";
import { useKite } from "@/lib/store";
import { useMarket, useYields } from "@/lib/use-market";

/** What can go wrong, per earning asset. Plain and specific. */
const RISKS: Record<EarnId, string[]> = {
  stnear: ["Meta Pool's contracts could fail.", "stNEAR can trade a little below the NEAR it's worth when markets are stressed."],
  wsteth: ["Lido's contracts could fail.", "Held on NEAR through a bridge from Ethereum, so the bridge has to work too."],
  gtusdc: [
    "Lent to borrowers on Morpho; a bad loan could cost lenders.",
    "Bridged from Base, through a wrapper token whose deployer we couldn't verify.",
  ],
  ksol: ["Lent to borrowers on Kamino; a bad loan could cost lenders.", "Bridged from Solana."],
};

export default function EarnPage() {
  const k = useKite();
  const yields = useYields();
  const { quote } = useMarket();
  const earnAssets = ASSETS.filter((a) => a.earn);
  const p = k.portfolio;

  // What the vault earns now, from its earning holdings at today's rates.
  const earning = p
    ? p.target
        .filter((t) => assetById(t.id).earn)
        .map((t) => {
          const value = (p.units[t.id] ?? 0) * quote(t.id).price;
          const apy = yields[t.id as EarnId]?.apy ?? 0;
          return { id: t.id, value, apy, perYear: (value * apy) / 100 };
        })
    : [];
  const perYear = earning.reduce((a, e) => a + e.perYear, 0);
  const blended = p && p.value > 0 ? (perYear / p.value) * 100 : 0;
  const couldEarn = p ? p.target.filter((t) => earnAssets.some((a) => a.earn!.base === t.id)) : [];

  return (
    <>
      <PageTitle actions={<Button variant="primary" href="/console/create" icon="create">Create a plan that earns</Button>}>Earn</PageTitle>
      <p className="-mt-4 mb-8 max-w-[64ch] text-[16px] leading-6 text-[#909090]">
        Hold the same thing and let it earn. Each of these is a staked or lent version of an asset you already know, with the same price moves plus a yield. They sit in
        your own vault in NEAR Intents, and Kite rebalances them like anything else.
      </p>

      {k.vaultFound && p && (
        <Card className="mb-10 p-5 sm:p-6">
          {earning.length ? (
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="text-[16px] tracking-[-0.02em] text-[#909090]">Your vault earns</div>
                <div className="mt-1 text-[44px] leading-[52px] tracking-[-0.04em] tabular-nums">{usd(perYear)}</div>
                <div className="text-[14px] text-[#909090]">
                  a year at today&apos;s rates · about {blended.toFixed(2)}% on {usd(p.value)}
                </div>
              </div>
              <ul className="flex flex-wrap gap-2">
                {earning.map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                    <Logo id={e.id} size={28} />
                    <div className="leading-tight">
                      <div className="text-[14px]">{assetById(e.id).name}</div>
                      <div className="text-[12px] text-[#909090] tabular-nums">
                        {usd(e.value)} · <span className="text-[#05a800]">{e.apy.toFixed(1)}%</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[18px] tracking-[-0.03em]">Your vault isn&apos;t earning yet</div>
                <p className="mt-1 max-w-[60ch] text-[14px] leading-5 text-[#909090]">
                  {couldEarn.length
                    ? `Your ${couldEarn.map((t) => assetById(t.id).name).join(" and ")} could earn instead of sitting still. Turn on Earn when you create a plan; switching a live vault over is next on Kite's list.`
                    : "Your plan doesn't hold NEAR, ETH, USDC or SOL, the four assets that have an earning version today."}
                </p>
              </div>
              <Button href="/console/create" icon="create">
                Create a plan
              </Button>
            </div>
          )}
        </Card>
      )}

      <SectionTitle>What can earn</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {earnAssets.map((a) => {
          const base = assetById(a.earn!.base);
          const y = yields[a.id as EarnId];
          return (
            <Card key={a.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Logo id={a.id} size={44} />
                  <div className="leading-tight">
                    <div className="text-[18px] tracking-[-0.03em]">{a.name}</div>
                    <div className="text-[13px] text-[#909090]">
                      Instead of {base.name} · held as {a.ticker}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[28px] leading-8 tracking-[-0.04em] tabular-nums text-[#05a800]">{y ? `${y.apy.toFixed(1)}%` : "–"}</div>
                  <div className="text-[12px] text-[#909090]">a year{y ? `, ${y.source}` : ""}</div>
                </div>
              </div>
              <p className="mt-4 text-[14px] leading-5">
                Earns from {a.earn!.how}, through {a.earn!.issuer}.
              </p>
              <ul className="mt-3 space-y-1.5 text-[13px] leading-5 text-[#909090]">
                <li className="flex gap-2">
                  <Icon name="refresh" size={15} className="mt-0.5 shrink-0" />
                  Costs about 1–2% to switch in and back out, so it pays off over months. Kite&apos;s vault allows up to {(a.slippageBps ?? 100) / 100}% per swap for it.
                </li>
                {RISKS[a.id as EarnId].map((r) => (
                  <li key={r} className="flex gap-2">
                    <Icon name="shield" size={15} className="mt-0.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <Badge>Routable through NEAR Intents</Badge>
                <a href={a.earn!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-black/60 hover:text-black">
                  {a.earn!.issuer} <Icon name="external" size={12} />
                </a>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-black/40">Yields come live from each protocol&apos;s own API and change daily. Past yields don&apos;t promise future ones. Not financial advice.</p>
    </>
  );
}

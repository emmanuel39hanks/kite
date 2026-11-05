"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Donut, MixBar } from "@/components/charts";
import { AiPlanner } from "@/components/console/ai-planner";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, Change, Slider, Switch } from "@/components/console/ui";
import { ValueChart } from "@/components/console/value-chart";
import { Logo } from "@/components/logo";
import type { LogoId } from "@/lib/assets";
import { ASSETS, assetById, baseOf, earnVersionOf, usd, price as fmtPrice } from "@/lib/assets";
import { slice, type Slice } from "@/lib/mix";
import { PLAN_DATA } from "@/lib/plans";
import { DEFAULT_GUARDRAILS, useKite, type Guardrails } from "@/lib/store";
import { backtest, useHistory, useMarket, useYields } from "@/lib/market/use-market";

const STEPS = ["Pick what to hold", "Choose how much", "Set the rules", "Name and review"] as const;

export default function CreatePage() {
  const k = useKite();
  if (!k.ready) return null;
  return <Wizard initialName={k.draft?.name ?? ""} initialMix={k.draft?.mix ?? []} initialRules={k.guardrails} />;
}

function Wizard({ initialName, initialMix, initialRules }: { initialName: string; initialMix: Slice[]; initialRules: Guardrails }) {
  const router = useRouter();
  const k = useKite();
  const [step, setStep] = useState(initialMix.length ? 1 : 0);
  const [mix, setMix] = useState<Slice[]>(initialMix);
  const [rules, setRules] = useState<Guardrails>(initialRules);
  const [name, setName] = useState(initialName);

  const total = mix.reduce((a, s) => a + s.weight, 0);
  const canNext = [mix.length >= 2, total === 100 && mix.every((s) => s.weight > 0), true, name.trim().length > 0][step];

  const finish = () => {
    k.setGuardrails(rules);
    k.setDraft({ name: name.trim(), mix });
    router.push("/console/start/custom");
  };

  return (
    <div className="mx-auto max-w-[880px]">
      <div className="pt-8 pb-6 sm:pt-10">
        <h1 className="text-[30px] leading-9 tracking-[-0.05em]">Create a plan</h1>
        <p className="mt-1 text-[16px] text-[#909090]">Four quick steps. Nothing is signed or spent until you create your vault at the end.</p>
      </div>

      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className="group w-full cursor-pointer text-left disabled:cursor-default"
            >
              <span className={`block h-1 rounded-full transition-colors ${i <= step ? "bg-black" : "bg-black/[0.08]"}`} />
              <span className={`mt-2 hidden text-[13px] tracking-[-0.01em] sm:block ${i === step ? "text-black" : i < step ? "text-black/55 group-hover:text-black" : "text-black/30"}`}>
                {i + 1}. {label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card className="p-2">
        <div className="rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)] sm:p-7">
          <div className="text-[13px] text-[#909090] sm:hidden">
            Step {step + 1} of {STEPS.length}
          </div>
          {step === 0 && (
            <PickStep
              mix={mix}
              setMix={setMix}
              onDraft={(d) => {
                setMix(d.mix);
                setRules(d.rules);
                setName(d.name);
                setStep(1);
              }}
            />
          )}
          {step === 1 && <AmountStep mix={mix} setMix={setMix} />}
          {step === 2 && <RulesStep rules={rules} setRules={setRules} />}
          {step === 3 && <ReviewStep name={name} setName={setName} mix={mix} rules={rules} />}
        </div>
        <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1.5">
          {step > 0 ? (
            <Button variant="ghost" icon="arrow-left" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-[#909090] sm:inline">{hint(step, mix, total)}</span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" iconRight="arrow-right" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Next
              </Button>
            ) : (
              <Button variant="primary" iconRight="arrow-right" onClick={finish} disabled={!canNext}>
                Continue to create vault
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function hint(step: number, mix: Slice[], total: number) {
  if (step === 0) return mix.length < 2 ? `Pick at least ${2 - mix.length} more` : `${mix.length} picked`;
  if (step === 1) return total === 100 ? (mix.some((s) => s.weight === 0) ? "Give each one at least 1%" : "Adds up to 100%") : `${total}% of 100%`;
  return "";
}

/* ───────────── Step 1: pick ───────────── */

function PickStep({ mix, setMix, onDraft }: { mix: Slice[]; setMix: (m: Slice[]) => void; onDraft: (d: { name: string; mix: Slice[]; rules: Guardrails }) => void }) {
  const { quote } = useMarket();
  const h = useHistory(365);
  // An earning version counts as its base here: you pick "NEAR", then choose to earn on it in the next step.
  const picked = (id: LogoId) => mix.some((s) => baseOf(s.id) === id);
  const toggle = (id: LogoId) => setMix(evenly(picked(id) ? mix.filter((s) => baseOf(s.id) !== id) : [...mix, slice(id, 0)]));

  return (
    <>
      <h2 className="text-[24px] tracking-[-0.04em]">What do you want to hold?</h2>
      <p className="mt-1 text-[15px] text-[#909090]">Pick two or more. Mixing things that move differently, like Bitcoin and gold, smooths out the ride.</p>

      <div className="mt-5">
        <AiPlanner onUse={onDraft} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-[#909090]">Or start from:</span>
        {PLAN_DATA.filter((p) => !p.comingSoon).map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => setMix(p.mix)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[#f5f5f7] pr-3 pl-1 text-[13px] hover:bg-[#ececef]"
          >
            <span className="flex -space-x-1.5">
              {p.mix.map((s) => (
                <Logo key={s.id} id={s.id} size={22} className="ring-2 ring-[#f5f5f7]" />
              ))}
            </span>
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {ASSETS.filter((a) => !a.earn).map((a) => {
          const on = picked(a.id);
          const q = quote(a.id);
          const p = h?.prices[a.id];
          const yr = p && p.length > 1 ? (p[p.length - 1] / p[0] - 1) * 100 : null;
          return (
            <button
              key={a.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={!a.live}
              onClick={() => toggle(a.id)}
              className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl p-3.5 text-left transition-[background-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"
              }`}
            >
              <Logo id={a.id} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] tracking-[-0.02em]">{a.name}</span>
                  <span className="text-[12px] text-[#909090]">{a.kind}</span>
                </div>
                <p className="truncate text-[13px] text-[#909090]">{a.blurb}</p>
              </div>
              {a.live ? (
                <div className="shrink-0 text-right">
                  <div className="text-[13px] tabular-nums">{fmtPrice(q.price)}</div>
                  <div className="text-[11px] text-[#909090]">
                    1y <Change value={a.id === "usdc" ? 0 : yr} className="text-[11px]" />
                  </div>
                </div>
              ) : (
                <Badge>Soon</Badge>
              )}
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${on ? "bg-black text-white" : "ring-1 ring-inset ring-black/15"}`}>
                {on && <Icon name="check" size={14} />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ───────────── Step 2: amounts ───────────── */

/** Split 100 evenly, keeping order. */
function evenly(m: Slice[]): Slice[] {
  if (!m.length) return m;
  const base = Math.floor(100 / m.length);
  return m.map((s, i) => ({ ...s, weight: base + (i < 100 - base * m.length ? 1 : 0) }));
}

/** Set one share and move the others proportionally, so the total always stays 100. */
function rebalance(m: Slice[], id: LogoId, v: number): Slice[] {
  const target = Math.max(1, Math.min(100 - (m.length - 1), Math.round(v)));
  const others = m.filter((s) => s.id !== id);
  const rest = 100 - target;
  const otherSum = others.reduce((a, s) => a + s.weight, 0);
  // Proportional split with a 1% floor, then hand rounding leftovers to the largest.
  const raw = others.map((s) => Math.max(1, otherSum > 0 ? (s.weight / otherSum) * rest : rest / others.length));
  const floored = raw.map(Math.floor);
  let left = rest - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left !== 0 && j < order.length * 4; j++) {
    const i = order[j % order.length][1];
    if (left > 0) {
      floored[i]++;
      left--;
    } else if (floored[i] > 1) {
      floored[i]--;
      left++;
    }
  }
  let o = 0;
  return m.map((s) => (s.id === id ? { ...s, weight: target } : { ...s, weight: floored[o++] }));
}

function AmountStep({ mix, setMix }: { mix: Slice[]; setMix: (m: Slice[]) => void }) {
  const h = useHistory(365);
  const yields = useYields();
  const setEarn = (id: LogoId, on: boolean) => {
    const base = baseOf(id);
    const next = on ? earnVersionOf(base)?.id : base;
    if (next) setMix(mix.map((s) => (s.id === id ? slice(next, s.weight) : s)));
  };
  const earning = mix.filter((s) => assetById(s.id).earn);
  const blended = earning.reduce((a, s) => a + (s.weight / 100) * (yields[s.id as keyof typeof yields]?.apy ?? 0), 0);
  const series = useMemo(() => (h ? backtest(h, mix) : []), [h, mix]);
  const ret = series.length > 1 ? (series[series.length - 1] / series[0] - 1) * 100 : null;
  const drawdown = useMemo(() => {
    let peak = 0;
    let worst = 0;
    for (const v of series) {
      peak = Math.max(peak, v);
      worst = Math.min(worst, (v / peak - 1) * 100);
    }
    return series.length ? worst : null;
  }, [series]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] tracking-[-0.04em]">How much of each?</h2>
          <p className="mt-1 text-[15px] text-[#909090]">Drag a slider and the others adjust, so it always adds up to 100%.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setMix(evenly(mix))}>
          Split evenly
        </Button>
      </div>

      <ul className="mt-5 space-y-2">
        {mix.map((s) => {
          const a = assetById(s.id);
          const earnAsset = a.earn ? a : earnVersionOf(s.id);
          const y = earnAsset ? yields[earnAsset.id as keyof typeof yields] : undefined;
          return (
            <li key={s.id} className="rounded-2xl bg-[#f5f5f7] px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Logo id={s.id} size={32} />
                <span className="w-28 text-[15px] tracking-[-0.02em]">{a.name}</span>
                <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
                  <Slider value={s.weight} min={1} max={100 - (mix.length - 1)} onChange={(v) => setMix(rebalance(mix, s.id, v))} color={s.color} label={`${a.name} share`} />
                </div>
                <span className="ml-auto w-14 text-right text-[22px] tracking-[-0.04em] tabular-nums sm:ml-0">{s.weight}%</span>
              </div>
              {earnAsset && (
                <div className="mt-3 flex items-center gap-3 border-t border-black/[0.06] pt-3">
                  <Switch checked={!!a.earn} onChange={(on) => setEarn(s.id, on)} label={`Earn on ${assetById(earnAsset.earn!.base).name}`} />
                  <div className="min-w-0 flex-1 text-[13px] leading-5">
                    <span className="text-black">
                      Earn {y ? `${y.apy.toFixed(1)}% a year` : "a yield"}
                    </span>{" "}
                    <span className="text-[#909090]">
                      as {earnAsset.ticker}: {earnAsset.earn!.how}, via {earnAsset.earn!.issuer}.
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <MixBar slices={mix} className="mt-5 h-2" />
      {earning.length > 0 && (
        <p className="mt-3 text-[13px] leading-5 text-[#909090]">
          <span className="text-black">About {blended.toFixed(2)}% a year from yield across the plan</span>, on top of price moves. Earning versions cost
          about 1–2% to switch in and back out, so they pay off when you hold for a few months. Yields change daily; each comes from the protocol&apos;s own API.
        </p>
      )}

      <div className="mt-6 grid gap-3 rounded-2xl bg-[#f5f5f7] p-4 sm:grid-cols-[200px_1fr] sm:items-center">
        <div>
          <div className="text-[13px] text-[#909090]">$1,000 in this mix a year ago</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-[26px] tracking-[-0.05em] tabular-nums">{series.length ? usd(series[series.length - 1], 0) : "–"}</span>
            <Change value={ret} className="text-[13px]" />
          </div>
          <div className="mt-1 text-[12px] text-[#909090]">Worst fall along the way: {drawdown === null ? "–" : `${drawdown.toFixed(1)}%`}</div>
        </div>
        <ValueChart data={series} dates={h?.dates} height={90} />
      </div>
      <p className="mt-2 text-[11px] text-black/35">
        Real daily closing prices, rebalanced daily, before swap costs.{earning.length > 0 && " Earning versions are estimated from their base asset's prices plus today's yield."} Past returns don&apos;t
        predict future ones.
      </p>
    </>
  );
}

/* ───────────── Step 3: rules ───────────── */

const PRESETS: { id: string; label: string; text: string; g: Guardrails }[] = [
  { id: "relaxed", label: "Relaxed", text: "Trades rarely. Lets things drift further before stepping in.", g: { driftBand: 10, maxTradePct: 15, slippageBps: 150, tradesPerDay: 2 } },
  { id: "balanced", label: "Balanced", text: "The default. A good fit for most plans.", g: DEFAULT_GUARDRAILS },
  { id: "tight", label: "Tight", text: "Stays close to your shares. Trades more often, in smaller steps.", g: { driftBand: 3, maxTradePct: 5, slippageBps: 75, tradesPerDay: 6 } },
];

const RULES: { key: keyof Guardrails; label: string; help: (v: number) => string; min: number; max: number; step: number; show: (v: number) => string }[] = [
  { key: "driftBand", label: "When Kite steps in", help: (v) => `Say Bitcoin should be 50%. Kite waits until it's below ${50 - v}% or above ${50 + v}% before trading.`, min: 2, max: 20, step: 1, show: (v) => `${v} pts off` },
  { key: "maxTradePct", label: "Biggest single trade", help: (v) => `No one swap moves more than ${v}% of your money. Bigger fixes happen over several days.`, min: 1, max: 50, step: 1, show: (v) => `${v}%` },
  { key: "slippageBps", label: "Worst price accepted", help: (v) => `If a swap would hand back less than ${(100 - v / 100).toFixed(2)}% of what goes in, fees included, the vault refuses it.`, min: 10, max: 300, step: 10, show: (v) => `${(v / 100).toFixed(2)}%` },
  { key: "tradesPerDay", label: "Trades per day", help: (v) => `At most ${v} trade${v === 1 ? "" : "s"} a day, however wild the market gets.`, min: 1, max: 12, step: 1, show: (v) => `${v}` },
];

function RulesStep({ rules, setRules }: { rules: Guardrails; setRules: (g: Guardrails) => void }) {
  const [custom, setCustom] = useState(!PRESETS.some((p) => same(p.g, rules)));
  return (
    <>
      <h2 className="text-[24px] tracking-[-0.04em]">How hands-on should Kite be?</h2>
      <p className="mt-1 text-[15px] text-[#909090]">
        Prices move, so your shares drift. These rules decide when Kite swaps them back. They&apos;re written into your vault, and Kite can&apos;t change them.
      </p>

      <div role="radiogroup" aria-label="Rule presets" className="mt-5 grid gap-2 sm:grid-cols-3">
        {PRESETS.map((p) => {
          const on = !custom && same(p.g, rules);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setRules(p.g);
                setCustom(false);
              }}
              className={`cursor-pointer rounded-2xl p-4 text-left transition-[background-color,box-shadow] ${on ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"}`}
            >
              <div className="text-[15px] tracking-[-0.02em]">{p.label}</div>
              <p className="mt-1 text-[13px] leading-5 text-[#909090]">{p.text}</p>
              <p className="mt-2 text-[12px] text-black/45">Steps in at {p.g.driftBand} pts</p>
            </button>
          );
        })}
      </div>

      <button type="button" onClick={() => setCustom(!custom)} className="mt-5 flex cursor-pointer items-center gap-1.5 text-[14px] text-black/60 hover:text-black" aria-expanded={custom}>
        <Icon name="chevron-down" size={16} className={`transition-transform ${custom ? "rotate-180" : ""}`} />
        Fine-tune each rule
      </button>

      {custom && (
        <ul className="mt-3 space-y-2">
          {RULES.map((f) => {
            const v = rules[f.key];
            return (
              <li key={f.key} className="rounded-2xl bg-[#f5f5f7] px-4 py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[15px] tracking-[-0.02em]">{f.label}</span>
                  <span className="text-[18px] tracking-[-0.03em] tabular-nums">{f.show(v)}</span>
                </div>
                <div className="mt-2.5">
                  <Slider value={v} min={f.min} max={f.max} step={f.step} onChange={(n) => setRules({ ...rules, [f.key]: n })} label={f.label} color="#8cc6f6" />
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#909090]">{f.help(v)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

const same = (a: Guardrails, b: Guardrails) => (Object.keys(a) as (keyof Guardrails)[]).every((key) => a[key] === b[key]);

/* ───────────── Step 4: name and review ───────────── */

function ReviewStep({ name, setName, mix, rules }: { name: string; setName: (v: string) => void; mix: Slice[]; rules: Guardrails }) {
  return (
    <>
      <h2 className="text-[24px] tracking-[-0.04em]">Name it and check it over</h2>
      <label className="mt-5 block">
        <span className="text-[13px] text-[#909090]">Plan name</span>
        <div className="mt-1.5 rounded-2xl bg-[#f5f5f7] px-4 ring-[#5aa8f5] transition-shadow focus-within:ring-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Rainy day fund"
            className="h-14 w-full bg-transparent text-[22px] tracking-[-0.03em] placeholder:text-black/25"
          />
        </div>
      </label>

      <div className="mt-6 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <Donut slices={mix} size={120} thickness={9} />
        <ul className="space-y-2">
          {mix.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-[15px]">
              <Logo id={s.id} size={26} />
              {assetById(s.id).name}
              <span className="ml-auto tabular-nums">{s.weight}%</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="mt-6 divide-y divide-black/[0.06] rounded-2xl bg-[#f5f5f7] px-4 text-[14px]">
        {[
          ["Checked", "Every day at 00:00 UTC"],
          ["Kite steps in", `When a holding is ${rules.driftBand} pts off its share`],
          ["Biggest trade", `${rules.maxTradePct}% of your money`],
          ["Worst price", `Swaps may cost up to ${(rules.slippageBps / 100).toFixed(2)}%, fees included${mix.some((s) => assetById(s.id).earn) ? " (2% for earning versions)" : ""}`],
          ["Trades per day", `Up to ${rules.tradesPerDay}`],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between gap-4 py-3">
            <dt className="text-[#909090]">{l}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] leading-5 text-[#909090]">Next you&apos;ll see exactly what your wallet will sign to create the vault. You can change the rules later in Guardrails.</p>
    </>
  );
}

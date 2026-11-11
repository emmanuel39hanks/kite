"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo, logoName } from "@/components/logo";
import { Donut, MixBar } from "@/components/charts";
import { PLAN_DATA, type PlanData } from "@/lib/plans";

type Plan = PlanData & { art: ReactNode };

const ART: Record<string, ReactNode> = {
  "bitcoin-plus": <KiteArt />,
  "tech-and-crypto": <EnginesArt />,
  steady: <ScaleArt />,
};

const PLANS: Plan[] = PLAN_DATA.map((p) => ({ ...p, art: ART[p.slug] }));

export function Plans() {
  const [open, setOpen] = useState<Plan | null>(null);

  return (
    <section id="plans" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[640px]">
            <h2 className="text-[38px] leading-[1] font-medium tracking-[var(--tracking-display)] sm:text-[56px]">
              Start with a plan
            </h2>
            <p className="mt-4 text-[18px] leading-[1.45] text-black/60 sm:text-[20px]">
              Use one as it is, or change the numbers until it fits you. Tap a plan to see how it works.
            </p>
          </div>
          <a href="/console/create" className="rounded-lg border border-black/15 px-4 py-2.5 text-[15px] font-medium hover:bg-black/[0.03]">
            Build your own
          </a>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <article
              key={p.name}
              className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_18px_40px_-24px_rgba(0,0,0,0.3)] transition-shadow hover:shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_24px_48px_-24px_rgba(0,0,0,0.35)]"
            >
              <button
                type="button"
                onClick={() => setOpen(p)}
                className="flex flex-1 cursor-pointer flex-col text-left focus-visible:rounded-t-2xl"
                aria-haspopup="dialog"
              >
                <div className="relative flex aspect-[16/10] w-full items-end justify-between gap-4 overflow-hidden bg-cloud p-5">
                  <div className="min-w-0">
                    <div className="flex -space-x-2">
                      {p.mix.map((s) => (
                        <Logo key={s.id} id={s.id} size={30} className="ring-2 ring-cloud" />
                      ))}
                    </div>
                    <h3 className="mt-4 text-[28px] leading-[1.05] font-medium tracking-[var(--tracking-tight)]">{p.name}</h3>
                  </div>
                  <div className="shrink-0 self-center transition-transform duration-500 group-hover:rotate-[8deg]">
                    <Donut slices={p.mix} size={120} thickness={7} />
                  </div>
                </div>
                <div className="flex w-full flex-1 flex-col px-5 pt-5">
                  <p className="text-[16px] text-black/65">{p.who}</p>
                  <MixBar slices={p.mix} className="mt-5 h-2" />
                  <ul className="mt-4 flex-1 space-y-2.5">
                    {p.mix.map((s) => (
                      <li key={s.id} className="flex items-center gap-2.5 text-[15px]">
                        <Logo id={s.id} size={24} />
                        {logoName(s.id)}
                        <span className="ml-auto text-black/50 tabular-nums">{s.weight}%</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-5 inline-flex items-center gap-1 text-[14px] font-medium text-black/55 group-hover:text-black">
                    How this plan works
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                  </span>
                </div>
              </button>
              <div className="p-5 pt-4">
                {p.comingSoon ? (
                  <span className="block rounded-lg bg-black/[0.06] px-4 py-2.5 text-center text-[15px] font-medium text-black/50">
                    Stocks coming soon
                  </span>
                ) : (
                  <a
                    href={`/console/start/${p.slug}`}
                    className="block rounded-lg bg-black px-4 py-2.5 text-center text-[15px] font-medium text-white hover:bg-black/80"
                  >
                    Use this plan
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <PlanDialog plan={open} onClose={() => setOpen(null)} />
    </section>
  );
}


/* ─────────────── The plan explainer ─────────────── */

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Native <dialog> gives us the backdrop, Esc to close and focus trapping for free.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (plan && !d.open) d.showModal();
    if (!plan && d.open) d.close();
  }, [plan]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="plan-dialog m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[620px] overflow-y-auto rounded-2xl bg-white p-0 text-ink"
      aria-label={plan ? `${plan.name} plan` : undefined}
    >
      {plan && (
        <div>
          <div className="relative bg-cloud px-6 pt-6 pb-4 sm:px-8 sm:pt-8">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-black/50 hover:bg-black/5 hover:text-black"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <div className="text-[13px] font-medium text-black/45">Ready-made plan</div>
            <h3 className="mt-1 text-[32px] leading-none font-medium tracking-[var(--tracking-tight)]">{plan.name}</h3>
            <p className="mt-3 max-w-[46ch] text-[16px] leading-[1.45] text-black/65">{plan.idea}</p>
            <div className="mt-4">{plan.art}</div>
          </div>

          <div className="px-6 py-6 sm:px-8">
            <h4 className="text-[13px] font-medium text-black/45">What&apos;s inside, and why</h4>
            <MixBar slices={plan.mix} className="mt-3 h-2" />
            <ul className="mt-3 divide-y divide-line">
              {plan.mix.map((s) => (
                <li key={s.id} className="flex items-start gap-3 py-3">
                  <Logo id={s.id} size={30} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-medium">{logoName(s.id)}</span>
                      <span className="text-[15px] text-black/50 tabular-nums">{s.weight}%</span>
                    </div>
                    <p className="text-[14px] leading-[1.4] text-black/55">{plan.why[s.id]}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-cloud p-4">
                <h4 className="text-[13px] font-medium text-black/45">How Kite looks after it</h4>
                <DriftArt color={plan.mix[0].color} />
                <p className="mt-2 text-[14px] leading-[1.4] text-black/60">
                  Checked every hour. If a part drifts 5 points from its target, Kite trades it back.
                </p>
              </div>
              <div className="rounded-xl bg-cloud p-4">
                <h4 className="text-[13px] font-medium text-black/45">Ups and downs</h4>
                <SwingMeter level={plan.swings} />
                <p className="mt-2 text-[14px] leading-[1.4] text-black/60">{plan.goodFor}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {plan.comingSoon ? (
                <span className="rounded-lg bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-black/50">Stocks coming soon</span>
              ) : (
                <a
                  href={`/console/start/${plan.slug}`}
                  onClick={onClose}
                  className="rounded-lg bg-black px-5 py-2.5 text-[15px] font-medium text-white hover:bg-black/80"
                >
                  Use this plan
                </a>
              )}
              <span className="text-[13px] text-black/45">You can change any number before you start.</span>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

/* ─────────────── 2D illustrations ─────────────── */

const INK = "#0B0B0F";
const LINE = "#D9DDE3";

/** A line that wobbles inside a ±5 band, hits the edge, and is pulled back to target. */
function DriftArt({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 92" className="mt-3 w-full" role="img" aria-label="A share drifting from its target and being brought back">
      <rect x="0" y="18" width="240" height="44" rx="6" fill="#fff" />
      <line x1="0" y1="40" x2="240" y2="40" stroke={LINE} strokeDasharray="3 4" />
      <text x="6" y="13" fontSize="9" fill="#8C9199">+5 pts</text>
      <text x="6" y="76" fontSize="9" fill="#8C9199">−5 pts</text>
      <text x="200" y="37" fontSize="9" fill="#8C9199">target</text>
      <path
        d="M0 40 C 20 34, 34 46, 52 38 S 84 30, 100 31 S 128 22, 146 18"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M146 18 C 152 30, 156 38, 164 40 S 200 44, 240 40" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="146" cy="18" r="9" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <path d="M142.5 18.5l2.5 2.5 4.5-5" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="146" y="90" fontSize="9" fill={INK} textAnchor="middle" fontWeight="600">Kite rebalances</text>
    </svg>
  );
}

function SwingMeter({ level }: { level: 1 | 2 | 3 }) {
  const labels = ["Calmer", "Medium", "Bigger swings"];
  return (
    <div className="mt-3">
      <svg viewBox="0 0 240 40" className="w-full" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const amp = 4 + i * 6;
          const x = i * 82;
          return (
            <g key={i} transform={`translate(${x} 0)`}>
              <rect width="76" height="40" rx="8" fill={i < level ? "#fff" : "transparent"} stroke={i < level ? "none" : LINE} />
              <path
                d={`M8 20 q 7.5 ${-amp} 15 0 t 15 0 t 15 0 t 15 0`}
                fill="none"
                stroke={i < level ? INK : "#C5CAD1"}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 text-[14px] font-medium">{labels[level - 1]}</div>
    </div>
  );
}

function ArtFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 560 170" className="w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** Bitcoin Plus: a Bitcoin kite flying high, its string tied to a gold bar. */
function KiteArt() {
  return (
    <ArtFrame label="A Bitcoin kite flying, its string anchored to a gold bar">
      <path d="M20 150 H540" stroke={LINE} strokeWidth="1.5" />
      {/* string from the gold bar up to the kite */}
      <path d="M128 132 C 220 110, 300 80, 368 52" fill="none" stroke={INK} strokeWidth="1.4" strokeDasharray="1 0" />
      {/* gold bar */}
      <path d="M92 150 l10 -22 h52 l10 22 z" fill="#D4A537" />
      <path d="M102 128 h52 l-4 7 h-44 z" fill="#E7C463" />
      <text x="128" y="146" fontSize="11" fontWeight="700" fill="#7A5A10" textAnchor="middle">GOLD</text>
      {/* kite */}
      <g transform="translate(400 46) rotate(-12)">
        <path d="M0 -40 L30 0 L0 46 L-30 0 Z" fill="#F7931A" />
        <path d="M0 -40 L0 46 M-30 0 L30 0" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.5" />
        <text x="0" y="6" fontSize="22" fontWeight="700" fill="#fff" textAnchor="middle">₿</text>
        <path d="M0 46 C 10 66, -12 76, 2 96 S -6 120, 6 132" fill="none" stroke="#F7931A" strokeWidth="1.6" />
        <path d="M2 70 l-8 4 l8 3 z M0 98 l8 3 l-8 4 z" fill="#F7931A" />
      </g>
      {/* a smaller Ethereum kite alongside */}
      <g transform="translate(486 92) rotate(8)">
        <path d="M0 -20 L15 0 L0 23 L-15 0 Z" fill="#627EEA" />
        <path d="M0 23 C 6 34, -6 40, 2 52" fill="none" stroke="#627EEA" strokeWidth="1.3" />
      </g>
      <path d="M128 132 C 260 120, 400 120, 486 114" fill="none" stroke={INK} strokeOpacity="0.35" strokeWidth="1" />
      <Label x={178} y={40} text="Bitcoin does the flying" />
      <Label x={36} y={110} text="Gold holds the string" />
    </ArtFrame>
  );
}

/** Tech and Crypto: two engines, chips and coins, feeding one plan. */
function EnginesArt() {
  return (
    <ArtFrame label="Two engines, stocks and crypto, feeding one plan">
      {/* chip */}
      <g transform="translate(70 30)">
        <rect x="14" y="14" width="92" height="92" rx="14" fill="#fff" stroke={INK} strokeWidth="1.6" />
        <rect x="38" y="38" width="44" height="44" rx="8" fill="#76B900" />
        {[30, 50, 70, 90].map((p) => (
          <g key={p} stroke={INK} strokeWidth="1.6" strokeLinecap="round">
            <path d={`M${p} 0 v14 M${p} 106 v14 M0 ${p} h14 M106 ${p} h14`} />
          </g>
        ))}
      </g>
      {/* coins */}
      <g transform="translate(400 40)">
        <circle cx="40" cy="58" r="38" fill="#F7931A" />
        <text x="40" y="70" fontSize="34" fontWeight="700" fill="#fff" textAnchor="middle">₿</text>
        <circle cx="96" cy="30" r="26" fill="#627EEA" />
        <path d="M96 12 l11 19 -11 6 -11 -6 z M96 40 l11 -6 -11 15 -11 -15 z" fill="#fff" />
      </g>
      {/* both feed the centre */}
      <path d="M196 90 C 230 90, 240 100, 268 100" fill="none" stroke={INK} strokeWidth="1.4" />
      <path d="M394 100 C 360 100, 330 100, 292 100" fill="none" stroke={INK} strokeWidth="1.4" />
      <circle cx="280" cy="100" r="22" fill={INK} />
      <path d="M280 88 l9 12 -9 12 -9 -12 z" fill="#FFB020" />
      <Label x={58} y={160} text="Stocks: Nvidia, Apple, Tesla" />
      <Label x={380} y={160} text="Crypto: Bitcoin, Ethereum" />
    </ArtFrame>
  );
}

/** Steady: a level balance, gold on one side, Bitcoin and dollars on the other. */
function ScaleArt() {
  return (
    <ArtFrame label="A level balance with gold on one side and Bitcoin and dollars on the other">
      <path d="M280 40 V150 M240 150 h80" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M150 50 H410" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="280" cy="48" r="6" fill={INK} />
      {/* left pan: gold */}
      <path d="M150 50 l-40 52 M150 50 l40 52" stroke={INK} strokeWidth="1.2" />
      <path d="M100 102 h100 a50 14 0 0 1 -100 0 z" fill="#fff" stroke={INK} strokeWidth="1.4" />
      <path d="M118 102 l6 -14 h32 l6 14 z M138 88 l6 -14 h32 l6 14 z" fill="#D4A537" />
      <path d="M150 102 l6 -14 h28 l6 14 z" fill="#E1B54A" />
      {/* right pan: bitcoin + dollars */}
      <path d="M410 50 l-40 52 M410 50 l40 52" stroke={INK} strokeWidth="1.2" />
      <path d="M360 102 h100 a50 14 0 0 1 -100 0 z" fill="#fff" stroke={INK} strokeWidth="1.4" />
      <circle cx="390" cy="86" r="16" fill="#F7931A" />
      <text x="390" y="93" fontSize="18" fontWeight="700" fill="#fff" textAnchor="middle">₿</text>
      <circle cx="428" cy="86" r="16" fill="#2775CA" />
      <text x="428" y="93" fontSize="18" fontWeight="700" fill="#fff" textAnchor="middle">$</text>
      <Label x={96} y={30} text="50% gold" />
      <Label x={352} y={30} text="25% Bitcoin · 25% dollars" />
    </ArtFrame>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} fontSize="13" fontWeight="500" fill="#5B6068">
      {text}
    </text>
  );
}

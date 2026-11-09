/**
 * Scene 9: the closing line, then the console builds itself around the viewer: top bar, sidebar, then Home's cards,
 * laid out as the real console lays them out at 1920×1080. It holds still at the end so the edit can cut to the
 * screen recording of the live console.
 */
import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { Donut } from "@/components/charts";
import { Wordmark } from "@/components/kite-mark";
import { Avatar, Badge, Button, Card } from "@/components/console/ui";
import { Icon, type IconName } from "@/components/console/icons";
import { ValueChart } from "@/components/console/value-chart";
import { Line, Paper, mix, s, tween } from "../motion";

export const CONSOLE_DUR = s(5.8);

const NAV: [string, IconName][] = [
  ["Home", "home"],
  ["Explore", "compass"],
  ["Earn", "up"],
  ["Create", "notepad"],
  ["DAO", "dao"],
  ["Activity", "list"],
];

// A gently rising year, ending at the vault's value.
const SERIES = Array.from({ length: 60 }, (_, i) => 1000 + i * 6.2 + Math.sin(i / 3.2) * 38 + Math.sin(i / 1.3) * 12);
const LAST = SERIES[SERIES.length - 1];
const MIX = [
  { id: "btc" as const, weight: 50, color: "#F7931A" },
  { id: "stnear" as const, weight: 50, color: "#00C08B" },
];

export function Console() {
  const f = useCurrentFrame();
  const lineGone = tween(f, s(2.0), s(2.4));
  const at = (sec: number) => tween(f, s(sec), s(sec + 0.7));
  const top = at(2.1);
  const side = at(2.3);
  const slot = (sec: number, children: ReactNode, className = "") => {
    const p = at(sec);
    return (
      <div className={className} style={{ opacity: p, transform: `translateY(${26 * (1 - p)}px)` }}>
        {children}
      </div>
    );
  };
  return (
    <Paper>
      <div className="absolute inset-0 grid place-items-center" style={{ opacity: 1 - lineGone, filter: lineGone ? `blur(${8 * lineGone}px)` : undefined }}>
        <Line text="You hold the string." at={s(0.2)} size={110} />
      </div>

      {/* Top bar */}
      <header
        className="absolute inset-x-0 top-0 flex h-[80px] items-center justify-between border-b border-black/[0.06] bg-[#fcfcfd] pr-3.5 pl-7"
        style={{ transform: `translateY(${-80 * (1 - top)}px)`, opacity: top }}
      >
        <Wordmark className="text-[28px]" />
        <div className="absolute left-1/2 flex h-12 w-[400px] -translate-x-1/2 items-center gap-3 rounded-full bg-[#f5f5f7] px-4 text-[15px] text-black/45 ring-1 ring-inset ring-black/[0.06]">
          <Icon name="search" size={18} /> Search assets and plans…
          <span className="ml-auto text-[13px]">⌘K</span>
        </div>
        <div className="flex items-center gap-2.5 rounded-full py-1.5 pr-3 pl-1.5 text-[15px]">
          <Avatar seed="you.near" size={36} /> you.near
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className="absolute top-[80px] bottom-0 left-0 flex w-[288px] flex-col border-r border-black/[0.06] p-4"
        style={{ transform: `translateX(${-288 * (1 - side)}px)`, opacity: side }}
      >
        <nav className="flex flex-1 flex-col gap-1.5">
          {NAV.map(([label, icon], i) => (
            <div
              key={label}
              className={`flex h-12 items-center gap-3 rounded-full px-3 text-[16px] tracking-[-0.02em] ${i === 0 ? "text-black" : "text-black/[0.56]"}`}
            >
              <Icon name={icon} size={24} stroke={1.4} />
              {label}
            </div>
          ))}
        </nav>
        <div className="flex h-12 items-center gap-3 rounded-full px-3 text-[16px] text-black/[0.56]">
          <Icon name="shield" size={24} stroke={1.4} /> Guardrails
        </div>
      </aside>

      {/* Home */}
      <main className="absolute top-[80px] right-0 left-[288px] px-8">
        {slot(
          2.5,
          <div className="flex items-center justify-between pt-10 pb-8">
            <h1 className="text-[30px] leading-9 tracking-[-0.05em]">Bitcoin and staked NEAR</h1>
            <div className="flex gap-2.5">
              <Button icon="refresh">Check now</Button>
              <Button icon="withdraw">Withdraw</Button>
              <Button variant="primary" icon="deposit">
                Add money
              </Button>
            </div>
          </div>,
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
          {slot(
            2.65,
            <Card className="flex min-h-[342px] flex-col overflow-hidden pt-6">
              <div className="px-6">
                <div className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">Total value</div>
                <div className="text-[48px] leading-[56px] tracking-[-0.04em] tabular-nums">
                  ${mix(1000, LAST, at(2.8)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[14px] tracking-[-0.02em]">
                  <span className="text-[#05a800]">
                    +${(LAST - 1000).toFixed(2)} (+{((LAST - 1000) / 10).toFixed(2)}%)
                  </span>{" "}
                  <span className="text-[#6b6b6b]">past year</span>
                </div>
              </div>
              <div className="mt-auto pt-4" style={{ clipPath: `inset(0 ${100 - 100 * at(2.8)}% 0 0)` }}>
                <ValueChart data={SERIES} height={175} />
              </div>
            </Card>,
          )}
          <div className="grid gap-3">
            {slot(2.8, <Stat label="Plan health" aside={<Badge tone="green">On plan</Badge>} value="0.4" unit=" of 5 pts allowed drift" />)}
            {slot(2.9, <Stat label="Next check" aside={<Badge tone="green">Kite&apos;s key on</Badge>} value="06:12:40" unit="" />)}
            {slot(3.0, <Stat label="Earning" aside={<Badge tone="green">Staked NEAR</Badge>} value="+4.2%" unit=" a year on half your money" />)}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {slot(
            3.1,
            <Card className="flex items-center gap-5 p-5">
              <Donut slices={MIX} size={96} thickness={5} />
              <div className="text-[15px]">
                <div className="text-[16px]">Your mix</div>
                <div className="mt-1 text-[#6b6b6b]">Bitcoin 50% · Staked NEAR 50%</div>
              </div>
            </Card>,
          )}
          {slot(
            3.2,
            <Card className="p-5 text-[15px]">
              <div className="text-[16px]">Your rules</div>
              <div className="mt-1 text-[#6b6b6b]">Rebalances when anything drifts 5 points</div>
            </Card>,
          )}
          {slot(
            3.3,
            <Card className="p-5 text-[15px]">
              <div className="text-[16px]">Your vault</div>
              <div className="mt-1 text-[#6b6b6b]">Can withdraw: only you, any time</div>
            </Card>,
          )}
        </div>
      </main>
    </Paper>
  );
}

function Stat({ label, aside, value, unit }: { label: string; aside: ReactNode; value: string; unit: string }) {
  return (
    <Card className="flex min-h-[106px] flex-col justify-between gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] tracking-[-0.02em] text-[#6b6b6b]">{label}</span>
        {aside}
      </div>
      <div>
        <span className="text-[28px] leading-9 tracking-[-0.05em] tabular-nums">{value}</span>
        <span className="text-[14px] text-[#6b6b6b]">{unit}</span>
      </div>
    </Card>
  );
}

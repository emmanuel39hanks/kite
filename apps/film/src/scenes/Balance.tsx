/**
 * Scene 1 (15s): what "balanced" means, for someone who has never heard the word. $1,000, half Bitcoin, half gold.
 * Bitcoin goes up, the split tips, the fix is to sell a little and buy a little, and that is rebalancing.
 * The same two bars stay on screen the whole time, so the viewer watches one thing change.
 */
import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { CAM, Camera, Headline, Line, Paper, mix, s, tween, usd } from "../motion";

export const BALANCE_DUR = s(14.8);

const BTC = "#F7931A";
const GOLD = "#D4A537";
const BAR_MAX = 400; // px for $1,000
const COL = 280;
const GAP = 140;

export function Balance() {
  const f = useCurrentFrame();

  // Dollars in each, over time.
  const up = tween(f, s(3.9), s(5.4), CAM);
  const fix = tween(f, s(8.0), s(9.6), CAM);
  const btc = mix(mix(500, 900, up), 700, fix);
  const gold = mix(500, 700, fix);
  const total = btc + gold;
  const btcPct = Math.round((btc / total) * 100);

  // The $1,000 starts big in the middle, then shrinks into the total above the bars.
  const settle = tween(f, s(1.0), s(1.7), CAM);
  const bars = tween(f, s(1.3), s(2.1));

  const warn = tween(f, s(5.6), s(6.0)) * (1 - tween(f, s(7.8), s(8.1)));
  const good = tween(f, s(9.7), s(10.1));
  const chip = tween(f, s(8.0), s(9.5), CAM);
  const named = tween(f, s(11.2), s(11.8));

  // Bars stand on a baseline at y=820; the chip travels from Bitcoin's top to gold's.
  const BASE = 850;
  const left = 960 - COL - GAP / 2;
  const btcTop = BASE - (btc / 1000) * BAR_MAX * bars;
  const goldTop = BASE - (gold / 1000) * BAR_MAX * bars;

  return (
    <Paper>
      <Headline>
        <Line text="Say you put $1,000 in. Half Bitcoin, half gold." at={s(0.3)} out={s(3.5)} />
        <Line text="Bitcoin goes up. Now most of your money rides on it." at={s(3.7)} out={s(7.5)} />
        <Line text="The fix: sell a little Bitcoin, buy a little gold." at={s(7.7)} out={s(10.9)} />
        <Line text="That's called rebalancing." at={s(11.1)} out={s(14.4)} />
      </Headline>

      <Camera scale={1} focus={[left + COL / 2, 640]}>
        {/* The money: big in the middle at first, then the total above the bars. */}
        <div className="absolute inset-x-0 text-center" style={{ top: mix(420, 240, settle), opacity: tween(f, s(0.3), s(0.8)) }}>
          <div className="text-[30px] text-[#6b6b6b]" style={{ opacity: settle, height: 40 * settle }}>
            Total
          </div>
          <div className="leading-none tracking-[-0.05em] tabular-nums" style={{ fontSize: mix(170, 72, settle) }}>
            {usd(total)}
          </div>
        </div>

        <Column x={left} top={btcTop} dollars={btc} pct={btcPct} color={BTC} logo="btc" name="Bitcoin" show={bars}>
          {warn > 0 && (
            <div style={{ opacity: warn, transform: `scale(${mix(0.92, 1, warn)})` }}>
              <Pill>
                <Badge tone="amber">{btcPct}% in Bitcoin. You wanted 50%.</Badge>
              </Pill>
            </div>
          )}
          {good > 0 && (
            <div style={{ opacity: good }}>
              <Pill>
                <Badge tone="green">Half and half again</Badge>
              </Pill>
            </div>
          )}
        </Column>
        <Column x={left + COL + GAP} top={goldTop} dollars={gold} pct={100 - btcPct} color={GOLD} logo="xaut" name="Gold" show={bars} />

        {/* $200 moving from Bitcoin to gold, in an arc. */}
        {chip > 0 && chip < 1 && (
          <div
            className="absolute -translate-x-1/2 rounded-full bg-black px-6 py-3 text-[30px] text-white tabular-nums"
            style={{ left: mix(left + COL / 2, left + COL * 1.5 + GAP, chip), top: mix(btcTop, goldTop, chip) + 40 - 120 * Math.sin(Math.PI * chip) }}
          >
            $200
          </div>
        )}

        {/* The name for it. */}
        <div className="absolute inset-x-0 top-[1000px] flex justify-center" style={{ opacity: named, transform: `translateY(${10 * (1 - named)}px)` }}>
          <span className="flex items-center gap-3 rounded-full bg-[#8cc6f6]/30 px-6 py-2.5 text-[28px] tracking-[-0.02em] text-[#1f5a8f]">
            <Icon name="refresh" size={26} /> Rebalancing: putting your money back in the split you chose
          </span>
        </div>
      </Camera>
    </Paper>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="[&>span]:px-5 [&>span]:py-2 [&>span]:text-[24px] [&>span]:whitespace-nowrap">{children}</span>;
}

/** One holding: its share on top, the bar standing on the baseline, then its name and dollars underneath. */
function Column({
  x,
  top,
  dollars,
  pct,
  color,
  logo,
  name,
  show,
  children,
}: {
  x: number;
  top: number;
  dollars: number;
  pct: number;
  color: string;
  logo: "btc" | "xaut";
  name: string;
  show: number;
  children?: ReactNode;
}) {
  const BASE = 850;
  return (
    <div style={{ opacity: show }}>
      <div className="absolute flex flex-col items-center gap-3" style={{ left: x, width: COL, top: top - 64, transform: "translateY(-100%)" }}>
        {children}
      </div>
      <div className="absolute text-center text-[40px] font-medium tracking-[-0.03em] tabular-nums" style={{ left: x, width: COL, top: top - 58 }}>
        {pct}%
      </div>
      <div className="absolute rounded-2xl" style={{ left: x, width: COL, top, height: BASE - top, background: color }} />
      <div className="absolute flex items-center justify-center gap-3" style={{ left: x, width: COL, top: BASE + 22 }}>
        <Logo id={logo} size={44} />
        <span className="text-[32px] tracking-[-0.03em]">{name}</span>
      </div>
      <div className="absolute text-center text-[30px] text-[#6b6b6b] tabular-nums" style={{ left: x, width: COL, top: BASE + 76 }}>
        {usd(dollars)}
      </div>
    </div>
  );
}

"use client";

import { MixBar } from "@/components/charts";
import { Slider } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { assetById } from "@/lib/assets";
import { rebalance, type Slice } from "@/lib/mix";

/** New target shares for the same assets: one slider each, the others move so it stays 100%. Shows "now" when given. */
export function MixSliders({ mix, onChange, now, disabled }: { mix: Slice[]; onChange: (m: Slice[]) => void; now?: Record<string, number>; disabled?: boolean }) {
  return (
    <>
      <ul className="space-y-3">
        {mix.map((s) => {
          const a = assetById(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3">
              <Logo id={s.id} size={26} />
              <div className="w-[84px] shrink-0 leading-tight sm:w-[110px]">
                <div className="truncate text-[14px] tracking-[-0.02em]">{a.name}</div>
                {now && <div className="text-[12px] text-[#6b6b6b] tabular-nums">now {(now[s.id] ?? 0).toFixed(1)}%</div>}
              </div>
              <div className="min-w-0 flex-1">
                <Slider value={s.weight} min={1} max={100 - (mix.length - 1)} onChange={(v) => !disabled && onChange(rebalance(mix, s.id, v))} color={s.color} label={`${a.name} target share`} />
              </div>
              <span className="w-11 text-right text-[17px] tracking-[-0.03em] tabular-nums">{s.weight}%</span>
            </li>
          );
        })}
      </ul>
      <MixBar slices={mix} className="mt-4 h-1.5" />
    </>
  );
}

"use client";

import { MixBar } from "@/components/charts";
import { Icon } from "@/components/console/icons";
import { Button, Slider, Switch } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { ASSETS, assetById, baseOf, earnVersionOf, type LogoId } from "@/lib/assets";
import { evenly, MAX_ASSETS, rebalance, slice, type Slice } from "@/lib/mix";
import { useYields } from "@/lib/market/use-market";

/**
 * Build a mix by hand: pick two to eight assets, set each share (the others move so it stays 100%),
 * and switch an asset to its earning version where one exists. Compact, for a form that has other parts.
 */
export function MixBuilder({ mix, onChange, disabled }: { mix: Slice[]; onChange: (m: Slice[]) => void; disabled?: boolean }) {
  const yields = useYields();
  const full = mix.length >= MAX_ASSETS;
  const has = (id: LogoId) => mix.some((s) => baseOf(s.id) === id);
  const add = (id: LogoId) => !full && !has(id) && onChange(evenly([...mix, slice(id, 0)]));
  const remove = (id: LogoId) => onChange(evenly(mix.filter((s) => s.id !== id)));
  const setEarn = (id: LogoId, on: boolean) => {
    const next = on ? earnVersionOf(baseOf(id))?.id : baseOf(id);
    if (next) onChange(mix.map((s) => (s.id === id ? slice(next, s.weight) : s)));
  };
  const choices = ASSETS.filter((a) => !a.earn && a.live && !has(a.id));

  return (
    <div className="rounded-2xl bg-white p-3 shadow-[0_2px_2px_rgba(0,0,0,0.04)] sm:p-4">
      {mix.length > 0 ? (
        <ul className="space-y-1">
          {mix.map((s) => {
            const a = assetById(s.id);
            const earnAsset = a.earn ? a : earnVersionOf(s.id);
            const y = earnAsset ? yields[earnAsset.id as keyof typeof yields] : undefined;
            return (
              <li key={s.id} className="rounded-xl px-1 py-2">
                <div className="flex items-center gap-3">
                  <Logo id={s.id} size={28} />
                  <div className="w-[92px] shrink-0 leading-tight sm:w-[120px]">
                    <div className="truncate text-[14px] tracking-[-0.02em]">{a.name}</div>
                    <div className="text-[12px] text-[#6b6b6b]">{a.ticker}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Slider value={s.weight} min={1} max={Math.max(1, 100 - (mix.length - 1))} onChange={(v) => !disabled && mix.length > 1 && onChange(rebalance(mix, s.id, v))} color={s.color} label={`${a.name} share`} />
                  </div>
                  <span className="w-11 text-right text-[17px] tracking-[-0.03em] tabular-nums">{s.weight}%</span>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    disabled={disabled}
                    aria-label={`Remove ${a.name}`}
                    className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-black/40 hover:bg-black/[0.05] hover:text-black disabled:cursor-not-allowed"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                {earnAsset && (
                  <label className="mt-2 ml-10 flex items-center gap-2.5 text-[12px] leading-4 text-[#6b6b6b]">
                    <Switch checked={!!a.earn} onChange={(on) => setEarn(s.id, on)} label={`Earn on ${assetById(earnAsset.earn!.base).name}`} disabled={disabled} />
                    <span>
                      <span className="text-black">Earn {y ? `${y.apy.toFixed(1)}% a year` : "a yield"}</span> as {earnAsset.ticker}, via {earnAsset.earn!.issuer}
                    </span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-1 py-3 text-[14px] text-[#6b6b6b]">Nothing picked yet. Add two or more assets below.</p>
      )}

      <MixBar slices={mix} className="mt-2 h-1.5" />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-[#6b6b6b]">
          {full ? `${mix.length} assets, the most a vault can hold` : `Add up to ${MAX_ASSETS - mix.length} more`}
        </span>
        {mix.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(evenly(mix))} disabled={disabled}>
            Split evenly
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {choices.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => add(a.id)}
            disabled={disabled || full}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[#f5f5f7] pr-3 pl-1 text-[13px] transition-colors hover:bg-[#ececef] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Logo id={a.id} size={22} />
            {a.ticker}
            <Icon name="plus" size={12} className="text-black/40" />
          </button>
        ))}
      </div>
    </div>
  );
}

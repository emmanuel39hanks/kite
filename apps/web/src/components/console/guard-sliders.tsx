"use client";

import { GUARD_BOUNDS } from "@/lib/ai/guard-bounds";
import { DEFAULT_GUARDRAILS, type Guardrails } from "@/lib/store";
import { Slider } from "./ui";

type Field = {
  key: keyof Guardrails;
  label: string;
  help: (v: number) => string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
};

type FieldDef = Omit<Field, "min" | "max" | "step">;
const DEFS: FieldDef[] = [
  { key: "driftBand", label: "When Kite steps in", help: (v) => `Kite only trades when a holding is ${v} points or more away from its share.`, show: (v) => `${v} pts` },
  { key: "maxTradePct", label: "Biggest single trade", help: (v) => `No one swap can move more than ${v}% of your money.`, show: (v) => `${v}%` },
  { key: "slippageBps", label: "Worst price accepted", help: (v) => `If a swap would hand back less than ${(100 - v / 100).toFixed(2)}% of what goes in, fees included, the vault refuses it.`, show: (v) => `${(v / 100).toFixed(2)}%` },
  { key: "tradesPerDay", label: "Trades per day", help: (v) => `Kite can make at most ${v} trade${v === 1 ? "" : "s"} a day, however much prices move.`, show: (v) => `${v}` },
];
const FIELDS: Field[] = DEFS.map((f) => ({ ...f, ...GUARD_BOUNDS[f.key] }));

/** The four guardrail sliders, inside the bounds the app allows (GUARD_BOUNDS). */
export function GuardSliders({ value, onChange }: { value: Guardrails; onChange: (g: Guardrails) => void }) {
  return (
    <ul className="space-y-2">
      {FIELDS.map((f) => {
        const v = value[f.key];
        return (
          <li key={f.key} className="rounded-2xl bg-white px-5 py-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[16px] tracking-[-0.02em]">{f.label}</span>
              <span className="text-[22px] tracking-[-0.04em] tabular-nums">{f.show(v)}</span>
            </div>
            <div className="mt-3">
              <Slider value={v} min={f.min} max={f.max} step={f.step} onChange={(n) => onChange({ ...value, [f.key]: n })} label={f.label} color="#8cc6f6" />
            </div>
            <div className="mt-2 flex justify-between gap-4 text-[13px] text-[#6b6b6b]">
              <span>{f.help(v)}</span>
              {v !== DEFAULT_GUARDRAILS[f.key] && (
                <button type="button" onClick={() => onChange({ ...value, [f.key]: DEFAULT_GUARDRAILS[f.key] })} className="shrink-0 cursor-pointer hover:text-black">
                  Reset
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

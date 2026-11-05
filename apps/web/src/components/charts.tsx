import type { Slice } from "@/lib/mix";

export function MixBar({ slices, className = "h-2.5" }: { slices: Slice[]; className?: string }) {
  return (
    <div className={`flex w-full gap-[3px] overflow-hidden rounded-full ${className}`}>
      {slices.map((s) => (
        <div key={s.id} style={{ width: `${s.weight}%`, background: s.color }} />
      ))}
    </div>
  );
}

export function Donut({ slices, size = 132, thickness = 6 }: { slices: Slice[]; size?: number; thickness?: number }) {
  const r = 15.9155; // circumference of 100, so dash lengths read as percentages
  // Each arc starts where the previous ones end; 25 rotates the start to 12 o'clock.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, p) => sum + p.weight, 0));
  return (
    <svg viewBox="0 0 42 42" width={size} height={size} aria-hidden="true">
      <circle cx="21" cy="21" r={r} fill="none" stroke="#eef0f3" strokeWidth={thickness} />
      {slices.map((s, i) => (
        <circle
          key={s.id}
          cx="21"
          cy="21"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${Math.max(s.weight - 1, 0)} ${101 - s.weight}`}
          strokeDashoffset={25 - starts[i]}
        />
      ))}
    </svg>
  );
}

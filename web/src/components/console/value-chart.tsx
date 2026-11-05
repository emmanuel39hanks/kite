"use client";

import { useId, useMemo, useRef, useState } from "react";

const W = 800;

/** Smooth area chart with a hover crosshair. `dates` are ms timestamps aligned with `data`. */
export function ValueChart({
  data,
  dates,
  height = 180,
  format = (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD" }),
  flatColor = "#5aa8f5",
}: {
  data: number[];
  dates?: number[];
  height?: number;
  format?: (v: number) => string;
  flatColor?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = height;

  const { pts, path, area, color } = useMemo(() => {
    if (data.length < 2) {
      const y = H / 2;
      return { pts: [] as [number, number][], path: `M0 ${y} L${W} ${y}`, area: `M0 ${y} L${W} ${y} L${W} ${H} L0 ${H} Z`, color: flatColor };
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * W, 14 + (1 - (v - min) / span) * (H - 28)] as [number, number]);
    // Catmull-Rom → cubic Bézier for a gentle curve.
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)},${c2[0].toFixed(1)} ${c2[1].toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    const up = data[data.length - 1] >= data[0];
    return { pts, path: d, area: `${d} L${W} ${H} L0 ${H} Z`, color: up ? "#22c55e" : "#ef4444" };
  }, [data, H, flatColor]);

  const onMove = (e: React.PointerEvent) => {
    if (!ref.current || pts.length < 2) return;
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round((x / W) * (pts.length - 1)))));
  };

  const hp = hover !== null ? pts[hover] : null;
  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full touch-none select-none"
        style={{ height: H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Value over time"
      >
        <defs>
          <linearGradient id={`g-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#g-${id})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={hp[0]} x2={hp[0]} y1={0} y2={H} stroke="rgba(0,0,0,0.15)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hp && hover !== null && (
        <>
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${(hp[0] / W) * 100}%`, top: hp[1], background: color }}
          />
          <div
            className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg bg-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_6px_16px_rgba(0,0,0,0.1)]"
            style={{ left: `${Math.min(88, Math.max(12, (hp[0] / W) * 100))}%` }}
          >
            <div className="tabular-nums">{format(data[hover])}</div>
            {dates?.[hover] && <div className="text-[#6b6b6b]">{new Date(dates[hover]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>}
          </div>
        </>
      )}
    </div>
  );
}

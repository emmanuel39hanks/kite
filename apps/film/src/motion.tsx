/**
 * The film's motion tokens and the few primitives every scene shares. Everything is driven by the frame number, so
 * each frame renders the same way every time (no CSS transitions, no timers).
 */
import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

export const FPS = 60;
export const W = 1920;
export const H = 1080;

/** Seconds to frames. */
export const s = (sec: number) => Math.round(sec * FPS);

/** Entrances: a strong ease-out. Camera: an in-out that starts and lands softly. */
export const OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const CAM = Easing.bezier(0.77, 0, 0.175, 1);
export const EXIT = Easing.bezier(0.55, 0, 1, 0.45);

/** 0→1 between two frames, clamped. */
export function tween(f: number, from: number, to: number, easing = OUT) {
  return interpolate(f, [from, to], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** Linear blend from a to b by t. */
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * A headline that arrives word by word (each rises 14px out of an 8px blur, 50 ms apart) and leaves faster than it
 * came. `at` and `out` are frames relative to the scene.
 */
export function Line({
  text,
  at,
  out,
  size = 76,
  className = "",
  style,
}: {
  text: string;
  at: number;
  out?: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const words = text.split(" ");
  const gone = out === undefined ? 0 : tween(f, out, out + s(0.32), EXIT);
  if (f < at || gone >= 1) return null;
  return (
    <div
      className={`text-center font-medium tracking-[-0.05em] text-black ${className}`}
      style={{
        fontSize: size,
        lineHeight: 1.06,
        opacity: 1 - gone,
        transform: `translateY(${-10 * gone}px)`,
        filter: gone ? `blur(${6 * gone}px)` : undefined,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const p = tween(f, at + i * 3, at + i * 3 + s(0.55));
        return (
          <span
            key={i}
            className="inline-block whitespace-pre"
            style={{ opacity: p, transform: `translateY(${14 * (1 - p)}px)`, filter: p < 1 ? `blur(${8 * (1 - p)}px)` : undefined }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
}

/** The headline area: one line at a time, centred near the top of the frame. */
export function Headline({ children }: { children: ReactNode }) {
  return <div className="absolute inset-x-0 top-[132px] flex flex-col items-center gap-3 px-40">{children}</div>;
}

/**
 * Where a scene's product UI sits: the space under the headline, content centred, scaled up with CSS zoom (which
 * re-lays text out at the larger size, so it stays sharp) so cards read on a phone.
 */
export function Stage({ children, zoom = 1.35, top = 250 }: { children: ReactNode; zoom?: number; top?: number }) {
  return (
    <div className="absolute inset-x-0 bottom-[40px] flex items-center justify-center" style={{ top }}>
      <div style={{ zoom }}>{children}</div>
    </div>
  );
}

/** Something that rises into place. */
export function Rise({
  at,
  children,
  dist = 24,
  dur = 0.6,
  className = "",
  style,
}: {
  at: number;
  children: ReactNode;
  dist?: number;
  dur?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const p = tween(f, at, at + s(dur));
  return (
    <div className={className} style={{ opacity: p, transform: `translateY(${dist * (1 - p)}px)`, ...style }}>
      {children}
    </div>
  );
}

/** The paper every shot sits on. */
export function Paper({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 overflow-hidden bg-[#fcfcfd]">{children}</div>;
}

/**
 * The virtual camera: zooms everything inside it toward `focus` (a point in frame pixels that stays put), so a dolly
 * lands on a specific card or row rather than the middle of the frame.
 */
export function Camera({ scale = 1, focus = [W / 2, H / 2], children }: { scale?: number; focus?: [number, number]; children: ReactNode }) {
  const [fx, fy] = focus;
  return (
    <div className="absolute inset-0" style={{ transformOrigin: `${fx}px ${fy}px`, transform: `scale(${scale})` }}>
      {children}
    </div>
  );
}

/** Fade a whole scene in and out at its edges so cuts between scenes are soft. */
export function SceneFade({
  dur,
  children,
  inFrames = s(0.35),
  outFrames = s(0.35),
}: {
  dur: number;
  children: ReactNode;
  inFrames?: number;
  outFrames?: number;
}) {
  const f = useCurrentFrame();
  const o = Math.min(tween(f, 0, inFrames), 1 - tween(f, dur - outFrames, dur, EXIT));
  return (
    <div className="absolute inset-0" style={{ opacity: o }}>
      {children}
    </div>
  );
}

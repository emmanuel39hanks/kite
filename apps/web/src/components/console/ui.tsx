"use client";

import NumberFlow from "@number-flow/react";
import * as RSlider from "@radix-ui/react-slider";
import * as RSwitch from "@radix-ui/react-switch";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/* ───────────── Buttons ───────────── */

const SIZES = { md: "h-[42px] px-5 text-[15px]", sm: "h-8 px-3.5 text-[14px]", lg: "h-12 px-6 text-[16px]" } as const;
const VARIANTS = {
  // Kite sky: a soft blue pill with a lit top edge.
  primary:
    "text-black bg-[linear-gradient(#b9defe,#8cc6f6)] shadow-[inset_0_1px_3px_rgba(255,255,255,0.6),inset_0_3px_12px_rgba(255,255,255,0.25),0_1px_2px_rgba(16,40,80,0.12)] ring-1 ring-inset ring-black/10 hover:brightness-[1.03]",
  dark: "text-white bg-[linear-gradient(#262626,#050505)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)] hover:bg-black",
  secondary: "text-black bg-white ring-1 ring-inset ring-black/[0.09] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] hover:bg-[#fafafa]",
  ghost: "text-black/60 hover:text-black hover:bg-black/[0.04]",
  danger: "text-rose-700 bg-white ring-1 ring-inset ring-rose-200 hover:bg-rose-50",
} as const;

type BtnProps = {
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: IconName;
  iconRight?: IconName;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
};

export function Button({ children, variant = "secondary", size = "md", icon, iconRight, href, external, onClick, disabled, loading, className = "", type = "button" }: BtnProps) {
  const cls = `inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full tracking-[-0.02em] transition-[filter,background-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
  const inner = (
    <>
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      <span>{children}</span>
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 15 : 17} />}
    </>
  );
  if (href) {
    return external ? (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={`${cls} cursor-pointer`}>
      {inner}
    </button>
  );
}

function Spinner({ size = 16 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent" style={{ width: size, height: size }} aria-hidden="true" />;
}

/* ───────────── Surfaces ───────────── */

/** The grey card Glider-style consoles use: soft fill, hairline border, 20px corners. */
export function Card({ children, className = "", as: As = "section", id }: { children: ReactNode; className?: string; as?: "section" | "div" | "article"; id?: string }) {
  return (
    <As id={id} className={`rounded-[20px] bg-[#f5f5f7] ring-1 ring-inset ring-black/[0.06] ${className}`}>
      {children}
    </As>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pt-8 pb-7 sm:pt-10 sm:pb-8">
      <h1 className="text-[30px] leading-9 tracking-[-0.05em]">{children}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[22px] leading-7 tracking-[-0.05em]">{children}</h2>
      {actions}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  const t = {
    neutral: "bg-black/[0.05] text-black/60",
    green: "bg-[#05a800]/10 text-[#05a800]",
    amber: "bg-[#e8a317]/15 text-[#8a5a00]",
    red: "bg-rose-500/10 text-rose-600",
    blue: "bg-[#8cc6f6]/30 text-[#1f5a8f]",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-4 ${t}`}>{children}</span>;
}

/** A result line after an action: the console's neutral card, with only the icon carrying the tone. */
export function StatusNote({ tone, children, className = "" }: { tone: "ok" | "err" | "warn"; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-2xl bg-white px-4 py-3 text-[14px] leading-5 text-black ring-1 ring-inset ring-black/[0.06] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      <span className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-white ${tone === "ok" ? "bg-[#05a800]" : tone === "warn" ? "bg-[#d98a00]" : "bg-rose-500"}`}>
        {tone === "warn" ? <span className="text-[12px] leading-none font-semibold">!</span> : <Icon name={tone === "ok" ? "check" : "x"} size={11} stroke={2.4} />}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A section that opens in place, styled like the landing page's questions: a white panel, the title on the left,
 *  a + that turns to × when open. Native <details>, so it works without script and with the keyboard. */
export function Disclosure({ title, icon, children, className = "", defaultOpen = false }: { title: ReactNode; icon?: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className={`group rounded-2xl bg-white ring-1 ring-inset ring-black/[0.06] shadow-[0_2px_2px_rgba(0,0,0,0.04)] ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-[14px] tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          {icon}
          <span className="min-w-0">{title}</span>
        </span>
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#f5f5f7] text-[16px] leading-none text-black/70 transition-transform group-open:rotate-45 motion-reduce:transition-none">
          +
        </span>
      </summary>
      <div className="px-4 pb-4 text-[13px] leading-5 text-black/65">{children}</div>
    </details>
  );
}

/* ───────────── Numbers ───────────── */

export function Money({ value, className = "", digits = 2 }: { value: number; className?: string; digits?: number }) {
  return (
    <NumberFlow
      value={value}
      locales="en-US"
      className={`tabular-nums ${className}`}
      format={{ style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }}
      willChange
    />
  );
}

export function Change({ value, className = "" }: { value: number | null; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={`text-black/35 ${className}`}>–</span>;
  const tone = value > 0.005 ? "text-[#05a800]" : value < -0.005 ? "text-rose-500" : "text-black/45";
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${tone} ${className}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
      {Math.abs(value) > 0.005 && <Icon name={value > 0 ? "up" : "down"} size={14} stroke={1.8} />}
    </span>
  );
}

/* ───────────── Controls ───────────── */

/** Segmented control with a sliding white indicator. */
export function Segmented<T extends string>({ options, value, onChange, label, size = "sm" }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options]);
  const h = size === "sm" ? "h-6 text-[12px] px-3" : "h-8 text-[14px] px-4";
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex items-center gap-0.5 rounded-xl bg-[#ececef] p-1">
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 rounded-lg bg-[#fcfcfd] shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[transform,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateX(${box.x - 4}px)`, width: box.w, left: 4 }}
      />
      {options.map((o) => (
        <button
          key={o}
          ref={(el) => {
            refs.current[o] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={`relative z-10 inline-flex cursor-pointer items-center justify-center rounded-lg tracking-[-0.02em] transition-colors ${h} ${o === value ? "text-black" : "text-[#6b6b6b] hover:text-black/70"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  color = "#111",
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  label: string;
}) {
  return (
    <RSlider.Root
      value={[value]}
      onValueChange={(v) => onChange(v[0])}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      className="relative flex h-6 w-full touch-none items-center select-none"
    >
      <RSlider.Track className="relative h-[6px] grow overflow-hidden rounded-full bg-black/[0.07]">
        <RSlider.Range className="absolute h-full rounded-full" style={{ background: color }} />
      </RSlider.Track>
      <RSlider.Thumb className="block h-5 w-5 cursor-grab rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.18)] transition-transform outline-none hover:scale-110 focus-visible:ring-4 focus-visible:ring-[#8cc6f6]/60 active:cursor-grabbing" />
    </RSlider.Root>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full bg-black/15 transition-colors outline-none focus-visible:ring-4 focus-visible:ring-[#8cc6f6]/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#05a800]"
    >
      <RSwitch.Thumb className="block h-[22px] w-[22px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 will-change-transform data-[state=checked]:translate-x-[20px]" />
    </RSwitch.Root>
  );
}

/* ───────────── Empty & gate states ───────────── */

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="text-[18px] leading-7">{title}</div>
      <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-5 text-[#6b6b6b]">{text}</p>
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Deterministic avatar gradient from an account name. */
export function Avatar({ seed, size = 28 }: { seed: string; size?: number }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      className="inline-block shrink-0 rounded-full ring-1 ring-black/5"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 70) % 360} 75% 45%))` }}
      aria-hidden="true"
    />
  );
}

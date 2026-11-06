"use client";

import { Icon } from "@/components/console/icons";
import type { Check } from "@/lib/ai/verify-policy";

const TONE = {
  pass: { dot: "bg-[#05a800]", icon: "check", word: "Checked" },
  fail: { dot: "bg-rose-500", icon: "x", word: "Failed" },
  unknown: { dot: "bg-black/25", icon: "dots", word: "Not checked" },
} as const;

/** One line per check: green only for something actually checked here, grey for anything that wasn't. */
export function PolicyChecklist({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2.5">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-3">
          <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-white ${TONE[c.state].dot}`} aria-label={TONE[c.state].word}>
            <Icon name={TONE[c.state].icon} size={11} stroke={2.4} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] leading-5">{c.label}</div>
            <p className="text-[13px] leading-5 break-words text-[#6b6b6b]">{c.reason}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

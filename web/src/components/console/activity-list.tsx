import { txUrl } from "@/lib/near/config";
import type { ActivityEvent } from "@/lib/store";
import { Icon, type IconName } from "./icons";

const STYLE: Record<ActivityEvent["kind"], { icon: IconName; tone: string }> = {
  created: { icon: "key", tone: "bg-black/[0.05] text-black/70" },
  deposit: { icon: "deposit", tone: "bg-black/[0.05] text-black/70" },
  trade: { icon: "refresh", tone: "bg-[#05a800]/10 text-[#05a800]" },
  blocked: { icon: "x", tone: "bg-rose-500/10 text-rose-600" },
  check: { icon: "check", tone: "bg-black/[0.05] text-black/60" },
  guardrails: { icon: "shield", tone: "bg-black/[0.05] text-black/60" },
  key: { icon: "lock", tone: "bg-black/[0.05] text-black/60" },
};

const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ActivityList({ events, compact = false }: { events: ActivityEvent[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-black/[0.06]">
      {events.map((e) => {
        const s = STYLE[e.kind];
        return (
          <li key={e.id} className="flex items-center gap-3.5 px-4 py-3.5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${s.tone}`}>
              <Icon name={s.icon} size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] tracking-[-0.02em]">{e.title}</div>
              {e.detail && <p className={`text-[13px] leading-5 text-[#909090] ${compact ? "truncate" : ""}`}>{e.detail}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-[12px] text-[#909090] tabular-nums">{when(e.at)}</span>
              {e.sim && !e.tx && <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] text-black/55">Preview</span>}
              {e.tx && (
                <a href={txUrl(e.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-black/60 hover:text-black">
                  Transaction <Icon name="external" size={12} />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

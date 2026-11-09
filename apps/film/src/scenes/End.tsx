/**
 * The close (9s): back to the problem in three facts, each one something the demo just showed, then where to try it.
 */
import { useCurrentFrame } from "remotion";
import { Wordmark } from "@/components/kite-mark";
import { Icon } from "@/components/console/icons";
import { Paper, Rise, s, tween } from "../motion";

export const END_DUR = s(9);

const FACTS = [
  ["lock", "Your money sits in a vault only you can withdraw from."],
  ["key", "Kite's key can rebalance it. Nothing else."],
  ["check", "The vault checks every trade before it runs."],
] as const;

export function End() {
  const f = useCurrentFrame();
  const p = tween(f, s(0.15), s(0.9));
  const links = tween(f, s(4.4), s(5.0));
  return (
    <Paper>
      <div
        className="absolute inset-x-0 top-[150px] flex justify-center"
        style={{ opacity: p, transform: `translateY(${20 * (1 - p)}px)`, filter: p < 1 ? `blur(${10 * (1 - p)}px)` : undefined }}
      >
        <Wordmark className="text-[150px]" />
      </div>

      <div className="absolute inset-x-0 top-[400px] flex flex-col items-center gap-5">
        {FACTS.map(([icon, text], i) => (
          <Rise key={icon} at={s(0.9 + i * 0.9)} dist={16}>
            <div className="flex w-[1060px] items-center gap-5 rounded-2xl bg-white px-7 py-5 text-[38px] tracking-[-0.03em] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-black/[0.06]">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(#b9defe,#8cc6f6)]">
                <Icon name={icon} size={28} />
              </span>
              {text}
            </div>
          </Rise>
        ))}
      </div>

      <div className="absolute inset-x-0 top-[830px] flex flex-col items-center gap-3 text-[34px] tracking-[-0.03em]" style={{ opacity: links }}>
        <span>Try it without a wallet: usekite.xyz</span>
        <span className="text-[26px] text-[#6b6b6b]">github.com/emmanuel39hanks/kite · Built at NEAR HACKATHON</span>
      </div>
    </Paper>
  );
}

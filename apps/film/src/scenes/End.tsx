/** The end card: the name, the line, where to try it. */
import { useCurrentFrame } from "remotion";
import { Wordmark } from "@/components/kite-mark";
import { Line, Paper, s, tween } from "../motion";

export const END_DUR = s(5);

export function End() {
  const f = useCurrentFrame();
  const p = tween(f, s(0.15), s(0.9));
  const links = tween(f, s(1.8), s(2.4));
  return (
    <Paper>
      <div
        className="absolute inset-x-0 top-[250px] flex justify-center"
        style={{ opacity: p, transform: `translateY(${20 * (1 - p)}px)`, filter: p < 1 ? `blur(${10 * (1 - p)}px)` : undefined }}
      >
        <Wordmark className="text-[200px]" />
      </div>
      <div className="absolute inset-x-0 top-[520px]">
        <Line text="You hold the string." at={s(0.9)} size={80} />
      </div>
      <div className="absolute inset-x-0 top-[700px] flex flex-col items-center gap-3 text-[32px] tracking-[-0.03em]" style={{ opacity: links }}>
        <span>Try it without a wallet: usekite.xyz</span>
        <span className="text-[#6b6b6b]">github.com/emmanuel39hanks/kite</span>
        <span className="mt-6 text-[24px] text-[#6b6b6b]">Built at NEAR HACKATHON</span>
      </div>
    </Paper>
  );
}

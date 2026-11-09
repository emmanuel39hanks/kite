/** Scene 3: the name, then what it does in one breath. */
import { useCurrentFrame } from "remotion";
import { Wordmark } from "@/components/kite-mark";
import { Line, Paper, s, tween } from "../motion";

export const MEET_DUR = s(3.8);

export function Meet() {
  const f = useCurrentFrame();
  const p = tween(f, s(0.15), s(0.9));
  return (
    <Paper>
      <div
        className="absolute inset-x-0 top-[300px] flex justify-center"
        style={{ opacity: p, transform: `translateY(${20 * (1 - p)}px) scale(${0.96 + 0.04 * p})`, filter: p < 1 ? `blur(${10 * (1 - p)}px)` : undefined }}
      >
        <Wordmark className="text-[220px]" />
      </div>
      <div className="absolute inset-x-0 top-[600px] flex flex-col items-center gap-2">
        <Line text="Kite does it for you." at={s(1.0)} size={72} />
        <Line text="And never holds your money." at={s(1.9)} size={72} style={{ color: "#6b6b6b" }} />
      </div>
    </Paper>
  );
}

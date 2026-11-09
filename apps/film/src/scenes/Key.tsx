/** Scene 5: Kite's one key, and the four things it might try. Three refused, one allowed. */
import { useCurrentFrame } from "remotion";
import { Icon } from "@/components/console/icons";
import { Headline, Line, Paper, Rise, Stage, mix, s, tween } from "../motion";

export const KEY_DUR = s(5.8);

const TRIES = [
  { text: "Take your money out", ok: false, at: 2.9 },
  { text: "Change your rules", ok: false, at: 3.35 },
  { text: "Send money to someone else", ok: false, at: 3.8 },
  { text: "Rebalance", ok: true, at: 4.35 },
];

export function Key() {
  const f = useCurrentFrame();
  return (
    <Paper>
      <Headline>
        <Line text="Kite gets one key." at={s(0.2)} out={s(2.5)} />
        <Line text="That key can only rebalance. Nothing else." at={s(2.7)} out={s(5.5)} />
      </Headline>

      <Stage zoom={1.2}>
        <div className="flex flex-col items-center gap-14">
          <Rise at={s(0.4)}>
            <div className="flex items-center gap-4 rounded-full bg-white py-3 pr-8 pl-3 text-[30px] tracking-[-0.03em] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-black/[0.06]">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-[linear-gradient(#b9defe,#8cc6f6)]">
                <Icon name="key" size={32} />
              </span>
              Kite&apos;s key
            </div>
          </Rise>

          <div className="grid w-[1180px] grid-cols-2 gap-5">
            {TRIES.map((t, i) => {
              const tried = tween(f, s(t.at), s(t.at + 0.35));
              return (
                <Rise key={t.text} at={s(0.9 + i * 0.18)} dist={16}>
                  <div
                    className="flex items-center gap-4 rounded-2xl bg-white px-6 py-5 text-[28px] tracking-[-0.03em] ring-1 ring-inset ring-black/[0.06]"
                    style={{
                      opacity: t.ok ? 1 : mix(1, 0.5, tried),
                      boxShadow: t.ok ? `0 0 0 ${3 * tried}px #05a800` : undefined,
                    }}
                  >
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
                      style={{ background: tried ? (t.ok ? "#05a800" : "#f43f5e") : "#e6e8ec", transform: `scale(${tried ? 0.8 + 0.2 * tried : 1})` }}
                    >
                      {tried > 0 && <Icon name={t.ok ? "check" : "x"} size={22} stroke={2.4} />}
                    </span>
                    <span className="relative">
                      {t.text}
                      {!t.ok && <span className="absolute top-1/2 left-0 h-[3px] bg-black/70" style={{ width: `${100 * tried}%` }} />}
                    </span>
                    <span className="ml-auto text-[22px]" style={{ opacity: tried, color: t.ok ? "#05a800" : "#e11d48" }}>
                      {t.ok ? "Allowed" : "Refused"}
                    </span>
                  </div>
                </Rise>
              );
            })}
          </div>
        </div>
      </Stage>
    </Paper>
  );
}

/** Scene 6: what happens before a trade. The account checks three things in plain words, then the split comes back. */
import { useCurrentFrame } from "remotion";
import { Logo } from "@/components/logo";
import { MixBar } from "@/components/charts";
import { Badge, Card } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { CAM, Headline, Line, Paper, Rise, Stage, mix, s, tween } from "../motion";

export const CHECKS_DUR = s(6.2);

const CHECKS = [
  { text: "The price is fair", at: 1.6 },
  { text: "It's within the limits you set", at: 2.3 },
  { text: "The money comes back to your account", at: 3.0 },
];

export function Checks() {
  const f = useCurrentFrame();
  const even = tween(f, s(3.9), s(4.9), CAM);
  const btc = Math.round(mix(64, 50, even));
  const done = tween(f, s(4.8), s(5.2));
  return (
    <Paper>
      <Headline>
        <Line text="Before every trade, your account checks it." at={s(0.2)} out={s(5.9)} />
      </Headline>

      <Stage zoom={1.25}>
        <Rise at={s(0.5)} dist={30} className="w-[900px]">
          <Card className="p-8">
            <div className="flex items-center gap-4">
              <span className="flex -space-x-2">
                <Logo id="btc" size={48} />
                <Logo id="xaut" size={48} />
              </span>
              <div>
                <div className="text-[30px] tracking-[-0.03em]">Sell $200 of Bitcoin, buy gold</div>
                <div className="text-[20px] text-[#6b6b6b]">Best price from traders competing on NEAR Intents, signed so it can&apos;t be changed</div>
              </div>
            </div>

            <ul className="mt-6 space-y-3">
              {CHECKS.map((c) => {
                const t = tween(f, s(c.at), s(c.at + 0.4));
                return (
                  <li key={c.text} className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 text-[24px] ring-1 ring-inset ring-black/[0.06]">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
                      style={{ background: t ? "#05a800" : "#e6e8ec", transform: `scale(${t ? 0.85 + 0.15 * t : 1})` }}
                    >
                      {t > 0 && <Icon name="check" size={20} stroke={2.4} />}
                    </span>
                    <span style={{ opacity: mix(0.45, 1, t) }}>{c.text}</span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-7 flex items-center justify-between text-[22px]">
              <span className="tabular-nums">
                Bitcoin {btc}% · Gold {100 - btc}%
              </span>
              <span style={{ opacity: done }} className="[&>span]:px-4 [&>span]:py-1.5 [&>span]:text-[20px]">
                <Badge tone="green">Back to your split</Badge>
              </span>
            </div>
            <MixBar
              className="mt-3 h-4"
              slices={[
                { id: "btc", weight: btc, color: "#F7931A" },
                { id: "xaut", weight: 100 - btc, color: "#D4A537" },
              ]}
            />
          </Card>
        </Rise>
      </Stage>
    </Paper>
  );
}

/**
 * Lead-in to the withdraw-and-close recording: leaving is one step, every holding turns back into dollars, and the
 * account's deposit comes back too. Honest about the one cost: small swap fees.
 */
import { useCurrentFrame } from "remotion";
import { Logo } from "@/components/logo";
import { Card } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { Headline, Line, Paper, Rise, Stage, mix, s, tween, usd, Sfx } from "../motion";

export const LEAVE_DUR = s(6.4);

const ROWS = [
  { id: "btc" as const, name: "Bitcoin", usd: 700, at: 1.4 },
  { id: "xaut" as const, name: "Gold", usd: 700, at: 1.9 },
];

export function Leave() {
  const f = useCurrentFrame();
  const back = tween(f, s(2.7), s(3.3));
  const deposit = tween(f, s(3.3), s(3.9));
  return (
    <Paper>
      <Headline>
        <Line text="Want out? Leave any time." at={s(0.2)} out={s(2.9)} />
        <Line text="Everything comes back to your wallet." at={s(3.1)} out={s(6.1)} />
      </Headline>

      <Stage zoom={1.3}>
        <Rise at={s(0.5)} dist={30} className="w-[860px]">
          <Card className="p-8">
            <ul className="space-y-3">
              {ROWS.map((r) => {
                const t = tween(f, s(r.at), s(r.at + 0.5));
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 text-[26px] tracking-[-0.03em] ring-1 ring-inset ring-black/[0.06]"
                  >
                    <Logo id={r.id} size={44} />
                    <span>{r.name}</span>
                    <Icon name="arrow-right" size={24} className="text-black/30" />
                    <span className="flex items-center gap-3" style={{ opacity: mix(0.25, 1, t), transform: `translateX(${-12 * (1 - t)}px)` }}>
                      <Logo id="usdc" size={36} /> Dollars (USDC)
                    </span>
                    <span className="ml-auto tabular-nums">{usd(r.usd)}</span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 space-y-3 border-t border-black/[0.06] pt-6 text-[26px] tracking-[-0.03em]">
              <div className="flex items-center gap-4" style={{ opacity: back, transform: `translateY(${10 * (1 - back)}px)` }}>
                <Icon name="wallet" size={30} />
                Back in your wallet
                <span className="ml-auto tabular-nums">$1,400 in USDC</span>
              </div>
              <div className="flex items-center gap-4" style={{ opacity: deposit, transform: `translateY(${10 * (1 - deposit)}px)` }}>
                <Logo id="near" size={30} />
                The account&apos;s deposit, returned
                <span className="ml-auto tabular-nums">2.6 NEAR</span>
              </div>
              <div className="text-[20px] text-[#6b6b6b]" style={{ opacity: tween(f, s(4.2), s(4.7)) }}>
                Less small swap fees. Kite never touches it on the way out.
              </div>
            </div>
          </Card>
        </Rise>
      </Stage>
      <Sfx name="pop" at={s(0.55)} />
      <Sfx name="whoosh" at={s(1.35)} volume={0.4} />
      <Sfx name="tick" at={s(1.5)} volume={0.7} />
      <Sfx name="whoosh" at={s(1.85)} volume={0.4} />
      <Sfx name="tick" at={s(2.0)} volume={0.7} />
      <Sfx name="coin" at={s(2.75)} />
      <Sfx name="coin" at={s(3.35)} volume={0.8} />
    </Paper>
  );
}

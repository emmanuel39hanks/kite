/** Scene 7: NEAR turns into Staked NEAR and starts earning. One logo, one number. */
import { useCurrentFrame } from "remotion";
import { Logo } from "@/components/logo";
import { Headline, Line, Paper, Rise, Stage, mix, s, tween } from "../motion";

export const EARN_DUR = s(4.8);

/** Meta Pool's staking rate as Kite showed it on 2026-11-09 (/api/yields: 4.17%). */
const APY = 4.2;

export function Earn() {
  const f = useCurrentFrame();
  const flip = tween(f, s(1.3), s(1.9));
  const count = tween(f, s(1.7), s(2.9));
  return (
    <Paper>
      <Headline>
        <Line text="Your money can even earn while it waits." at={s(0.2)} out={s(4.5)} />
      </Headline>

      <Stage zoom={1.15}>
        <Rise at={s(0.5)} dist={24} className="flex flex-col items-center">
          <div className="relative h-[150px] w-[150px]">
            <div className="absolute inset-0" style={{ opacity: 1 - flip }}>
              <Logo id="near" size={150} />
            </div>
            <div className="absolute inset-0" style={{ opacity: flip, transform: `scale(${mix(0.92, 1, flip)})` }}>
              <Logo id="stnear" size={150} />
            </div>
          </div>
          <div className="relative mt-6 h-[60px] w-[600px] text-center text-[48px] tracking-[-0.04em]">
            <span className="absolute inset-0" style={{ opacity: 1 - flip }}>
              NEAR
            </span>
            <span className="absolute inset-0" style={{ opacity: flip }}>
              Staked NEAR
            </span>
          </div>
          <div className="mt-8 text-[110px] leading-none tracking-[-0.05em] text-[#05a800] tabular-nums" style={{ opacity: tween(f, s(1.7), s(2.0)) }}>
            +{(APY * count).toFixed(1)}%
          </div>
          <div className="mt-3 text-[28px] text-[#6b6b6b]" style={{ opacity: tween(f, s(2.4), s(2.9)) }}>
            a year, from NEAR staking rewards. Sell it any time.
          </div>
        </Rise>
      </Stage>
    </Paper>
  );
}

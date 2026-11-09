/** A DAO's shared money. The landing page's proposal card, with the votes coming in. */
import { useCurrentFrame } from "remotion";
import { Donut } from "@/components/charts";
import { Logo, logoName } from "@/components/logo";
import type { Slice } from "@/lib/mix";
import { Headline, Line, Paper, Rise, Stage, s, tween, Sfx } from "../motion";

export const DAO_DUR = s(4.8);

const OK = "#05a800";
const TREASURY: Slice[] = [
  { id: "usdc", weight: 50, color: "#2775CA" },
  { id: "btc", weight: 30, color: "#F7931A" },
  { id: "stnear", weight: 20, color: "#00C08B" },
];
const VOTES = [1.3, 1.8, 2.3]; // seconds each member's approval lands

export function Dao() {
  const f = useCurrentFrame();
  const yes = VOTES.filter((t) => f >= s(t)).length;
  const created = f >= s(3.0);
  const bar = VOTES.reduce((n, t) => n + tween(f, s(t), s(t + 0.3)), 0);
  return (
    <Paper>
      <Headline>
        <Line text="DAOs can use it too. Members vote on every step." at={s(0.2)} out={s(4.5)} />
      </Headline>

      <Stage zoom={1.3}>
        <Rise at={s(0.45)} dist={30} className="w-[880px]">
          <div className="rounded-2xl bg-cloud p-8">
            <div className="rounded-xl bg-white p-8 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
              <div className="flex items-center justify-between gap-3 text-[20px] text-black/45">
                <span>Proposal 1, ourclub.sputnik-dao.near</span>
                <span className="flex items-center gap-2 font-medium text-black">
                  <span className="h-3 w-3 rounded-full" style={{ background: created ? OK : "#e8a317" }} />
                  {created ? "Vault created" : "Voting"}
                </span>
              </div>
              <div className="mt-4 flex items-start justify-between gap-6">
                <div>
                  <h3 className="text-[36px] leading-tight font-medium tracking-[-0.025em]">Create a Kite vault for our treasury</h3>
                  <p className="mt-2 text-[22px] text-black/55">Keep it half dollars, the rest in Bitcoin and staked NEAR.</p>
                </div>
                <Donut slices={TREASURY} size={110} />
              </div>
              <ul className="mt-6 grid grid-cols-3 gap-4">
                {TREASURY.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-[20px]">
                    <Logo id={t.id} size={28} />
                    {logoName(t.id)}
                    <span className="ml-auto text-black/50 tabular-nums">{t.weight}%</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 border-t border-line pt-5">
                <div className="flex justify-between text-[20px]">
                  <span className="font-medium tabular-nums">{yes} of 3 approved</span>
                  <span className="text-black/45">3 members</span>
                </div>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div style={{ width: `${(bar / 3) * 100}%`, background: OK }} />
                </div>
              </div>
            </div>
          </div>
        </Rise>
      </Stage>
      <Sfx name="pop" at={s(0.5)} />
      <Sfx name="tick" at={s(1.3)} volume={0.9} />
      <Sfx name="tick" at={s(1.8)} volume={0.9} />
      <Sfx name="tick" at={s(2.3)} volume={0.9} />
      <Sfx name="check" at={s(3.0)} />
    </Paper>
  );
}

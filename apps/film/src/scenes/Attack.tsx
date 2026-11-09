/** Lead-in to the attack recording: the key again, now in the wrong hands. Cuts to the terminal. */
import { useCurrentFrame } from "remotion";
import { Icon } from "@/components/console/icons";
import { Headline, Line, Paper, Rise, Stage, mix, s, tween, Sfx } from "../motion";

export const ATTACK_DUR = s(5.4);

export function Attack() {
  const f = useCurrentFrame();
  const stolen = tween(f, s(2.6), s(3.2));
  return (
    <Paper>
      <Headline>
        <Line text="What if someone stole Kite's key?" at={s(0.2)} out={s(2.6)} />
        <Line text="We gave it to an attacker. On NEAR mainnet." at={s(2.8)} out={s(5.1)} />
      </Headline>

      <Stage zoom={1.4}>
        <Rise at={s(0.5)} className="flex items-center gap-6">
          <div className="flex items-center gap-4 rounded-full bg-white py-3 pr-8 pl-3 text-[30px] tracking-[-0.03em] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-black/[0.06]">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[linear-gradient(#b9defe,#8cc6f6)]">
              <Icon name="key" size={32} />
            </span>
            Kite&apos;s key
          </div>
          <div style={{ opacity: stolen, transform: `translateX(${mix(-30, 0, stolen)}px)` }}>
            <Icon name="arrow-right" size={40} className="text-black/40" />
          </div>
          <div
            className="flex items-center gap-4 rounded-full bg-black py-3 pr-8 pl-3 text-[30px] tracking-[-0.03em] text-white"
            style={{ opacity: stolen, transform: `translateX(${mix(-30, 0, stolen)}px)` }}
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/15">
              <Icon name="user" size={30} />
            </span>
            attacker.near
          </div>
        </Rise>
      </Stage>
      <Sfx name="key" at={s(0.55)} />
      <Sfx name="whoosh" at={s(2.55)} volume={0.6} />
      <Sfx name="refuse" at={s(3.0)} volume={0.6} />
    </Paper>
  );
}

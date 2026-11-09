/** Scene 4: where the money lives. The console's own "Your vault" card, tilting up into view. */
import { useCurrentFrame } from "remotion";
import { Avatar, Badge, Card } from "@/components/console/ui";
import { Camera, CAM, Headline, Line, Paper, Stage, mix, s, tween, Sfx } from "../motion";

export const VAULT_DUR = s(5.6);

export function Vault() {
  const f = useCurrentFrame();
  const up = tween(f, s(0.3), s(1.4));
  const zoom = tween(f, s(3.0), s(4.1), CAM);
  const focusRow = tween(f, s(3.3), s(3.8));
  const rows = [
    {
      k: "Owner",
      v: (
        <span className="flex items-center gap-2.5">
          <Avatar seed="you.near" size={30} /> you.near
        </span>
      ),
    },
    { k: "Can take money out", v: <Badge tone="green">Only you, any time</Badge>, focus: true },
    { k: "Kite's key", v: <Badge tone="blue">Rebalance only</Badge> },
  ];
  return (
    <Paper>
      <Headline>
        <Line text="Your money stays in your own account on NEAR." at={s(0.2)} out={s(2.8)} size={68} />
        <Line text="Only you can take it out." at={s(3.0)} out={s(5.3)} size={68} />
      </Headline>

      <Camera scale={1 + 0.16 * zoom} focus={[960, 660]}>
        <Stage zoom={1.3}>
          <div className="w-[860px]" style={{ perspective: 1600 }}>
            <div style={{ opacity: up, transform: `rotateX(${mix(18, 0, up)}deg) translateY(${40 * (1 - up)}px)`, transformOrigin: "50% 100%" }}>
              <Card className="p-8">
                <h3 className="text-[30px] tracking-[-0.03em]">Your vault</h3>
                <div className="mt-1 font-mono text-[20px] text-[#6b6b6b]">you.kitevaults.near</div>
                <dl className="mt-6 space-y-3">
                  {rows.map((r) => (
                    <div
                      key={r.k}
                      className="flex items-center justify-between gap-6 rounded-2xl bg-white px-5 py-4 text-[24px] ring-1 ring-inset ring-black/[0.06]"
                      style={r.focus ? { boxShadow: `0 0 0 ${3 * focusRow}px #8cc6f6` } : { opacity: mix(1, 0.45, focusRow) }}
                    >
                      <dt className="text-[#6b6b6b]">{r.k}</dt>
                      <dd className="[&_span.rounded-full]:px-4 [&_span.rounded-full]:py-1.5 [&_span.rounded-full]:text-[20px]">{r.v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </div>
        </Stage>
      </Camera>
      <Sfx name="whoosh" at={s(0.2)} volume={0.5} />
      <Sfx name="pop" at={s(1.1)} volume={0.8} />
      <Sfx name="tick" at={s(3.35)} volume={0.8} />
    </Paper>
  );
}

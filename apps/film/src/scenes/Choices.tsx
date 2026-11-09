/** Scene 2: the two ways people deal with it today, side by side. Doing it by hand, or giving an app your money. */
import { useCurrentFrame } from "remotion";
import { Card, Badge, Avatar } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { Headline, Line, Paper, Rise, Stage, s, tween, mix } from "../motion";

export const CHOICES_DUR = s(6.6);

const CHORES = [
  ["Mon", "Check prices"],
  ["Tue", "Check prices"],
  ["Wed", "Sell some Bitcoin"],
  ["Thu", "Check prices"],
  ["Fri", "Buy some gold"],
  ["Sat", "Check prices"],
] as const;

export function Choices() {
  const f = useCurrentFrame();
  const dim = tween(f, s(3.2), s(3.8));
  return (
    <Paper>
      <Headline>
        <Line text="Doing it yourself means checking prices every day." at={s(0.2)} out={s(3.0)} size={68} />
        <Line text="Apps that do it for you usually hold your money." at={s(3.3)} out={s(6.2)} size={68} />
      </Headline>

      <Stage zoom={1.3}>
        <div className="flex items-start gap-10">
          {/* By hand: a week of chores piling up. */}
          <div style={{ opacity: mix(1, 0.35, dim), filter: dim ? `blur(${2 * dim}px)` : undefined }}>
            <Card className="w-[560px] p-6">
              <div className="flex items-center gap-3 text-[24px] tracking-[-0.03em]">
                <Icon name="clock" size={26} /> Your week
              </div>
              <ul className="mt-4 space-y-2.5">
                {CHORES.map(([day, what], i) => (
                  <Rise key={i} at={s(0.5 + i * 0.32)} dist={14} dur={0.4}>
                    <li className="flex items-center gap-4 rounded-xl bg-white px-4 py-3 text-[22px] ring-1 ring-inset ring-black/[0.06]">
                      <span className="w-14 text-[#6b6b6b]">{day}</span>
                      {what}
                      <span className="ml-auto h-5 w-5 rounded-md ring-2 ring-inset ring-black/15" />
                    </li>
                  </Rise>
                ))}
              </ul>
            </Card>
          </div>

          {/* An app that holds the money. */}
          <Rise at={s(3.5)} dist={30}>
            <Card className="w-[560px] p-6">
              <div className="flex items-center gap-3 text-[24px] tracking-[-0.03em]">
                <Avatar seed="trading-bot" size={36} /> A trading app
              </div>
              <dl className="mt-6 space-y-4 text-[22px]">
                {[
                  ["Holds your money", "Yes"],
                  ["Can move it anywhere", "Yes"],
                  ["If it's hacked", "Your money goes too"],
                ].map(([k, v], i) => (
                  <Rise key={k} at={s(3.9 + i * 0.35)} dist={10} dur={0.4}>
                    <div className="flex items-center justify-between gap-4 rounded-xl bg-white px-4 py-3.5 ring-1 ring-inset ring-black/[0.06]">
                      <dt className="text-[#6b6b6b]">{k}</dt>
                      <dd className="[&>span]:px-3.5 [&>span]:py-1.5 [&>span]:text-[19px]">
                        <Badge tone="amber">{v}</Badge>
                      </dd>
                    </div>
                  </Rise>
                ))}
              </dl>
            </Card>
          </Rise>
        </div>
      </Stage>
    </Paper>
  );
}

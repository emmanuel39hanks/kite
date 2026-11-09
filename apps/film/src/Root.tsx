import "./style.css";
import type { ComponentType } from "react";
import { loadFont } from "@remotion/google-fonts/HankenGrotesk";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import { FPS, H, SceneFade, W } from "./motion";
import { Balance, BALANCE_DUR } from "./scenes/Balance";
import { Choices, CHOICES_DUR } from "./scenes/Choices";
import { Meet, MEET_DUR } from "./scenes/Meet";
import { End, END_DUR } from "./scenes/End";

// Kite's typeface, the same weights the site loads through next/font.
const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "800"], subsets: ["latin"] });

type Scene = { C: ComponentType; dur: number };

/**
 * Two clips bookend the live demo (see DEMO_SCRIPT.md): the problem before the console, the recap after it.
 * The other scenes in ./scenes are kept but not rendered.
 * Every clip starts and ends on Kite's paper colour, so it cuts straight into or out of the console.
 */
export const CLIPS: { id: string; scenes: Scene[] }[] = [
  {
    id: "01-problem",
    scenes: [
      { C: Balance, dur: BALANCE_DUR },
      { C: Choices, dur: CHOICES_DUR },
      { C: Meet, dur: MEET_DUR },
    ],
  },
  { id: "08-end", scenes: [{ C: End, dur: END_DUR }] },
];

const length = (scenes: Scene[]) => scenes.reduce((n, x) => n + x.dur, 0);

function Reel({ scenes }: { scenes: Scene[] }) {
  let from = 0;
  return (
    <AbsoluteFill style={{ ["--font-hanken" as string]: fontFamily, fontFamily, background: "#fcfcfd" }}>
      {scenes.map(({ C, dur }, i) => {
        const at = from;
        from += dur;
        return (
          <Sequence key={i} from={at} durationInFrames={dur}>
            <SceneFade dur={dur} inFrames={i === 0 ? 1 : undefined} outFrames={i === scenes.length - 1 ? 1 : undefined}>
              <C />
            </SceneFade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

// One component per clip, made once: Remotion passes props as JSON, so the scene list can't travel as a prop.
const REELS = [...CLIPS, { id: "All", scenes: CLIPS.flatMap((c) => c.scenes) }].map((c) => {
  const Clip = () => <Reel scenes={c.scenes} />;
  return { id: c.id === "All" ? "All" : `clip-${c.id}`, Clip, dur: length(c.scenes) };
});

export function Root() {
  return (
    <>
      {REELS.map(({ id, Clip, dur }) => (
        <Composition key={id} id={id} component={Clip} durationInFrames={dur} fps={FPS} width={W} height={H} />
      ))}
    </>
  );
}

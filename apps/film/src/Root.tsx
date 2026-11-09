import "./style.css";
import { loadFont } from "@remotion/google-fonts/HankenGrotesk";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import { FPS, H, SceneFade, W } from "./motion";
import { Balance, BALANCE_DUR } from "./scenes/Balance";
import { Choices, CHOICES_DUR } from "./scenes/Choices";
import { Meet, MEET_DUR } from "./scenes/Meet";
import { Vault, VAULT_DUR } from "./scenes/Vault";
import { Key, KEY_DUR } from "./scenes/Key";
import { Checks, CHECKS_DUR } from "./scenes/Checks";
import { Earn, EARN_DUR } from "./scenes/Earn";
import { Dao, DAO_DUR } from "./scenes/Dao";
import { Console, CONSOLE_DUR } from "./scenes/Console";

// Kite's typeface, the same weights the site loads through next/font.
const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "800"], subsets: ["latin"] });

/** The story in order. Each scene owns its own clock; the timeline only places them end to end. */
const SCENES = [
  { C: Balance, dur: BALANCE_DUR },
  { C: Choices, dur: CHOICES_DUR },
  { C: Meet, dur: MEET_DUR },
  { C: Vault, dur: VAULT_DUR },
  { C: Key, dur: KEY_DUR },
  { C: Checks, dur: CHECKS_DUR },
  { C: Earn, dur: EARN_DUR },
  { C: Dao, dur: DAO_DUR },
  { C: Console, dur: CONSOLE_DUR },
];
const TOTAL = SCENES.reduce((n, x) => n + x.dur, 0);

export function Intro() {
  let from = 0;
  return (
    <AbsoluteFill style={{ ["--font-hanken" as string]: fontFamily, fontFamily, background: "#fcfcfd" }}>
      {SCENES.map(({ C, dur }, i) => {
        const at = from;
        from += dur;
        return (
          <Sequence key={i} from={at} durationInFrames={dur}>
            <SceneFade dur={dur} inFrames={i === 0 ? 1 : undefined} outFrames={i === SCENES.length - 1 ? 1 : undefined}>
              <C />
            </SceneFade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export function Root() {
  return <Composition id="Intro" component={Intro} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />;
}

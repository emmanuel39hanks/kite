import type { LogoId } from "@/lib/assets";
import { slice, type Slice } from "./mix";

export type PlanData = {
  slug: string;
  name: string;
  who: string;
  mix: Slice[];
  /** One plain sentence on the idea behind the mix. */
  idea: string;
  /** Why each part is there, keyed by asset. */
  why: Partial<Record<LogoId, string>>;
  swings: 1 | 2 | 3;
  goodFor: string;
};

export const PLAN_DATA: PlanData[] = [
  {
    slug: "bitcoin-plus",
    name: "Bitcoin Plus",
    who: "Mostly Bitcoin, with gold as a cushion.",
    mix: [slice("btc", 60), slice("eth", 20), slice("xaut", 20)],
    idea: "Bitcoin does the flying. Gold holds the string, so a bad month for crypto hurts less.",
    why: {
      btc: "The main bet. Grows the most, and drops the most.",
      eth: "A second big coin, so it isn't all riding on one.",
      xaut: "Tether Gold, a token backed by real gold. Tends to hold up when crypto falls.",
    },
    swings: 3,
    goodFor: "People who believe in Bitcoin long term and can sit through big drops.",
  },
  {
    slug: "earn-and-grow",
    name: "Earn and Grow",
    who: "Half growth, half steady, and two of the four parts earn.",
    mix: [slice("btc", 30), slice("stnear", 20), slice("xaut", 25), slice("gtusdc", 25)],
    idea: "Two halves. Bitcoin and staked NEAR do the growing; gold and dollars keep it level. The NEAR and the dollars earn while they sit.",
    why: {
      btc: "The largest coin, the anchor of the growth half.",
      stnear: "NEAR held as staked NEAR (Meta Pool), so it earns staking rewards while you hold it.",
      xaut: "Tether Gold, a token backed by real gold. Tends to hold up when crypto falls.",
      gtusdc: "Digital dollars that earn interest (USDC lent through Gauntlet on Morpho). Doesn't swing.",
    },
    swings: 2,
    goodFor: "People who want growth but not everything riding on crypto.",
  },
  {
    slug: "steady",
    name: "Steady",
    who: "Gold-heavy and calmer, with cash that earns on the side.",
    mix: [slice("xaut", 50), slice("btc", 25), slice("gtusdc", 25)],
    idea: "Balanced on purpose. Gold and digital dollars keep it level while a little Bitcoin adds upside. The dollars earn interest while they wait.",
    why: {
      xaut: "Half in gold (Tether Gold), the oldest way to store value.",
      btc: "A small slice for growth.",
      gtusdc: "Digital dollars that earn interest (USDC lent through Gauntlet on Morpho). Doesn't swing, and gives Kite something to buy dips with.",
    },
    swings: 1,
    goodFor: "People who'd rather sleep well than chase the top.",
  },
];

export const planBySlug = (slug: string) => PLAN_DATA.find((p) => p.slug === slug);

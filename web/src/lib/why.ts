import { assetByIntentsId } from "./assets";
import type { WhyFacts } from "@/app/api/vault/why/route";

export const WHY_SCHEMA = {
  name: "kite_why",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["because"],
    properties: { because: { type: "string", description: "1-2 plain sentences on why Kite made this trade, restating only the supplied facts" } },
  },
} as const;

export const whyPrompt = [
  "You explain, in plain words, why a portfolio vault made one rebalancing trade. You are given the facts as JSON.",
  "Rule the vault follows: when a holding drifts further from its target share than the allowed band, it sells some of the holding that is most over target and buys the one most under target.",
  "Restate only the supplied facts. Use only numbers that appear in the facts. Do not state the band size or target shares: they are not in the facts. Do not predict prices, give advice, or claim a motive beyond the rule.",
  "Answer only with JSON in the required schema.",
].join("\n");

/** Only what the vault itself logged at the time of the trade. Today's band and targets may differ, so they are left out. */
export type WhyInput = { sell: string; buy: string; overByPts: number };

export function whyInput(f: WhyFacts): WhyInput | null {
  const s = assetByIntentsId(f.sell);
  const b = assetByIntentsId(f.buy);
  if (!s || !b) return null;
  return { sell: s.name, buy: b.name, overByPts: Math.round(f.driftBps / 10) / 10 };
}

/** The same explanation with no model: always correct, used when the model's text cites a number we didn't give it. */
export const whyTemplate = (i: WhyInput) =>
  `${i.sell} had grown ${i.overByPts} points past its target share, beyond the allowed band. Kite sold some of it to buy ${i.buy}, which was furthest under target.`;

export function cleanWhy(raw: unknown, input: WhyInput): { text: string; fromModel: boolean } {
  const text = String((raw as { because?: string }).because ?? "").trim();
  const allowed = new Set([String(input.overByPts)]);
  const cited = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!text || text.length > 400 || cited.some((n) => !allowed.has(n))) return { text: whyTemplate(input), fromModel: false };
  return { text, fromModel: true };
}

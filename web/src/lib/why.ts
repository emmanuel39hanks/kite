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
  "Restate only the supplied facts. Use only numbers that appear in the facts. Do not predict prices, give advice, or claim a motive beyond the rule.",
  "Answer only with JSON in the required schema.",
].join("\n");

export type WhyInput = { sell: string; buy: string; overByPts: number; bandPts: number; sellTargetPct: number | null; buyTargetPct: number | null };

export function whyInput(f: WhyFacts, bandPts: number, targets: Record<string, number>): WhyInput | null {
  const s = assetByIntentsId(f.sell);
  const b = assetByIntentsId(f.buy);
  if (!s || !b) return null;
  return { sell: s.name, buy: b.name, overByPts: Math.round(f.driftBps / 10) / 10, bandPts, sellTargetPct: targets[s.id] ?? null, buyTargetPct: targets[b.id] ?? null };
}

/** The same explanation with no model: always correct, used when the model's text cites a number we didn't give it. */
export const whyTemplate = (i: WhyInput) =>
  `${i.sell} had grown ${i.overByPts} points past its target share, beyond the ${i.bandPts}-point band. Kite sold some of it to buy ${i.buy}, which was furthest under target.`;

export function cleanWhy(raw: unknown, input: WhyInput): { text: string; fromModel: boolean } {
  const text = String((raw as { because?: string }).because ?? "").trim();
  const allowed = new Set([input.overByPts, input.bandPts, input.sellTargetPct, input.buyTargetPct].filter((n) => n !== null).map(String));
  const cited = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!text || text.length > 400 || cited.some((n) => !allowed.has(n))) return { text: whyTemplate(input), fromModel: false };
  return { text, fromModel: true };
}

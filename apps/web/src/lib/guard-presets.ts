import { DEFAULT_GUARDRAILS, type Guardrails } from "@/lib/store";

/** Three starting points for the rules, shared by every screen that sets them. */
export const RULE_PRESETS: { id: string; label: string; text: string; g: Guardrails }[] = [
  { id: "relaxed", label: "Relaxed", text: "Trades rarely. Lets things drift further before stepping in.", g: { driftBand: 10, maxTradePct: 15, slippageBps: 150, tradesPerDay: 2 } },
  { id: "balanced", label: "Balanced", text: "The default. A good fit for most plans.", g: DEFAULT_GUARDRAILS },
  { id: "tight", label: "Tight", text: "Stays close to your shares. Trades more often, in smaller steps.", g: { driftBand: 3, maxTradePct: 5, slippageBps: 75, tradesPerDay: 6 } },
];

export const sameRules = (a: Guardrails, b: Guardrails) => (Object.keys(a) as (keyof Guardrails)[]).every((key) => a[key] === b[key]);

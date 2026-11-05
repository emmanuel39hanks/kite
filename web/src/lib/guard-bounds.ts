import { hasNumber } from "./text-guard";
import type { Guardrails } from "./store";

/**
 * The ranges the app allows for each rule. All sit inside what the vault contract accepts
 * (band 1-20 pts, trade 1-50%, price limit 0.1-5%, 1-24 trades a day), so the contract stays the enforcer.
 */
export const GUARD_BOUNDS: Record<keyof Guardrails, { min: number; max: number; step: number }> = {
  driftBand: { min: 2, max: 20, step: 1 },
  maxTradePct: { min: 1, max: 50, step: 1 },
  slippageBps: { min: 10, max: 300, step: 10 },
  tradesPerDay: { min: 1, max: 12, step: 1 },
};

export const GUARD_KEYS = Object.keys(GUARD_BOUNDS) as (keyof Guardrails)[];

const snap = (key: keyof Guardrails, v: unknown, fallback: number) => {
  const { min, max, step } = GUARD_BOUNDS[key];
  const n = v === null || v === "" || v === undefined ? NaN : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n / step) * step));
};

export const GUARD_SCHEMA = {
  name: "kite_rules",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["intent", "driftBand", "maxTradePct", "slippageBps", "tradesPerDay", "explain"],
    properties: {
      intent: { type: "string", enum: ["more_careful", "more_active", "specific"], description: "more_careful = the person wants the vault to risk less; more_active = trade more freely; specific = they named exact values" },
      driftBand: { type: "integer", minimum: 2, maximum: 20 },
      maxTradePct: { type: "integer", minimum: 1, maximum: 50 },
      slippageBps: { type: "integer", minimum: 10, maximum: 300 },
      tradesPerDay: { type: "integer", minimum: 1, maximum: 12 },
      explain: { type: "string", description: "One or two plain sentences on what changed and why. No digits." },
    },
  },
} as const;

export const guardPrompt = [
  "You adjust the four safety rules of a self-custodied portfolio vault from a plain-English request.",
  "driftBand = how many points a holding may drift from its target before the vault rebalances (smaller = trades more often). maxTradePct = the biggest single swap as % of the portfolio. slippageBps = the most a swap may cost, fees included, in hundredths of a percent (100 = 1%). tradesPerDay = the most trades per day.",
  "You are given the current values. Change only what the request implies and keep the other values as they are.",
  "intent: more_careful if the person wants less risk (lower price limit, smaller trades, fewer trades a day); more_active if they want it to act more freely; specific if they gave exact numbers.",
  "explain: one or two short sentences in plain words, with no digits. You only suggest; the person reviews and saves, and the vault enforces its own hard limits.",
  "Answer only with JSON in the required schema.",
].join("\n");

export type GuardProposal = { rules: Guardrails; intent: "more_careful" | "more_active" | "specific"; explain: string };

/** Clamp to the allowed ranges, and make "more careful" unable to loosen any rule. */
export function cleanProposal(raw: unknown, current: Guardrails): GuardProposal {
  const d = raw as Record<string, unknown>;
  const intent = d.intent === "more_careful" || d.intent === "more_active" ? d.intent : "specific";
  const rules: Guardrails = {
    driftBand: snap("driftBand", d.driftBand, current.driftBand),
    maxTradePct: snap("maxTradePct", d.maxTradePct, current.maxTradePct),
    slippageBps: snap("slippageBps", d.slippageBps, current.slippageBps),
    tradesPerDay: snap("tradesPerDay", d.tradesPerDay, current.tradesPerDay),
  };
  if (intent === "more_careful") {
    rules.maxTradePct = Math.min(rules.maxTradePct, current.maxTradePct);
    rules.slippageBps = Math.min(rules.slippageBps, current.slippageBps);
    rules.tradesPerDay = Math.min(rules.tradesPerDay, current.tradesPerDay);
  }
  return { rules, intent, explain: hasNumber(String(d.explain ?? "")) ? "" : String(d.explain ?? "").slice(0, 300) };
}

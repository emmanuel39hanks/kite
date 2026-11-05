/**
 * Private plan builder: shared pieces (no SDK here, so the server relay can import it).
 *
 * The model only drafts. It picks from Kite's own asset list, its answer is
 * clamped and re-normalised here, and the person still reviews every number in
 * Create before anything is signed. Trades are always decided by the vault's rules.
 */
import { assetById, earnVersionOf, type EarnId } from "@/lib/assets";
import { onlyNumbersFrom } from "@/lib/ai/text-guard";
import { slice, type Slice } from "@/lib/mix";
import type { Guardrails } from "@/lib/store";
import type { Yields } from "@/lib/market/yields";

/** Runs in NEAR AI's attested TEEs and supports end-to-end encryption (checked 2026-11-03). */
export const PLANNER_MODEL = "z-ai/glm-5.3-flash";

const PICKABLE = ["btc", "eth", "sol", "near", "xaut", "usdc"] as const;
type Pickable = (typeof PICKABLE)[number];

export type Draft = {
  name: string;
  summary: string;
  assets: { id: Pickable; weight: number; earn: boolean; why: string }[];
  rules: Guardrails;
  caution: string;
  /** Facts from the supplied statistics that the plan rests on. Numbers in them were checked against that table. */
  basis: string[];
};

/** JSON schema the model must answer in (structured outputs). */
export const DRAFT_SCHEMA = {
  name: "kite_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "summary", "assets", "rules", "caution", "basis"],
    properties: {
      name: { type: "string", description: "Short plan name, 2-4 words" },
      summary: { type: "string", description: "One or two plain sentences on the idea" },
      assets: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "weight", "earn", "why"],
          properties: {
            id: { type: "string", enum: [...PICKABLE] },
            weight: { type: "integer", minimum: 1, maximum: 100 },
            earn: { type: "boolean" },
            why: { type: "string" },
          },
        },
      },
      rules: {
        type: "object",
        additionalProperties: false,
        required: ["driftBand", "maxTradePct", "slippageBps", "tradesPerDay"],
        properties: {
          driftBand: { type: "integer", minimum: 2, maximum: 20 },
          maxTradePct: { type: "integer", minimum: 1, maximum: 50 },
          slippageBps: { type: "integer", minimum: 50, maximum: 300 },
          tradesPerDay: { type: "integer", minimum: 1, maximum: 12 },
        },
      },
      caution: { type: "string", description: "One honest sentence on the main risk" },
      basis: { type: "array", maxItems: 3, items: { type: "string" }, description: "Up to 3 short facts from the supplied statistics that shaped the plan, quoting the numbers exactly" },
    },
  },
} as const;

export function systemPrompt(yields: Yields, ctx?: { stats?: string; current?: string }) {
  const y = (id: EarnId) => (yields[id] ? `${yields[id]!.apy.toFixed(1)}%` : "a variable yield");
  return [
    "You help someone draft a portfolio plan for Kite, a self-custodied app on NEAR that keeps a mix of assets on target by rebalancing.",
    "You only draft. The person reviews and edits every number before anything happens, and Kite's vault contract decides all trades by fixed rules.",
    "Use only these assets (ids): btc (Bitcoin), eth (Ethereum), sol (Solana), near (NEAR), xaut (Tether Gold, one token = one ounce of gold), usdc (USDC, a digital dollar).",
    `Some can earn a yield instead of sitting idle; set earn=true to use it: near → stNEAR, staking (${y("stnear")}); eth → wstETH, staking (${y("wsteth")}); usdc → lent on Morpho (${y("gtusdc")}); sol → lent on Kamino (${y("ksol")}). Earning versions cost about 1-2% to switch in and out, so only use them for money held for months.`,
    "Pick 2 to 5 assets. Weights are whole percentages adding to 100.",
    "Rules: driftBand = points off target before Kite rebalances (3 tight, 5 balanced, 10 relaxed); maxTradePct = biggest single trade as % of the portfolio (5-15 typical); slippageBps = the most a swap may cost, fees included (100 is a sensible default, 150 for relaxed); tradesPerDay (2-6).",
    ctx?.stats ? `Real statistics for the last year, per asset (ret30/ret90 = % return over 30/90 days, volYear = % yearly swing, maxDrawdown = worst % fall, corrBtc = correlation with Bitcoin, -1 to 1): ${ctx.stats}` : "",
    ctx?.current ? `The person's current vault mix, if they have one: ${ctx.current}. Say what you would change and why.` : "",
    "Put every number you rely on in basis (up to 3 short facts), quoting the supplied numbers exactly but in plain words, e.g. \"Bitcoin swung about 43.8% over the year and fell as much as 44.8% from a peak\". Never write field names like volYear or corrBtc. Do not state numbers anywhere else except the weights.",
    "Match risk to what the person says: short time horizons and low tolerance for swings mean more USDC and gold; long horizons and high tolerance can hold more crypto.",
    "Write for a non-expert in plain, short sentences. No hype, no promises of returns. Not financial advice.",
    "Answer only with JSON in the required schema.",
  ].filter(Boolean).join("\n");
}

/** Cut to a length at a sentence end, never mid-word. */
function sentences(s: string, max: number) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return end > 40 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

/** Make whatever came back safe to show: known assets only, weights summing to 100, rules in range. */
export function normalise(raw: unknown, allowed?: Set<string>): { draft: Draft; mix: Slice[] } {
  const d = raw as Partial<Draft>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const seen = new Set<string>();
  const assets = (Array.isArray(d.assets) ? d.assets : [])
    .filter((a) => a && PICKABLE.includes(a.id as Pickable) && !seen.has(a.id) && seen.add(a.id))
    .slice(0, 6)
    .map((a) => ({ id: a.id as Pickable, weight: clamp(a.weight, 1, 100, 10), earn: !!a.earn && !!earnVersionOf(a.id), why: String(a.why ?? "").slice(0, 200) }));
  if (assets.length < 2) throw new Error("The draft didn't include at least two assets Kite can hold. Try describing your goal a little differently.");

  // Weights to exactly 100: scale, floor, hand the remainder to the largest.
  const total = assets.reduce((s, a) => s + a.weight, 0);
  const scaled = assets.map((a) => Math.max(1, Math.floor((a.weight / total) * 100)));
  let left = 100 - scaled.reduce((s, w) => s + w, 0);
  const order = assets.map((_, i) => i).sort((i, j) => assets[j].weight - assets[i].weight);
  for (let k = 0; left !== 0 && k < 400; k++) {
    const i = order[k % order.length];
    if (left > 0) {
      scaled[i]++;
      left--;
    } else if (scaled[i] > 1) {
      scaled[i]--;
      left++;
    }
  }
  assets.forEach((a, i) => (a.weight = scaled[i]));

  const r = (d.rules ?? {}) as Partial<Guardrails>;
  const rules: Guardrails = {
    driftBand: clamp(r.driftBand, 2, 20, 5),
    maxTradePct: clamp(r.maxTradePct, 1, 50, 10),
    slippageBps: clamp(r.slippageBps, 50, 300, 100),
    tradesPerDay: clamp(r.tradesPerDay, 1, 12, 4),
  };
  // Every free-text field may only contain numbers we supplied, the weights, or the rule values.
  const known = allowed ? new Set([...allowed, ...assets.map((a) => String(a.weight)), ...Object.values(rules).map(String)]) : null;
  const clean = (t: string) => (known && !onlyNumbersFrom(t, known) ? "" : t);
  assets.forEach((a) => (a.why = clean(a.why)));
  const draft: Draft = {
    name: String(d.name ?? "My plan").slice(0, 40) || "My plan",
    summary: clean(sentences(String(d.summary ?? ""), 400)),
    assets,
    rules,
    caution: clean(sentences(String(d.caution ?? ""), 420)),
    // Facts the plan rests on: kept only if every number in them is one we supplied.
    basis: (Array.isArray(d.basis) ? d.basis : []).map((b) => String(b).slice(0, 200)).filter((b) => b && clean(b)).slice(0, 3),
  };
  const mix = assets.map((a) => slice(a.earn ? earnVersionOf(a.id)!.id : a.id, a.weight));
  // Sanity: every id must resolve.
  mix.forEach((s) => assetById(s.id));
  return { draft, mix };
}

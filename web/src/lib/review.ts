import type { History } from "./market";
import type { Slice } from "./mix";
import type { Guardrails } from "./store";
import { earnVersionOf } from "./assets";
import type { Yields } from "./yields";

const CRYPTO = new Set(["btc", "eth", "sol", "near", "stnear", "wsteth", "ksol"]);
const SAFE = new Set(["usdc", "xaut", "gtusdc"]);

export type ReviewStats = {
  days: number;
  /** % return of the plan, rebalanced daily to target, over the window. */
  planReturnPct: number;
  /** % return of the same money split once at the target weights and never touched. */
  holdReturnPct: number;
  /** Annualised % standard deviation of daily returns. */
  volatilityPct: number;
  /** Worst peak-to-trough fall, %. */
  maxDrawdownPct: number;
  topAsset: { id: string; weightPct: number };
  cryptoSharePct: number;
  safeSharePct: number;
  /** Largest gap between a holding's weight now and its target, in points. */
  driftNowPts: number;
  /** How often the daily check would have traded with these rules, per year. */
  rebalancesPerYear: number;
  /** Swap cost of those trades per year, as % of the portfolio, at 0.3% a swap. */
  yearlyCostPct: number;
  /** Blended yearly yield of the staked/lent parts, %, at today's rates. */
  earnYieldPct: number;
};

/** Everything here is arithmetic on real daily closes. The model never computes or invents a number. */
export function reviewStats(h: History, plan: Slice[], currentWeights: Record<string, number>, g: Guardrails, yields: Yields): ReviewStats | null {
  const ids = plan.map((s) => s.id);
  const series = ids.map((id) => h.prices[id]);
  if (series.some((p) => !p || p.length < 30)) return null;
  const n = Math.min(...series.map((p) => p.length));
  const w0 = plan.map((s) => s.weight / 100);

  // Daily-rebalanced plan, and buy-and-hold at target weights.
  let plan$ = 1;
  const planCurve = [1];
  const hold = w0.map((w, k) => w / series[k][0]);
  const holdEnd = hold.reduce((a, u, k) => a + u * series[k][n - 1], 0);
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const r = plan.reduce((a, _, k) => a + w0[k] * (series[k][i] / series[k][i - 1] - 1), 0);
    rets.push(r);
    plan$ *= 1 + r;
    planCurve.push(plan$);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  let peak = 1;
  let mdd = 0;
  for (const v of planCurve) {
    peak = Math.max(peak, v);
    mdd = Math.max(mdd, 1 - v / peak);
  }

  // The daily check under this vault's band: when any weight drifts past it, trade back to target.
  let w = [...w0];
  let events = 0;
  let turnover = 0;
  for (let i = 1; i < n; i++) {
    const grown = w.map((x, k) => x * (series[k][i] / series[k][i - 1]));
    const tot = grown.reduce((a, b) => a + b, 0);
    w = grown.map((x) => x / tot);
    const drift = Math.max(...w.map((x, k) => Math.abs(x - w0[k]))) * 100;
    if (drift >= g.driftBand) {
      turnover += w.reduce((a, x, k) => a + Math.abs(x - w0[k]), 0) / 2;
      events++;
      w = [...w0];
    }
  }
  const yrs = (n - 1) / 365;

  const top = [...plan].sort((a, b) => b.weight - a.weight)[0];
  const earnYield = plan.reduce((a, s) => {
    const y = yields[s.id as keyof Yields]?.apy ?? 0;
    return a + (s.weight / 100) * y;
  }, 0);
  const drifts = plan.map((s) => Math.abs((currentWeights[s.id] ?? 0) - s.weight));
  void earnVersionOf;

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    days: n - 1,
    planReturnPct: r1((plan$ - 1) * 100),
    holdReturnPct: r1((holdEnd - 1) * 100),
    volatilityPct: r1(sd * Math.sqrt(365) * 100),
    maxDrawdownPct: r1(mdd * 100),
    topAsset: { id: top.id, weightPct: top.weight },
    cryptoSharePct: r1(plan.filter((s) => CRYPTO.has(s.id)).reduce((a, s) => a + s.weight, 0)),
    safeSharePct: r1(plan.filter((s) => SAFE.has(s.id)).reduce((a, s) => a + s.weight, 0)),
    driftNowPts: r1(Math.max(0, ...drifts)),
    rebalancesPerYear: r1(events / yrs),
    yearlyCostPct: r1((turnover / yrs) * 0.3 * 10) / 10,
    earnYieldPct: r1(earnYield),
  };
}

/** The statements the model may talk about, each tied to one number computed above. */
export const STAT_KEYS = ["plan_return", "hold_return", "volatility", "max_drawdown", "top_asset", "crypto_share", "drift_now", "rebalances", "yearly_cost", "earn_yield"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export function statValue(s: ReviewStats, k: StatKey): string {
  switch (k) {
    case "plan_return": return `${s.planReturnPct >= 0 ? "+" : ""}${s.planReturnPct}% over ${s.days} days`;
    case "hold_return": return `${s.holdReturnPct >= 0 ? "+" : ""}${s.holdReturnPct}% if never rebalanced`;
    case "volatility": return `${s.volatilityPct}% a year`;
    case "max_drawdown": return `-${s.maxDrawdownPct}% worst fall`;
    case "top_asset": return `${s.topAsset.weightPct}% in your largest holding`;
    case "crypto_share": return `${s.cryptoSharePct}% in crypto, ${s.safeSharePct}% in dollars and gold`;
    case "drift_now": return `${s.driftNowPts} points off target now`;
    case "rebalances": return `about ${s.rebalancesPerYear} rebalances a year`;
    case "yearly_cost": return `about ${s.yearlyCostPct}% of the portfolio a year in swap costs`;
    case "earn_yield": return `${s.earnYieldPct}% a year from staking and lending`;
  }
}

export const REVIEW_SCHEMA = {
  name: "kite_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "bullets", "suggestion"],
    properties: {
      verdict: { type: "string", enum: ["ok", "watch", "change"] },
      bullets: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["stat", "text"],
          properties: { stat: { type: "string", enum: [...STAT_KEYS] }, text: { type: "string", description: "One plain sentence about this statistic. No digits." } },
        },
      },
      suggestion: { type: "string", enum: ["none", "raise_band", "lower_max_trade", "add_stable", "reduce_top_asset"] },
    },
  },
} as const;

export const SUGGESTIONS: Record<string, string> = {
  none: "Nothing to change.",
  raise_band: "Consider a wider band, so Kite trades less often.",
  lower_max_trade: "Consider a smaller maximum trade.",
  add_stable: "Consider more dollars or gold to cushion drops.",
  reduce_top_asset: "Consider spreading across more holdings.",
};

export const reviewPrompt = [
  "You review a portfolio plan for Kite, a self-custodied rebalancing app. You are given statistics computed from real price history.",
  "Pick 2 to 4 statistics that matter most and say what each means for a non-expert in one plain sentence. Reference each by its key.",
  "Never write any digit or number in your sentences: the app shows each number itself, next to your sentence. Describe size in words (higher, small, most).",
  "verdict: ok = fine as it is, watch = fine but one thing deserves attention, change = a setting looks off for most people.",
  "suggestion is one fixed option; use none unless a statistic clearly supports it. You never change anything. No hype, no promises, not financial advice.",
  "Answer only with JSON in the required schema.",
].join("\n");

/** Keep only bullets that name a real statistic and contain no digits of their own. */
export function cleanReview(raw: unknown): { verdict: "ok" | "watch" | "change"; bullets: { stat: StatKey; text: string }[]; suggestion: string } {
  const d = raw as { verdict?: string; bullets?: { stat?: string; text?: string }[]; suggestion?: string };
  const bullets = (Array.isArray(d.bullets) ? d.bullets : [])
    .filter((b) => b && (STAT_KEYS as readonly string[]).includes(String(b.stat)) && typeof b.text === "string" && !/\d/.test(b.text))
    .map((b) => ({ stat: b.stat as StatKey, text: String(b.text).slice(0, 240) }))
    .slice(0, 4);
  if (bullets.length < 1) throw new Error("The review didn't come back in a usable form. Try again.");
  return {
    verdict: d.verdict === "watch" || d.verdict === "change" ? d.verdict : "ok",
    bullets,
    suggestion: d.suggestion && d.suggestion in SUGGESTIONS ? d.suggestion : "none",
  };
}

"use client";

/**
 * Console state. The vault on NEAR is the source of truth: plan, limits,
 * balances, key and flags are synced from chain by <LiveSync/>. The browser
 * keeps only what the chain doesn't: your plan's display name, a draft from
 * Create, and a log of actions taken from this console (per account).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Slice } from "./mix";

export type Guardrails = {
  /** Rebalance when any part is this many points off target. */
  driftBand: number;
  /** Largest single trade, as % of the portfolio. */
  maxTradePct: number;
  /** Worst price Kite will accept vs the quote, in basis points. */
  slippageBps: number;
  /** Most trades Kite may make in one day. */
  tradesPerDay: number;
};

export type Portfolio = {
  name: string;
  planSlug: string;
  vault: string;
  target: Slice[];
  /** Current share of value per asset, percent. */
  current: Record<string, number>;
  /** Units held per asset (human units, not base units). */
  units: Record<string, number>;
  value: number;
  /** USDC in the vault that isn't part of the plan yet (new deposits). */
  cash: number;
  paused: boolean;
  pending: { sell: string; buy: string; depositAddress: string } | null;
  /** Net dollars put in, when known (preview tracks it; live vaults don't yet). */
  invested?: number;
  /** Cost basis in dollars per asset, when known. */
  cost?: Record<string, number>;
  /** The vault's own value history, when known. Otherwise charts revalue today's holdings at past prices. */
  series?: { t: number; v: number }[];
  createdAt?: number;
  /** The vault's owner on chain. Usually the connected account; a DAO once it has accepted the vault. */
  owner?: string;
  /** An account the vault has been offered to (propose_owner) and that hasn't accepted yet. */
  pendingOwner?: string | null;
};

export type ActivityEvent = {
  id: string;
  at: number;
  kind: "created" | "deposit" | "trade" | "blocked" | "check" | "guardrails" | "key";
  title: string;
  detail?: string;
  tx?: string;
  /** Preview mode: simulated, priced by a real 1Click dry quote or real past prices. */
  sim?: boolean;
  /** A rebalance made by Kite's key, read from the chain: can be explained on demand. */
  canExplain?: boolean;
};

type NewEvent = Omit<ActivityEvent, "id" | "at"> & { at?: number };

/** The draft keeps its rules: the guardrails in memory reset when a wallet connects or the page reloads. */
type Persisted = { name: string; planSlug: string; activity: ActivityEvent[]; draft: { name: string; mix: Slice[]; rules?: Guardrails } | null };

type State = Persisted & {
  account: string | null;
  /** null until the first chain read finishes; false when no vault exists yet. */
  vaultFound: boolean | null;
  portfolio: Portfolio | null;
  guardrails: Guardrails;
  keyActive: boolean;
};

export const DEFAULT_GUARDRAILS: Guardrails = { driftBand: 5, maxTradePct: 10, slippageBps: 100, tradesPerDay: 4 };

const EMPTY: Persisted = { name: "My plan", planSlug: "custom", activity: [], draft: null };
const keyFor = (account: string | null) => `kite-console:${account ?? "anon"}`;
const uid = () => Math.random().toString(36).slice(2, 10);

type Ctx = State & {
  ready: boolean;
  switchAccount: (account: string | null) => void;
  setDraft: (d: Persisted["draft"]) => void;
  setPlanMeta: (name: string, planSlug: string) => void;
  addEvent: (e: NewEvent) => void;
  addEvents: (list: NewEvent[]) => void;
  clearActivity: () => void;
  setVault: (d: { found: false } | { found: true; portfolio: Portfolio; guardrails: Guardrails; keyActive: boolean }) => void;
  setGuardrails: (g: Guardrails) => void;
};

/** Only the fields we save, and only if they look right: what's in storage is not trusted. */
function pickPersisted(raw: unknown): Partial<Persisted> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<Persisted> = {};
  if (typeof r.name === "string") out.name = r.name.slice(0, 80);
  if (typeof r.planSlug === "string") out.planSlug = r.planSlug.slice(0, 80);
  if (Array.isArray(r.activity)) out.activity = (r.activity as ActivityEvent[]).filter((e) => e && typeof e.id === "string" && typeof e.title === "string" && typeof e.at === "number" && typeof e.kind === "string").slice(0, 200);
  const d = r.draft as { name?: unknown; mix?: unknown; rules?: unknown } | null;
  if (d && typeof d.name === "string" && Array.isArray(d.mix) && d.mix.every((m) => m && typeof (m as Slice).id === "string" && Number.isFinite((m as Slice).weight))) {
    const g = d.rules as Record<string, unknown> | undefined;
    const rulesOk = !!g && (["driftBand", "maxTradePct", "slippageBps", "tradesPerDay"] as const).every((key) => typeof g[key] === "number" && Number.isFinite(g[key]) && (g[key] as number) > 0);
    out.draft = { name: d.name.slice(0, 80), mix: d.mix as Slice[], ...(rulesOk ? { rules: g as unknown as Guardrails } : {}) };
  }
  return out;
}

const KiteContext = createContext<Ctx | null>(null);

export function KiteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    ...EMPTY,
    account: null,
    vaultFound: null,
    portfolio: null,
    guardrails: DEFAULT_GUARDRAILS,
    keyActive: false,
  });
  const [ready, setReady] = useState(false);

  // Load the anonymous draft on first paint, so Create works before connecting.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(keyFor(null));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from storage
      if (raw) setState((s) => ({ ...s, ...pickPersisted(JSON.parse(raw)) }));
    } catch {}
    setReady(true);
  }, []);

  // Persist the per-account bits.
  useEffect(() => {
    if (!ready) return;
    const { name, planSlug, activity, draft } = state;
    try {
      localStorage.setItem(keyFor(state.account), JSON.stringify({ name, planSlug, activity, draft }));
    } catch {}
  }, [state, ready]);

  const switchAccount = useCallback((account: string | null) => {
    setState((s) => {
      if (s.account === account) return s;
      let saved: Partial<Persisted> = {};
      try {
        saved = pickPersisted(JSON.parse(localStorage.getItem(keyFor(account)) ?? "{}"));
      } catch {}
      return {
        ...EMPTY,
        draft: s.draft,
        ...saved,
        account,
        vaultFound: null,
        portfolio: null,
        guardrails: DEFAULT_GUARDRAILS,
        keyActive: false,
      };
    });
  }, []);

  const setDraft = useCallback((draft: Persisted["draft"]) => setState((s) => ({ ...s, draft })), []);
  const setPlanMeta = useCallback((name: string, planSlug: string) => setState((s) => ({ ...s, name, planSlug })), []);
  const addEvents = useCallback(
    (list: NewEvent[]) =>
      setState((s) => ({
        ...s,
        activity: [...list.map((e) => ({ ...e, id: uid(), at: e.at ?? Date.now() })), ...s.activity].sort((a, b) => b.at - a.at).slice(0, 200),
      })),
    [],
  );
  const addEvent = useCallback((e: NewEvent) => addEvents([e]), [addEvents]);
  const clearActivity = useCallback(() => setState((s) => ({ ...s, activity: [] })), []);
  const setVault = useCallback<Ctx["setVault"]>(
    (d) =>
      setState((s) =>
        d.found
          ? { ...s, vaultFound: true, portfolio: { ...d.portfolio, name: d.portfolio.name || s.name, planSlug: d.portfolio.planSlug || s.planSlug }, guardrails: d.guardrails, keyActive: d.keyActive }
          : { ...s, vaultFound: false, portfolio: null },
      ),
    [],
  );
  const setGuardrails = useCallback((guardrails: Guardrails) => setState((s) => ({ ...s, guardrails })), []);

  const value = useMemo<Ctx>(
    () => ({ ...state, ready, switchAccount, setDraft, setPlanMeta, addEvent, addEvents, clearActivity, setVault, setGuardrails }),
    [state, ready, switchAccount, setDraft, setPlanMeta, addEvent, addEvents, clearActivity, setVault, setGuardrails],
  );
  return <KiteContext.Provider value={value}>{children}</KiteContext.Provider>;
}

export function useKite() {
  const ctx = useContext(KiteContext);
  if (!ctx) throw new Error("useKite must be used inside KiteProvider");
  return ctx;
}

/** Drift per asset in points (current − target). */
export const driftOf = (p: Portfolio) => p.target.map((t) => ({ ...t, current: p.current[t.id] ?? 0, drift: (p.current[t.id] ?? 0) - t.weight }));

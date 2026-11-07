"use client";

/**
 * Preview versions of every vault action in useLive(). Same names, same
 * results, nothing signed. Swaps are priced by real 1Click dry quotes.
 */
import { useCallback } from "react";
import { assetById, units, usd } from "@/lib/assets";
import type { History, Market } from "@/lib/market/market";
import type { Slice } from "@/lib/mix";
import {
  applySwap,
  dryQuote,
  fromBase,
  loadPreview,
  navOf,
  nextTrade,
  PREVIEW_VAULT,
  quoteSwap,
  replay,
  resetPreview,
  rowsOf,
  tradesToday,
  updatePreview,
  type DryQuote,
  type PreviewVault,
} from "@/lib/preview/engine";
import { NEAR } from "@/lib/near/config";
import { useKite, type Guardrails } from "@/lib/store";

const sim = { sim: true } as const;
const VAULT_COST = Number(NEAR.vaultStorageNear) + 0.01;
const tick = (id: string) => assetById(id as never).ticker;
const amt = (n: number) => (n >= 1e6 ? units(n) : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 4 : 2 }));

async function livePrices() {
  const r = await fetch("/api/market");
  if (!r.ok) throw new Error("Live prices are unavailable right now. Try again in a minute.");
  const m = (await r.json()) as Market;
  return (id: string) => m.quotes[id]?.price ?? (id === "usdc" ? 1 : 0);
}

function mustVault(): PreviewVault {
  const v = loadPreview().vault;
  if (!v) throw new Error("Create your preview vault first.");
  return v;
}

export type CheckResult = { action: string; dry: boolean; lines: string[]; error?: string };

export function usePreviewActions() {
  const k = useKite();
  const { addEvent, addEvents, setPlanMeta, setGuardrails, clearActivity, activity } = k;

  const createVault = useCallback(
    async (name: string, planSlug: string, mix: Slice[], g: Guardrails) => {
      const s = loadPreview();
      if (s.vault) throw new Error("You already have a preview vault.");
      if ((s.wallet.near ?? 0) < VAULT_COST) throw new Error(`The preview wallet needs ${VAULT_COST} NEAR.`);
      updatePreview((x) => {
        x.wallet.near -= VAULT_COST;
        x.vault = { createdAt: Date.now(), plan: mix, guardrails: g, keyActive: true, paused: false, balances: {}, cash: 0, invested: 0, cost: {}, trades: [], series: [] };
        return x;
      });
      setPlanMeta(name, planSlug);
      addEvent({ ...sim, kind: "created", title: `Vault ${PREVIEW_VAULT} created`, detail: `Preview. ${NEAR.vaultStorageNear} NEAR deposit held, returned when you close it. Kite's key can only rebalance and settle.` });
      return "";
    },
    [addEvent, setPlanMeta],
  );

  const depositFromWallet = useCallback(
    async (usdcBase: bigint) => {
      const n = Number(usdcBase) / 1e6;
      const s = loadPreview();
      mustVault();
      if ((s.wallet.usdc ?? 0) < n) throw new Error(`The preview wallet has ${usd(s.wallet.usdc ?? 0)} USDC.`);
      updatePreview((x) => {
        x.wallet.usdc -= n;
        x.vault!.cash += n;
        x.vault!.invested += n;
        return x;
      });
      addEvent({ ...sim, kind: "deposit", title: `Deposited ${usd(n)} USDC`, detail: "From your NEAR wallet into your vault." });
      return "";
    },
    [addEvent],
  );

  /** A cross-chain deposit that "arrives": credits the USDC a real 1Click dry quote says you'd get. */
  const depositArrived = useCallback(
    async (label: string, q: DryQuote) => {
      mustVault();
      const out = fromBase(q.amountOut, 6);
      updatePreview((x) => {
        x.vault!.cash += out;
        x.vault!.invested += q.amountInUsd;
        return x;
      });
      addEvent({ ...sim, kind: "deposit", title: `Deposit arrived: ${amt(out)} USDC`, detail: `${q.amountInFormatted} from ${label}, swapped through NEAR Intents at a real 1Click quote (${usd(q.amountInUsd - q.amountOutUsd)} cost).` });
    },
    [addEvent],
  );

  /** Split the vault's USDC across the plan, each slice priced by a real 1Click dry quote. */
  const allocate = useCallback(async () => {
    const v = mustVault();
    if (v.cash < 2) throw new Error("There's less than $2 of USDC in your vault to invest.");
    const cash = v.cash;
    const fills: { id: string; dollars: number; units: number; q?: DryQuote }[] = [];
    for (const s of v.plan) {
      const dollars = (cash * s.weight) / 100;
      if (s.id === "usdc") {
        fills.push({ id: s.id, dollars, units: dollars });
        continue;
      }
      if (dollars < 1) continue;
      const q = await dryQuote(NEAR.usdc, assetById(s.id).intentsId!, dollars, 6);
      fills.push({ id: s.id, dollars, units: fromBase(q.amountOut, assetById(s.id).decimals), q });
    }
    const spent = fills.reduce((a, f) => a + f.dollars, 0);
    updatePreview((x) => {
      const vv = x.vault!;
      for (const f of fills) {
        vv.balances[f.id] = (vv.balances[f.id] ?? 0) + f.units;
        vv.cost[f.id] = (vv.cost[f.id] ?? 0) + f.dollars;
      }
      vv.cash -= spent;
      return x;
    });
    const got = fills.filter((f) => f.q).map((f) => `${amt(f.units)} ${tick(f.id)}`);
    const fee = fills.reduce((a, f) => a + (f.q ? f.q.amountInUsd - f.q.amountOutUsd : 0), 0);
    addEvent({ ...sim, kind: "trade", title: `Invested ${usd(spent)} into your plan`, detail: `${got.join(", ")}. Real 1Click quotes, ${usd(fee)} total swap cost.` });
    return "";
  }, [addEvent]);

  /** Invest as if you'd started `days` ago: real daily closes, Kite's daily check replayed with your guardrails. */
  const investAsOf = useCallback(
    async (days: 30 | 90 | 365) => {
      const v = mustVault();
      if (v.cash < 2) throw new Error("There's less than $2 of USDC in your vault to invest.");
      if (Object.values(v.balances).some((b) => b > 0)) throw new Error("Back-dating only works on a vault that hasn't invested yet. Restart the preview to try it.");
      const r = await fetch(`/api/history?days=${days}`);
      if (!r.ok) throw new Error("Price history is unavailable right now. Try again in a minute.");
      const h = (await r.json()) as History;
      let events: ReturnType<typeof replay> = [];
      updatePreview((x) => {
        events = replay(x.vault!, h);
        return x;
      });
      // The vault was "created" and funded just before the replay starts, so move those events back too.
      const start = events[0]?.at ?? Date.now();
      const earlier = activity.map((e) => (e.sim && (e.kind === "created" || e.kind === "deposit") ? { ...e, at: start - (e.kind === "created" ? 2 : 1) * 3600_000 } : e));
      clearActivity();
      addEvents([...earlier, ...events.map((e) => ({ ...e, ...sim }))]);
      return "";
    },
    [addEvents, clearActivity, activity],
  );

  const saveGuardrails = useCallback(
    async (g: Guardrails) => {
      mustVault();
      updatePreview((x) => ((x.vault!.guardrails = g), x));
      setGuardrails(g);
      addEvent({ ...sim, kind: "guardrails", title: "Guardrails updated", detail: `Steps in at ${g.driftBand} pts, max trade ${g.maxTradePct}%, ${(g.slippageBps / 100).toFixed(2)}% price limit, ${g.tradesPerDay} trades a day.` });
      return "";
    },
    [addEvent, setGuardrails],
  );

  /** New target shares for the same assets. */
  const savePlan = useCallback(
    async (mix: Slice[]) => {
      mustVault();
      updatePreview((x) => ((x.vault!.plan = mix), x));
      addEvent({ ...sim, kind: "guardrails", title: "Target mix updated", detail: mix.map((s) => `${assetById(s.id).ticker} ${s.weight}%`).join(", ") });
      return "";
    },
    [addEvent],
  );

  const setKey = useCallback(
    async (on: boolean) => {
      mustVault();
      updatePreview((x) => ((x.vault!.keyActive = on), x));
      addEvent({ ...sim, kind: "key", title: on ? "Kite's key restored" : "Kite's key revoked", detail: on ? "A new rebalance-only key was added." : "Deleted from your vault. Kite can't trade." });
      return "";
    },
    [addEvent],
  );
  const revoke = useCallback(() => setKey(false), [setKey]);
  const restoreKey = useCallback(() => setKey(true), [setKey]);

  const unpause = useCallback(async () => {
    mustVault();
    updatePreview((x) => ((x.vault!.paused = false), x));
    addEvent({ ...sim, kind: "key", title: "Vault unpaused" });
    return "";
  }, [addEvent]);

  /** Kite's daily check, now: live prices, the contract's rules, and a real 1Click dry quote for the trade. */
  const checkNow = useCallback(async (): Promise<CheckResult> => {
    const lines: string[] = [];
    const done = (action: string, kind: "check" | "trade" | "blocked", title: string, detail: string) => {
      lines.push(detail);
      addEvent({ ...sim, kind, title, detail });
      return { action, dry: true, lines };
    };
    try {
      const v = mustVault();
      const price = await livePrices();
      const { rows } = rowsOf(v.plan, v.balances, price);
      const worst = rows.reduce((a, r) => (Math.abs(r.drift) > Math.abs(a.drift) ? r : a), rows[0]);
      lines.push(`Drift: ${rows.map((r) => `${tick(r.id)} ${r.drift >= 0 ? "+" : ""}${r.drift.toFixed(1)}`).join(", ")} pts`);
      if (v.paused) return done("paused", "blocked", "Check skipped: vault paused", "ERR_PAUSED: the vault is paused, so Kite can't trade.");
      if (!v.keyActive) return done("no-key", "blocked", "Check skipped: key revoked", "ERR_NO_AGENT: Kite's key has been revoked.");
      const t = nextTrade(v.plan, v.balances, price, v.guardrails);
      if (!t)
        return done("none", "check", "Checked: on plan", `Largest drift ${worst ? Math.abs(worst.drift).toFixed(1) : "0"} pts, inside your ${v.guardrails.driftBand}-pt band. No trade.`);
      if (tradesToday(v) >= v.guardrails.tradesPerDay)
        return done("blocked", "blocked", "Trade refused by your vault", `ERR_RATE: already made ${v.guardrails.tradesPerDay} trades today.`);
      const { out } = await quoteSwap(t.sell.id, t.buy.id, t.units);
      const fair = t.valueUsd / t.buy.price;
      // Same rule as the vault: the widest of the global limit and the two assets' own limits.
      const limitBps = Math.max(v.guardrails.slippageBps, assetById(t.sell.id as never).slippageBps ?? 0, assetById(t.buy.id as never).slippageBps ?? 0);
      const floor = fair * (1 - limitBps / 10_000);
      if (out < floor)
        return done(
          "blocked",
          "blocked",
          "Trade refused by your vault",
          `ERR_SLIPPAGE: quote gives ${amt(out)} ${tick(t.buy.id)}, your ${(limitBps / 100).toFixed(2)}% limit needs at least ${amt(floor)}.`,
        );
      updatePreview((x) => {
        applySwap(x.vault!, t.sell.id, t.units, t.buy.id, out);
        x.vault!.trades.push(Date.now());
        return x;
      });
      return done(
        "rebalanced",
        "trade",
        `Rebalanced: sold ${usd(t.valueUsd)} of ${tick(t.sell.id)} for ${tick(t.buy.id)}`,
        `${amt(t.units)} ${tick(t.sell.id)} → ${amt(out)} ${tick(t.buy.id)} at a real 1Click quote (${((1 - out / fair) * 100).toFixed(2)}% under market, limit ${(limitBps / 100).toFixed(2)}%).`,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      addEvent({ ...sim, kind: "blocked", title: "Check failed", detail: error });
      return { action: "error", dry: true, lines, error };
    }
  }, [addEvent]);

  const heldTokens = useCallback(async () => {
    const v = loadPreview().vault;
    if (!v) return [];
    const out = Object.entries(v.balances).map(([id, units]) => ({ token: assetById(id as never).intentsId ?? id, amount: BigInt(Math.round(units * 1e6)) }));
    out.push({ token: NEAR.usdc, amount: BigInt(Math.round(v.cash * 1e6)) });
    return out;
  }, []);

  const withdrawAll = useCallback(async () => {
    const v = mustVault();
    const held = Object.entries(v.balances).filter(([, u]) => u > 0);
    if (!held.length && v.cash <= 0) throw new Error("The vault is already empty.");
    const price = await livePrices().catch(() => null);
    const value = price ? navOf(v, price) : null;
    updatePreview((x) => {
      const vv = x.vault!;
      for (const [id, u] of Object.entries(vv.balances)) x.wallet[id] = (x.wallet[id] ?? 0) + u;
      x.wallet.usdc = (x.wallet.usdc ?? 0) + vv.cash;
      vv.balances = {};
      vv.cost = {};
      vv.cash = 0;
      vv.invested = 0;
      return x;
    });
    addEvent({ ...sim, kind: "deposit", title: "Withdrew everything", detail: `${held.length + (v.cash > 0 ? 1 : 0)} assets${value ? ` worth ${usd(value)}` : ""} moved to your NEAR Intents account.` });
    return "";
  }, [addEvent]);

  const closeVault = useCallback(async () => {
    const v = mustVault();
    if (Object.values(v.balances).some((u) => u > 0) || v.cash > 0) throw new Error("Withdraw everything first. The vault refuses to close while it holds money.");
    updatePreview((x) => {
      x.wallet.near += Number(NEAR.vaultStorageNear);
      x.vault = null;
      return x;
    });
    addEvent({ ...sim, kind: "key", title: "Vault closed", detail: `${PREVIEW_VAULT} was deleted and its ${NEAR.vaultStorageNear} NEAR deposit returned.` });
    return "";
  }, [addEvent]);

  /** Start the preview over: fresh wallet, no vault, empty activity. */
  const restart = useCallback(() => {
    resetPreview();
    clearActivity();
  }, [clearActivity]);

  return {
    vault: PREVIEW_VAULT,
    createVault,
    depositFromWallet,
    depositArrived,
    allocate,
    investAsOf,
    saveGuardrails,
    savePlan,
    revoke,
    restoreKey,
    unpause,
    checkNow,
    withdrawAll,
    closeVault,
    heldTokens,
    restart,
  };
}

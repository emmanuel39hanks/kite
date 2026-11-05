"use client";

/**
 * The console's link to the vault on NEAR.
 * - <LiveSync/> follows the connected wallet, looks for kite.<account>, and
 *   keeps the store in sync with the chain every 15 s.
 * - useLive() gives pages the real actions: create, deposit, invest, save
 *   guardrails, revoke/restore the key, unpause, check now.
 */
import { useCallback, useEffect, useRef } from "react";
import { JsonRpcProvider } from "near-api-js";
import { assetById, assetByIntentsId } from "@/lib/assets";
import { slice, type Slice } from "@/lib/mix";
import { useKite, type Guardrails } from "@/lib/store";
import { useMarket } from "@/lib/use-market";
import { loadPreview, onPreviewChange, PREVIEW_VAULT, rowsOf, savePreview } from "@/lib/preview";
import { usePreviewActions } from "@/lib/preview-actions";
import { NEAR, vaultIdFor } from "./config";
import { createVaultActions, depositUsdcFromWallet, ownerCall, readVault, toContractLimits, vaultExists } from "./vault";
import { useWallet } from "./wallet";

const provider = new JsonRpcProvider({ url: NEAR.rpc });
const intentsBalance = async (account: string, token: string): Promise<bigint> =>
  BigInt((await provider.callFunction({ contractId: NEAR.intents, method: "mt_balance_of", args: { account_id: account, token_id: token } })) as string);

export function LiveSync() {
  const w = useWallet();
  const k = useKite();
  const { price, source, updatedAt } = useMarket();
  const priceRef = useRef(price);
  useEffect(() => {
    priceRef.current = price;
  }, [price]);
  const pricesLive = source !== "fallback";

  useEffect(() => {
    if (w.ready) k.switchAccount(w.accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.ready, w.accountId]);

  const vault = k.account && !w.preview ? vaultIdFor(k.account) : null;
  const { setVault } = k;

  // Preview: the vault lives in this browser; value it at live prices whenever either changes.
  const previewOn = w.preview && !!k.account;
  useEffect(() => {
    if (!previewOn) return;
    const tick = () => {
      const s = loadPreview();
      const v = s.vault;
      if (!v) return setVault({ found: false });
      const { rows, nav } = rowsOf(v.plan, v.balances, priceRef.current);
      const value = nav + v.cash;
      const last = v.series[v.series.length - 1];
      // One stored point every 6 hours keeps the chart honest without growing storage.
      if (pricesLive && value > 0 && (!last || Date.now() - last.t > 6 * 3600_000)) {
        v.series.push({ t: Date.now(), v: value });
        savePreview(s);
        return; // the save re-runs tick through onPreviewChange
      }
      setVault({
        found: true,
        keyActive: v.keyActive,
        guardrails: v.guardrails,
        portfolio: {
          name: "",
          planSlug: "",
          vault: PREVIEW_VAULT,
          target: v.plan,
          current: Object.fromEntries(rows.map((r) => [r.id, r.weight])),
          units: Object.fromEntries(v.plan.map((s) => [s.id, v.balances[s.id] ?? 0])),
          value,
          cash: v.cash,
          paused: v.paused,
          pending: null,
          invested: v.invested,
          cost: v.cost,
          series: v.series,
          createdAt: v.createdAt,
        },
      });
    };
    tick();
    const off = onPreviewChange(tick);
    const t = setInterval(tick, 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [previewOn, setVault, pricesLive, updatedAt]);

  useEffect(() => {
    if (!vault) return;
    let alive = true;
    const tick = async () => {
      if (!(await vaultExists(vault))) {
        if (alive) setVault({ found: false });
        return;
      }
      const s = await readVault(vault);
      const usdcOutside = s.plan.some((t) => t.token === NEAR.usdc) ? 0n : await intentsBalance(vault, NEAR.usdc).catch(() => 0n);
      if (!alive) return;
      const target: Slice[] = [];
      const units: Record<string, number> = {};
      const values: number[] = [];
      s.plan.forEach((t, i) => {
        const a = assetByIntentsId(t.token);
        if (!a) return;
        target.push(slice(a.id, t.target_bps / 100));
        units[a.id] = Number(s.balances[i]) / 10 ** t.decimals;
        values.push(units[a.id] * priceRef.current(a.id));
      });
      const cash = Number(usdcOutside) / 1e6;
      const nav = values.reduce((x, y) => x + y, 0);
      const current = Object.fromEntries(target.map((t, i) => [t.id, nav > 0 ? (values[i] / nav) * 100 : 0]));
      const guardrails: Guardrails = {
        driftBand: s.limits.band_bps / 100,
        maxTradePct: s.limits.max_trade_bps / 100,
        slippageBps: s.limits.max_slippage_bps,
        tradesPerDay: s.limits.max_trades_per_day,
      };
      const p = s.status.pending;
      setVault({
        found: true,
        keyActive: !!s.status.agent,
        guardrails,
        portfolio: {
          name: "",
          planSlug: "",
          vault,
          target,
          current,
          units,
          value: nav + cash,
          cash,
          paused: s.status.paused,
          pending: p ? { sell: p.sell, buy: p.buy, depositAddress: p.deposit_address } : null,
        },
      });
    };
    tick().catch(() => {});
    const t = setInterval(() => tick().catch(() => {}), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [vault, setVault]);

  return null;
}

export function useLive() {
  const w = useWallet();
  const real = useRealLive();
  const preview = usePreviewActions();
  if (w.preview) return { ...preview, preview: true as const };
  return { ...real, preview: false as const };
}

function useRealLive() {
  const w = useWallet();
  const k = useKite();
  const vault = k.account ? vaultIdFor(k.account) : "";

  const createVault = useCallback(
    async (name: string, planSlug: string, mix: Slice[], g: Guardrails) => {
      if (!k.account) throw new Error("Connect a NEAR wallet first");
      const hash = await w.send(vault, await createVaultActions(k.account, vault, mix, g));
      k.setPlanMeta(name, planSlug);
      k.addEvent({ kind: "created", title: `Vault ${vault} created`, detail: "Kite's key can only call rebalance and settle.", tx: hash });
      return hash;
    },
    [k, w, vault],
  );

  const depositFromWallet = useCallback(
    async (usdcBase: bigint) => {
      const hash = await w.send(NEAR.usdcContract, [depositUsdcFromWallet(vault, usdcBase)]);
      k.addEvent({ kind: "deposit", title: `Deposited ${(Number(usdcBase) / 1e6).toFixed(2)} USDC`, detail: "From your NEAR wallet into your vault.", tx: hash });
      return hash;
    },
    [k, w, vault],
  );

  /** Split the vault's USDC across the plan: quotes from the server, one owner signature. */
  const allocate = useCallback(async () => {
    const usdc = await intentsBalance(vault, NEAR.usdc);
    if (usdc < 2_000_000n) throw new Error("There's less than $2 of USDC in your vault to invest.");
    const plan = (k.portfolio?.target ?? []).map((t) => ({ token: assetById(t.id).intentsId ?? "", target_bps: Math.round(t.weight * 100) }));
    const r = await fetch("/api/allocate/quotes", { method: "POST", body: JSON.stringify({ vault, usdc: usdc.toString(), plan }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Couldn't get quotes");
    const transfers = (d.transfers as { token: string; amount: string; to: string }[]).map(({ token, amount, to }) => ({ token, amount, to }));
    // The owner signs these, and they came from a server: make sure they only spend USDC, no more than the vault holds, to deposit-looking addresses.
    const spend = transfers.reduce((n, t) => n + BigInt(/^\d{1,30}$/.test(t.amount) ? t.amount : "0"), 0n);
    const sane =
      transfers.length >= 1 &&
      transfers.length <= plan.length &&
      spend <= usdc &&
      transfers.every((t) => t.token === NEAR.usdc && /^[a-z0-9._-]{8,64}$/.test(t.to) && t.to !== k.account && t.to !== vault);
    if (!sane) throw new Error("The swap quotes didn't look right, so nothing was signed. Try again in a moment.");
    const hash = await w.send(vault, [ownerCall("allocate", { transfers })]);
    k.addEvent({ kind: "trade", title: `Invested ${(Number(usdc) / 1e6).toFixed(2)} USDC`, detail: `${transfers.length} swaps into your plan through NEAR Intents.`, tx: hash });
    return hash;
  }, [k, w, vault]);

  const saveGuardrails = useCallback(
    async (g: Guardrails) => {
      const hash = await w.send(vault, [ownerCall("set_limits", { limits: toContractLimits(g) })]);
      k.setGuardrails(g);
      k.addEvent({ kind: "guardrails", title: "Guardrails updated", detail: `Steps in at ${g.driftBand} pts, max trade ${g.maxTradePct}%, ${(g.slippageBps / 100).toFixed(2)}% price limit, ${g.tradesPerDay} trades a day.`, tx: hash });
      return hash;
    },
    [k, w, vault],
  );

  const revoke = useCallback(async () => {
    const hash = await w.send(vault, [ownerCall("revoke_agent", {})]);
    k.addEvent({ kind: "key", title: "Kite's key revoked", detail: "Deleted from your vault. Kite can't trade.", tx: hash });
    return hash;
  }, [k, w, vault]);

  const restoreKey = useCallback(async () => {
    const hash = await w.send(vault, [ownerCall("set_agent", { public_key: NEAR.agentPublicKey, allowance_yocto: "250000000000000000000000" })]);
    k.addEvent({ kind: "key", title: "Kite's key restored", detail: "A new rebalance-only key was added.", tx: hash });
    return hash;
  }, [k, w, vault]);

  const unpause = useCallback(async () => {
    const hash = await w.send(vault, [ownerCall("unpause", {})]);
    k.addEvent({ kind: "key", title: "Vault unpaused", tx: hash });
    return hash;
  }, [k, w, vault]);

  /** Every token the vault might hold: the plan plus USDC from deposits. */
  const heldTokens = useCallback(async () => {
    const s = await readVault(vault);
    const tokens = s.plan.map((t) => t.token);
    const balances = [...s.balances];
    if (!tokens.includes(NEAR.usdc)) {
      tokens.push(NEAR.usdc);
      balances.push(await intentsBalance(vault, NEAR.usdc).catch(() => 0n));
    }
    return tokens.map((token, i) => ({ token, amount: balances[i] }));
  }, [vault]);

  /** Move everything in the vault to the owner's own NEAR Intents account, in one signature. */
  const withdrawAll = useCallback(async () => {
    if (!k.account) throw new Error("Connect a NEAR wallet first");
    const held = (await heldTokens()).filter((h) => h.amount > 0n);
    if (!held.length) throw new Error("The vault is already empty.");
    const hash = await w.send(
      vault,
      held.map((h) => ownerCall("withdraw", { token: h.token, amount: h.amount.toString(), receiver_id: k.account }, 40n)),
    );
    k.addEvent({ kind: "deposit", title: "Withdrew everything", detail: `${held.length} assets moved to your NEAR Intents account (${k.account}).`, tx: hash });
    return hash;
  }, [k, w, vault, heldTokens]);

  /** Delete the vault and return its NEAR deposit. The contract refuses unless every balance is zero. */
  const closeVault = useCallback(async () => {
    const left = (await heldTokens()).filter((h) => h.amount > 0n);
    if (left.length) throw new Error("Withdraw everything first. The vault refuses to close while it holds money.");
    const hash = await w.send(vault, [ownerCall("close_vault", { also_check: [NEAR.usdc] }, 150n)]);
    k.addEvent({ kind: "key", title: "Vault closed", detail: `${vault} was deleted and its NEAR deposit returned to you.`, tx: hash });
    return hash;
  }, [k, w, vault, heldTokens]);

  const checkNow = useCallback(async () => {
    const r = await fetch("/api/vault/check", { method: "POST", body: JSON.stringify({ vault }) });
    const d = (await r.json()) as { action?: string; dry?: boolean; lines?: string[]; error?: string };
    k.addEvent({
      kind: d.action === "rebalanced" ? "trade" : d.error ? "blocked" : "check",
      title: d.error ? "Check failed" : d.action === "none" ? "Checked: on plan" : d.action === "rebalanced" ? "Rebalanced" : `Checked: ${d.action}`,
      detail: d.error ?? d.lines?.slice(-1)[0],
    });
    return d;
  }, [k, vault]);

  return { vault, createVault, depositFromWallet, allocate, saveGuardrails, revoke, restoreKey, unpause, checkNow, withdrawAll, closeVault };
}

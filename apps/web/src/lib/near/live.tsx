"use client";

/**
 * The console's link to the vault on NEAR.
 * - <LiveSync/> follows the connected wallet, finds its vault (see my-vault.ts), and
 *   keeps the store in sync with the chain every 15 s.
 * - useLive() gives pages the real actions: create, deposit, invest, save
 *   guardrails, revoke/restore the key, unpause, check now.
 */
import { useCallback, useEffect, useRef } from "react";
import type { Action } from "@near-js/transactions";
import { JsonRpcProvider } from "near-api-js";
import { assetById, assetByIntentsId } from "@/lib/assets";
import { slice, type Slice } from "@/lib/mix";
import { useKite, type Guardrails } from "@/lib/store";
import { useMarket } from "@/lib/market/use-market";
import { loadPreview, onPreviewChange, PREVIEW_VAULT, rowsOf, savePreview } from "@/lib/preview/engine";
import { usePreviewActions } from "@/lib/preview/actions";
import { verifyAllocation, type Transfer } from "./allocate-check";
import { NEAR } from "./config";
import { createVaultArgs, factoryDepositYocto, isFactoryVault } from "./factory";
import { refreshMyVault, useMyVault } from "./my-vault";
import { actionCreators } from "@near-js/transactions";
import { foreignOwner, notOwnerMessage } from "./dao-view";
import { ALLOCATE_TGAS_EACH, agentAllowanceYocto, allocateCalls, depositUsdcFromWallet, fromContractLimits, ownerCall, readVault, toContractLimits, vaultExists } from "./vault";
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

  const mine = useMyVault(k.account && !w.preview ? k.account : null);
  const vault = mine?.vault ?? null;
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
      const guardrails = fromContractLimits(s.limits);
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
          owner: s.status.owner,
          pendingOwner: s.status.pending_owner ?? null,
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
  const mine = useMyVault(k.account);
  const vault = mine?.vault ?? "";
  // Once a DAO owns the vault, this wallet's owner calls would only fail on chain. Stop them here with the reason.
  const ownedBy = foreignOwner(k.portfolio?.owner, k.account);
  const ownerSend = useCallback(
    (actions: Action[]) => {
      if (ownedBy) throw new Error(notOwnerMessage(ownedBy));
      return w.send(vault, actions);
    },
    [w, vault, ownedBy],
  );

  const createVault = useCallback(
    async (name: string, planSlug: string, mix: Slice[], g: Guardrails) => {
      if (!k.account) throw new Error("Connect a NEAR wallet first");
      if (!mine) throw new Error("Still looking up your vault. Try again in a moment.");
      if (mine.exists) throw new Error(`You already have a vault: ${mine.vault}`);
      if (!isFactoryVault(vault)) throw new Error("Couldn't pick a name for your vault");
      // Kite's factory deploys the vault and makes this wallet its owner. Wallets like Meteor won't let an app
      // deploy code to the user's own account, but a function call to the factory is an ordinary transaction.
      const vaultName = vault.slice(0, -(NEAR.factory.length + 1));
      const hash = await w.send(NEAR.factory, [actionCreators.functionCall("create_vault", createVaultArgs(vaultName, mix, g), 200n * 10n ** 12n, factoryDepositYocto())]);
      // The factory refunds the deposit if creation fails, and the transaction itself still succeeds, so check.
      let made = false;
      for (let i = 0; i < 12 && !made; i++) {
        made = await vaultExists(vault);
        if (!made) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!made) {
        refreshMyVault(k.account);
        throw new Error(`The vault wasn't created. Your ${NEAR.factoryDepositNear} NEAR goes back to your wallet; if it hasn't in a few minutes, the factory holds it for you to claim.`);
      }
      refreshMyVault(k.account, { vault, exists: true });
      k.setPlanMeta(name, planSlug);
      k.addEvent({ kind: "created", title: `Vault ${vault} created`, detail: "Kite's key can only call rebalance and settle.", tx: hash });
      return hash;
    },
    [k, w, vault, mine],
  );

  const depositFromWallet = useCallback(
    async (usdcBase: bigint) => {
      // Money sent to a vault someone else owns becomes theirs; this wallet couldn't take it back.
      if (ownedBy) throw new Error(`${notOwnerMessage(ownedBy)} Money sent to it would belong to ${ownedBy}.`);
      const hash = await w.send(NEAR.usdcContract, [depositUsdcFromWallet(vault, usdcBase)]);
      k.addEvent({ kind: "deposit", title: `Deposited ${(Number(usdcBase) / 1e6).toFixed(2)} USDC`, detail: "From your NEAR wallet into your vault.", tx: hash });
      return hash;
    },
    [k, w, vault, ownedBy],
  );

  /** Split the vault's USDC across the plan: quotes from the server, one owner signature. */
  const allocate = useCallback(async () => {
    const usdc = await intentsBalance(vault, NEAR.usdc);
    if (usdc < 500_000n) throw new Error("There's less than $0.50 of USDC in your vault to invest.");
    const plan = (k.portfolio?.target ?? []).map((t) => ({ token: assetById(t.id).intentsId ?? "", target_bps: Math.round(t.weight * 100) }));
    const r = await fetch("/api/allocate/quotes", { method: "POST", body: JSON.stringify({ vault, usdc: usdc.toString(), plan }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Couldn't get quotes");
    const quoted = d.transfers as Transfer[];
    // The owner signs these, and they came from a server: check each swap address with NEAR Intents itself first.
    await verifyAllocation({ transfers: quoted, plan, usdc, usdcToken: NEAR.usdc, vault });
    const transfers = quoted.map(({ token, amount, to }) => ({ token, amount, to }));
    const hash = await ownerSend(allocateCalls(transfers).map((c) => ownerCall(c.method, c.args, ALLOCATE_TGAS_EACH)));
    k.addEvent({ kind: "trade", title: `Invested ${(Number(usdc) / 1e6).toFixed(2)} USDC`, detail: `${transfers.length} swaps into your plan through NEAR Intents.`, tx: hash });
    return hash;
  }, [k, ownerSend, vault]);

  const saveGuardrails = useCallback(
    async (g: Guardrails) => {
      const hash = await ownerSend([ownerCall("set_limits", { limits: toContractLimits(g) })]);
      k.setGuardrails(g);
      k.addEvent({ kind: "guardrails", title: "Guardrails updated", detail: `Steps in at ${g.driftBand} pts, max trade ${g.maxTradePct}%, ${(g.slippageBps / 100).toFixed(2)}% price limit, ${g.tradesPerDay} trades a day.`, tx: hash });
      return hash;
    },
    [k, ownerSend],
  );

  const revoke = useCallback(async () => {
    const hash = await ownerSend([ownerCall("revoke_agent", {})]);
    k.addEvent({ kind: "key", title: "Kite's key revoked", detail: "Deleted from your vault. Kite can't trade.", tx: hash });
    return hash;
  }, [k, ownerSend]);

  const restoreKey = useCallback(async () => {
    const hash = await ownerSend([ownerCall("set_agent", { public_key: NEAR.agentPublicKey, allowance_yocto: agentAllowanceYocto() })]);
    k.addEvent({ kind: "key", title: "Kite's key restored", detail: "A new rebalance-only key was added.", tx: hash });
    return hash;
  }, [k, ownerSend]);

  const unpause = useCallback(async () => {
    const hash = await ownerSend([ownerCall("unpause", {})]);
    k.addEvent({ kind: "key", title: "Vault unpaused", tx: hash });
    return hash;
  }, [k, ownerSend]);

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
    const hash = await ownerSend(
      held.map((h) => ownerCall("withdraw", { token: h.token, amount: h.amount.toString(), receiver_id: k.account }, 40n)),
    );
    k.addEvent({ kind: "deposit", title: "Withdrew everything", detail: `${held.length} assets moved to your NEAR Intents account (${k.account}).`, tx: hash });
    return hash;
  }, [k, ownerSend, heldTokens]);

  /** Delete the vault and return its NEAR deposit. The contract refuses unless every balance is zero. */
  const closeVault = useCallback(async () => {
    const left = (await heldTokens()).filter((h) => h.amount > 0n);
    if (left.length) throw new Error("Withdraw everything first. The vault refuses to close while it holds money.");
    const hash = await ownerSend([ownerCall("close_vault", { also_check: [NEAR.usdc] }, 150n)]);
    k.addEvent({ kind: "key", title: "Vault closed", detail: `${vault} was deleted and its NEAR deposit returned to you.`, tx: hash });
    if (k.account) refreshMyVault(k.account);
    return hash;
  }, [k, ownerSend, vault, heldTokens]);

  const checkNow = useCallback(async () => {
    const r = await fetch("/api/vault/check", { method: "POST", body: JSON.stringify({ vault }) });
    const d = (await r.json()) as { action?: string; dry?: boolean; lines?: string[]; error?: string };
    k.addEvent({
      kind: d.error ? "blocked" : "check",
      // This is always a dry check: it shows what Kite would do. The daily run (or the keeper CLI) does the trading.
      title: d.error ? "Check failed" : d.action === "none" ? "Checked: on plan" : d.action === "dry" ? "Checked: a trade is due" : d.action === "skipped" ? "Checked: a trade is due but costs too much" : d.action === "paused" ? "Checked: vault is paused" : `Checked: ${d.action}`,
      detail: d.error ?? (d.action === "dry" ? "Kite would trade now. The daily run does it, or run the keeper yourself." : d.lines?.slice(-1)[0]),
    });
    return d;
  }, [k, vault]);

  return { vault, createVault, depositFromWallet, allocate, saveGuardrails, revoke, restoreKey, unpause, checkNow, withdrawAll, closeVault };
}

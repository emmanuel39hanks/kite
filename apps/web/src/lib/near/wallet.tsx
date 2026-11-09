"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { Action } from "@near-js/transactions";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PREVIEW_ACCOUNT } from "@/lib/preview/engine";
import { NEAR } from "./config";

type WalletCtx = {
  ready: boolean;
  accountId: string | null;
  /** Preview mode: a stand-in account, nothing is ever signed. */
  preview: boolean;
  startPreview: () => void;
  exitPreview: () => void;
  signIn: () => void;
  signOut: () => Promise<void>;
  /** Sign and send one transaction; returns the transaction hash. */
  send: (receiverId: string, actions: Action[]) => Promise<string>;
};

const PREVIEW_FLAG = "kite-preview-on";
const Ctx = createContext<WalletCtx | null>(null);

/**
 * NEAR Wallet Selector with injected wallets only (HOT, Meteor, Intear, Sender, Nightly, OKX).
 * Redirect wallets are left out: the vault-creation transaction carries the
 * 180 KB contract, which is too large to pass through a URL.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const selectorRef = useRef<WalletSelector | null>(null);
  const modalRef = useRef<{ show: () => void } | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from storage
      setPreview(localStorage.getItem(PREVIEW_FLAG) === "1");
    } catch {}
  }, []);
  const startPreview = useCallback(() => {
    try {
      localStorage.setItem(PREVIEW_FLAG, "1");
    } catch {}
    setPreview(true);
  }, []);
  const exitPreview = useCallback(() => {
    try {
      localStorage.removeItem(PREVIEW_FLAG);
    } catch {}
    setPreview(false);
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const [core, modal, hot, meteor, intear, sender, nightly, okx] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/intear-wallet"),
        import("@near-wallet-selector/sender"),
        import("@near-wallet-selector/nightly"),
        import("@near-wallet-selector/okx-wallet"),
      ]);
      const { setupWalletSelector } = core;
      const { setupModal } = modal;
      const selector = await setupWalletSelector({
        network: NEAR.networkId,
        fallbackRpcUrls: NEAR.rpcs,
        modules: [hot.setupHotWallet(), meteor.setupMeteorWallet(), intear.setupIntearWallet(), sender.setupSender(), nightly.setupNightly(), okx.setupOKXWallet()],
      });
      selectorRef.current = selector;
      modalRef.current = setupModal(selector, { description: "Connect the NEAR account that will own your Kite vault.", theme: "light" });
      const sync = () => {
        const acc = selector.store.getState().accounts.find((a) => a.active) ?? null;
        setAccountId(acc?.accountId ?? null);
      };
      sync();
      const sub = selector.store.observable.subscribe(sync);
      unsub = () => sub.unsubscribe();
      setReady(true);
    })().catch((e) => {
      console.error("Wallet selector failed to load", e);
      setReady(true);
    });
    return () => unsub?.();
  }, []);

  const signIn = useCallback(() => {
    exitPreview();
    modalRef.current?.show();
  }, [exitPreview]);
  const signOut = useCallback(async () => {
    if (preview) return exitPreview();
    const s = selectorRef.current;
    if (!s?.isSignedIn()) return;
    await (await s.wallet()).signOut();
  }, [preview, exitPreview]);
  const sendReal = useCallback(async (receiverId: string, actions: Action[]) => {
    const s = selectorRef.current;
    if (!s?.isSignedIn()) throw new Error("Connect a NEAR wallet first");
    const wallet = await s.wallet();
    const outcome = await wallet.signAndSendTransaction({ receiverId, actions });
    const hash = (outcome as { transaction?: { hash?: string } } | void)?.transaction?.hash;
    if (!hash) throw new Error("The wallet didn't return a transaction");
    const o = outcome as { status?: { Failure?: unknown }; receipts_outcome?: { outcome?: { status?: { Failure?: unknown } } }[] };
    const failure = o.status?.Failure;
    if (failure) throw new Error(`Transaction failed: ${JSON.stringify(failure).slice(0, 200)}`);
    // The first receipt can succeed while a later step (a transfer out of NEAR Intents, say) fails. Don't call that done.
    const later = (o.receipts_outcome ?? []).find((r) => r.outcome?.status?.Failure)?.outcome?.status?.Failure;
    if (later) throw new Error(`Part of the transaction failed, so check your vault before trying again: ${JSON.stringify(later).slice(0, 200)}`);
    return hash;
  }, []);
  const send = useCallback<WalletCtx["send"]>(
    async (receiverId, actions) => {
      if (preview) throw new Error("Preview mode never signs. Connect a wallet to do this for real.");
      return sendReal(receiverId, actions);
    },
    [preview, sendReal],
  );

  const value = useMemo(
    () => ({ ready, accountId: preview ? PREVIEW_ACCOUNT : accountId, preview, startPreview, exitPreview, signIn, signOut, send }),
    [ready, accountId, preview, startPreview, exitPreview, signIn, signOut, send],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside WalletProvider");
  return c;
}

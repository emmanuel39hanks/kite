"use client";
/**
 * Which vault belongs to a wallet. Older vaults live at `kite.<owner>`, deployed by the owner's own wallet; new ones
 * come from Kite's factory as `<name>.kitevaults.near`, because wallets such as Meteor refuse to let an app deploy
 * contract code to the user's account. The factory call is an ordinary function call, and the caller owns the vault.
 *
 * Resolved once per account and shared by every screen: the existing vault if there is one, otherwise the free
 * factory name a new vault would get.
 */
import { useSyncExternalStore } from "react";
import { vaultIdFor } from "./config";
import { factoryVaultId, factoryVaultsBy, validVaultName, vaultNameFree } from "./factory";
import { vaultExists } from "./vault";

export type MyVault = { vault: string; exists: boolean };

/** A factory name from an account id: `emmanuel.near` → `emmanuel`, `a.b.near` → `a-b`, long hex ids shortened. */
export function baseVaultName(owner: string): string {
  const s = owner
    .replace(/\.(near|tg|testnet)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return validVaultName(s) ? s : "vault";
}

export async function resolveMyVault(owner: string): Promise<MyVault> {
  const legacy = vaultIdFor(owner);
  if (await vaultExists(legacy)) return { vault: legacy, exists: true };
  const made = await factoryVaultsBy(owner).catch(() => []);
  for (const v of [...made].reverse()) if (await vaultExists(v.vault)) return { vault: v.vault, exists: true };
  // A closed vault's name stays taken in the factory, so a second vault gets -2, -3, …
  const base = baseVaultName(owner);
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? base : `${base.slice(0, 28)}-${i}`;
    if (await vaultNameFree(name)) return { vault: factoryVaultId(name), exists: false };
  }
  throw new Error("Couldn't find a free vault name");
}

const cache = new Map<string, MyVault | "loading">();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load(owner: string) {
  cache.set(owner, "loading");
  resolveMyVault(owner)
    .then((v) => {
      cache.set(owner, v);
      emit();
    })
    // An RPC hiccup: look again in a few seconds rather than in a tight loop.
    .catch(() => setTimeout(() => {
      cache.delete(owner);
      emit();
    }, 5000));
}

/** Re-read after a create or a close. */
export function refreshMyVault(owner: string, known?: MyVault) {
  if (known) {
    cache.set(owner, known);
    emit();
  } else load(owner);
}

/** The wallet's vault (or the id a new one would get), or null while it's being looked up. */
export function useMyVault(owner: string | null | undefined): MyVault | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => {
      if (!owner) return null;
      const v = cache.get(owner);
      if (v === undefined) queueMicrotask(() => !cache.has(owner) && load(owner));
      return v && v !== "loading" ? v : null;
    },
    () => null,
  );
}

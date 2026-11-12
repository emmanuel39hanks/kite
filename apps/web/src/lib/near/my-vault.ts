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
import { NEAR, vaultIdFor } from "./config";
import { factoryVaultId, factoryVaultsBy, validVaultName } from "./factory";
import type { FactoryVault } from "./factory";
import { myDaos } from "./known-daos";
import { nearProvider } from "@/lib/near/rpc";

const provider = nearProvider();
const NO_CODE = "11111111111111111111111111111111";

/**
 * "none" only when NEAR says the account doesn't exist. Any other failure throws, so a flaky RPC can never make an
 * existing vault look missing (the console would then offer to create a second one and hide the first).
 */
async function accountState(id: string): Promise<"none" | "empty" | "code"> {
  try {
    const a = await provider.viewAccount({ accountId: id });
    return a.code_hash === NO_CODE ? "empty" : "code";
  } catch (e) {
    if (e instanceof Error && (e.constructor.name === "AccountDoesNotExistError" || /does not exist/.test(e.message))) return "none";
    throw e;
  }
}

/** Free only when the factory has no record of it and NEAR has no such account. Errors throw. */
async function nameFree(name: string): Promise<boolean> {
  const id = factoryVaultId(name);
  const known = (await provider.callFunction({ contractId: NEAR.factory, method: "get_vault", args: { vault: id } })) as FactoryVault | null;
  return !known && (await accountState(id)) === "none";
}

/**
 * `vault` is the one the screens act on: the vault this browser picked for the account, or its newest open vault,
 * or (when none, or when the person chose "New vault") the free factory name a new one would get.
 */
export type MyVault = { vault: string; exists: boolean; open: string[]; next: string; daoVaults: { vault: string; dao: string }[] };
type Found = { open: string[]; inflight: string | null; next: string; daoVaults?: { vault: string; dao: string }[] };

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

/** Every open vault the wallet owns (newest first), a creation still in flight, and the next free factory name. */
export async function findMyVaults(owner: string): Promise<Found> {
  const open: string[] = [];
  const made = await factoryVaultsBy(owner);
  for (const v of [...made].reverse()) if ((await accountState(v.vault)) === "code") open.push(v.vault);
  const legacy = vaultIdFor(owner);
  if ((await accountState(legacy)) === "code") open.push(legacy);
  // Recorded in the last few minutes but not deployed yet: a creation still in flight (a failed one is removed from
  // the factory's record). An older record with no account is a closed vault.
  const last = made[made.length - 1];
  const inflight = last && !open.includes(last.vault) && Date.now() - last.created_ns / 1e6 < 10 * 60_000 && (await accountState(last.vault)) === "none" ? last.vault : null;
  // A closed vault's name stays taken in the factory, so later vaults get -2, -3, …
  const base = baseVaultName(owner);
  for (let i = 1; i <= 40; i++) {
    const name = i === 1 ? base : `${base.slice(0, 28)}-${i}`;
    if (factoryVaultId(name) !== inflight && (await nameFree(name))) {
      // Vaults of the DAOs this wallet is in: shown on Home too, read-only (money and changes are DAO votes).
      const daoVaults = (await myDaos(owner).catch(() => [])).flatMap((d) => d.vaults.map((vault) => ({ vault, dao: d.dao })));
      return { open, inflight, next: factoryVaultId(name), daoVaults };
    }
  }
  throw new Error("Couldn't find a free vault name");
}

const pickKey = (owner: string) => `kite-vault:${owner}`;
function readPick(owner: string): string | null {
  try {
    return localStorage.getItem(pickKey(owner));
  } catch {
    return null;
  }
}

/** The vault to show, from what was found and what this browser picked ("new" = about to create one). */
export function view(f: Found, pick: string | null): MyVault {
  const daoVaults = f.daoVaults ?? [];
  const base = { open: f.open, next: f.next, daoVaults };
  if (pick === "new") return { ...base, vault: f.inflight ?? f.next, exists: false };
  if (pick && (f.open.includes(pick) || daoVaults.some((d) => d.vault === pick))) return { ...base, vault: pick, exists: true };
  if (f.open.length) return { ...base, vault: f.open[0], exists: true };
  if (daoVaults.length) return { ...base, vault: daoVaults[0].vault, exists: true };
  return { ...base, vault: f.inflight ?? f.next, exists: false };
}

const found = new Map<string, Found | "loading">();
const views = new Map<string, MyVault>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function settle(owner: string) {
  const f = found.get(owner);
  if (f && f !== "loading") views.set(owner, view(f, readPick(owner)));
  emit();
}

function load(owner: string) {
  if (!found.has(owner)) found.set(owner, "loading");
  findMyVaults(owner)
    .then((f) => {
      found.set(owner, f);
      settle(owner);
    })
    // An RPC hiccup: look again in a few seconds rather than in a tight loop.
    .catch(() =>
      setTimeout(() => {
        if (found.get(owner) === "loading") found.delete(owner);
        emit();
      }, 5000),
    );
}

/** Re-read after a create or a close. `made` is a vault just created: show it at once. */
export function refreshMyVault(owner: string, made?: string) {
  if (made) {
    const f = found.get(owner);
    if (f && f !== "loading") found.set(owner, { ...f, open: [made, ...f.open.filter((v) => v !== made)], inflight: null });
    pickMyVault(owner, made);
  }
  load(owner);
}

/** Switch the screens to one of the wallet's vaults, or to "new" to create another. Remembered in this browser. */
export function pickMyVault(owner: string, vault: string | "new") {
  try {
    localStorage.setItem(pickKey(owner), vault);
  } catch {}
  settle(owner);
}

/** The wallet's current vault (or the id a new one would get), or null while it's being looked up. */
export function useMyVault(owner: string | null | undefined): MyVault | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => {
      if (!owner) return null;
      if (!found.has(owner)) queueMicrotask(() => !found.has(owner) && load(owner));
      return views.get(owner) ?? null;
    },
    () => null,
  );
}

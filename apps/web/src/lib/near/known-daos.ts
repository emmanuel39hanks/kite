"use client";
/**
 * DAOs this browser has worked with (filed a vault for, or opened a vault of), so the DAO page can list their
 * vaults after a reload instead of asking for a vault name nobody remembers. Only names, in this browser.
 */
import { JsonRpcProvider } from "near-api-js";
import { NEAR } from "./config";
import { factoryVaultsBy } from "./factory";

const KEY = "kite-daos";

export function knownDaos(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function rememberDao(dao: string) {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(dao) || dao.length > 64) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([dao, ...knownDaos().filter((d) => d !== dao)].slice(0, 10)));
  } catch {}
}

const provider = new JsonRpcProvider({ url: NEAR.rpc });

export type MyDao = { dao: string; roles: string[]; vaults: string[] };

/**
 * The DAOs this account is a member of (from its transactions, confirmed by each DAO's policy) plus the ones this
 * browser has worked with, each with the open Kite vaults it made with the factory and still owns.
 */
export async function myDaos(account: string | null): Promise<MyDao[]> {
  const found: { dao: string; roles: string[] }[] = account
    ? await fetch(`/api/daos?account=${encodeURIComponent(account)}`)
        .then((r) => (r.ok ? r.json() : { daos: [] }))
        .then((d) => (d.daos ?? []) as { dao: string; roles: string[] }[])
        .catch(() => [])
    : [];
  const names = [...new Set([...found.map((d) => d.dao), ...knownDaos()])];
  const out: MyDao[] = [];
  for (const dao of names) {
    const made = await factoryVaultsBy(dao).catch(() => []);
    const vaults: string[] = [];
    for (const v of [...made].reverse()) {
      const status = (await provider.callFunction({ contractId: v.vault, method: "get_status", args: {} }).catch(() => null)) as { owner?: string } | null;
      if (status?.owner === dao) vaults.push(v.vault);
    }
    out.push({ dao, roles: found.find((d) => d.dao === dao)?.roles ?? [], vaults });
  }
  return out;
}

/** The open Kite vaults each known DAO made with the factory and still owns. */
export async function knownDaoVaults(): Promise<{ dao: string; vault: string }[]> {
  const out: { dao: string; vault: string }[] = [];
  for (const dao of knownDaos()) {
    const made = await factoryVaultsBy(dao).catch(() => []);
    for (const v of [...made].reverse()) {
      const status = (await provider.callFunction({ contractId: v.vault, method: "get_status", args: {} }).catch(() => null)) as { owner?: string } | null;
      if (status?.owner === dao) out.push({ dao, vault: v.vault });
    }
  }
  return out;
}

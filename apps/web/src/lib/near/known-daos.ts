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

"use client";
/**
 * DAOs this browser has worked with (filed a vault for, or opened a vault of), so the DAO page can list their
 * vaults after a reload instead of asking for a vault name nobody remembers. Only names, in this browser.
 */
import { NEAR } from "./config";
import { factoryVaultsBy } from "./factory";
import { nearProvider } from "@/lib/near/rpc";

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

const provider = nearProvider();

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

export type DaoRequest = { dao: string; id: number; kind: unknown; text: string; status: string };

/**
 * Open requests on the given DAOs that aren't about a Kite vault (payments and the like), newest first, so a member
 * can vote on them here too. Read straight from each DAO, so they show whatever another app thinks of the balance.
 */
export async function openDaoRequests(daos: string[]): Promise<DaoRequest[]> {
  const out: DaoRequest[] = [];
  for (const dao of daos) {
    const last = (await provider.callFunction({ contractId: dao, method: "get_last_proposal_id", args: {} }).catch(() => 0)) as number;
    const list = (await provider.callFunction({ contractId: dao, method: "get_proposals", args: { from_index: Math.max(0, last - 20), limit: 20 } }).catch(() => [])) as {
      id: number;
      status: string;
      kind: { Transfer?: { token_id: string; receiver_id: string; amount: string } };
    }[];
    for (const p of list) {
      if (p.status !== "InProgress" || !p.kind.Transfer) continue;
      const t = p.kind.Transfer;
      const near = t.token_id === "";
      const amount = near ? Number(BigInt(t.amount) / 10n ** 18n) / 1e6 : t.token_id === NEAR.usdcContract ? Number(t.amount) / 1e6 : Number(t.amount);
      // The whole receiver, never shortened: a vote should show exactly who gets paid.
      const unit = near ? "NEAR" : t.token_id === NEAR.usdcContract ? "USDC" : `units of ${t.token_id}`;
      out.push({ dao, id: p.id, kind: p.kind, status: p.status, text: `Send ${amount} ${unit} to ${t.receiver_id}` });
    }
  }
  return out.sort((a, b) => b.id - a.id);
}

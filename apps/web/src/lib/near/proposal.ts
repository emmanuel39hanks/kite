/** Read one SputnikDAO proposal from NEAR RPC, for the public verifier. No wallet needed. */
import { JsonRpcProvider } from "near-api-js";
import { NEAR } from "./config";
import type { DaoProposal } from "./dao";

const provider = new JsonRpcProvider({ url: NEAR.rpc });

export async function readProposal(dao: string, id: number): Promise<DaoProposal> {
  return (await provider.callFunction({ contractId: dao, method: "get_proposal", args: { id } })) as DaoProposal;
}

/** The vault's current owner, or null if the account isn't a Kite vault. */
export async function readVaultOwner(vault: string): Promise<string | null> {
  try {
    const s = (await provider.callFunction({ contractId: vault, method: "get_status", args: {} })) as { owner?: unknown };
    return typeof s.owner === "string" ? s.owner : null;
  } catch {
    return null;
  }
}

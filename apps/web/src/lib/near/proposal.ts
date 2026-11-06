/** Read one SputnikDAO proposal from NEAR RPC, for the public verifier. No wallet needed. */
import { JsonRpcProvider } from "near-api-js";
import { NEAR } from "./config";
import type { DaoProposal } from "./dao";

const provider = new JsonRpcProvider({ url: NEAR.rpc });

export async function readProposal(dao: string, id: number): Promise<DaoProposal> {
  return (await provider.callFunction({ contractId: dao, method: "get_proposal", args: { id } })) as DaoProposal;
}

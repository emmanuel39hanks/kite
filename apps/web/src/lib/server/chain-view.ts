import { RPCS } from "@kite/keeper";

/** The chain's own answer (for example, the account is gone). Asking another server won't change it. */
export class ChainError extends Error {}

/** A read-only contract call over public RPC. A busy or broken server moves the read on to the next one; a real answer (even an error) ends it. */
export async function view<T>(account: string, method: string, args: object): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } });
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5_000) });
      if (!r.ok) throw new Error(`RPC answered ${r.status}`);
      const d = (await r.json()) as { result?: { result: number[] }; error?: unknown };
      if (!d.result) throw new ChainError(`${method} on ${account} failed`);
      return JSON.parse(Buffer.from(d.result.result).toString()) as T;
    } catch (e) {
      if (e instanceof ChainError) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("NEAR RPC unreachable");
}

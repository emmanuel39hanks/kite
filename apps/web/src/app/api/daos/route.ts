import { clientIp, isNearAccount, limited } from "@/lib/server/guards";
import { nearProvider } from "@/lib/near/rpc";

const NEARBLOCKS = "https://api.nearblocks.io/v1";
const provider = nearProvider();

type Role = { name: string; kind: unknown };

/**
 * GET ?account=… → the SputnikDAOs this account is a member of, as far as the chain shows: every DAO it has sent a
 * transaction to (proposing, voting), kept only if the DAO's own policy lists the account in a role.
 */
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!isNearAccount(account)) return Response.json({ error: "bad account" }, { status: 400 });
  if (limited(`daos:${clientIp(req)}`, 30, 10 * 60_000)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const r = await fetch(`${NEARBLOCKS}/account/${account}/txns?per_page=100&order=desc`, { next: { revalidate: 60 } }).catch(() => null);
  if (!r?.ok) return Response.json({ error: "NearBlocks unavailable" }, { status: 502 });
  const { txns = [] } = (await r.json()) as { txns?: { receiver_account_id?: string }[] };
  const seen = [...new Set(txns.map((t) => t.receiver_account_id ?? "").filter((a) => a.endsWith(".sputnik-dao.near")))].slice(0, 20);
  const daos: { dao: string; roles: string[] }[] = [];
  await Promise.all(
    seen.map(async (dao) => {
      const policy = (await provider.callFunction({ contractId: dao, method: "get_policy", args: {} }).catch(() => null)) as { roles?: Role[] } | null;
      const roles = (policy?.roles ?? [])
        .filter((role) => {
          const g = (role.kind as { Group?: unknown } | null)?.Group;
          return Array.isArray(g) && g.includes(account);
        })
        .map((role) => role.name);
      if (roles.length) daos.push({ dao, roles });
    }),
  );
  daos.sort((a, b) => seen.indexOf(a.dao) - seen.indexOf(b.dao));
  return Response.json({ daos });
}

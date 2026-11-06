/**
 * Before the owner signs `vault.allocate`, check each swap address against NEAR Intents itself
 * (not Kite's server): it must be a swap of this vault's own USDC, into the planned asset, for the
 * planned amount, paying back to this vault. The vault contract only checks that the owner signed,
 * so this is what stops a bad quote route from sending the money to a stranger.
 */
const STATUS = "https://1click.chaindefuser.com/v0/status";
/** 1Click's own default fee recipient. Any other fee recipient is refused. */
const ONECLICK_FEE_RECIPIENT = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
const MAX_FEE_BPS = 50;
/** The server asks for 1%; anything looser than 2% is not one of our quotes. */
const MAX_SLIPPAGE_BPS = 200;

export type Transfer = { token: string; amount: string; to: string; buy: string };
type Stored = { quoteResponse?: { quoteRequest?: Record<string, unknown> } };

export async function verifyAllocation(opts: {
  transfers: Transfer[];
  plan: { token: string; target_bps: number }[];
  usdc: bigint;
  usdcToken: string;
  vault: string;
  fetchStatus?: (address: string) => Promise<Stored>;
}) {
  const { transfers, plan, usdc, usdcToken, vault } = opts;
  const get =
    opts.fetchStatus ??
    (async (address: string) => {
      // A brand-new address can take a moment to show up in NEAR Intents, so look a few times before giving up.
      for (let i = 0; i < 4; i++) {
        const r = await fetch(`${STATUS}?depositAddress=${encodeURIComponent(address)}`, { cache: "no-store" });
        if (r.ok) return (await r.json()) as Stored;
        if (i < 3) await new Promise((res) => setTimeout(res, 1500));
      }
      throw new Error("unknown swap address");
    });
  const bad = (why: string): never => {
    throw new Error(`The swap quotes didn't check out (${why}), so nothing was signed. Try again in a moment.`);
  };
  if (transfers.length < 1) throw new Error("There is nothing to invest yet: your plan has no part that needs a swap at this amount.");
  if (transfers.length > plan.length) bad("count");
  if (new Set(transfers.map((t) => t.buy)).size !== transfers.length) bad("repeat");

  await Promise.all(
    transfers.map(async (t) => {
      const want = plan.find((p) => p.token === t.buy);
      if (!want || t.token !== usdcToken) return bad("asset");
      if (t.amount !== ((usdc * BigInt(want.target_bps)) / 10_000n).toString()) return bad("amount");
      let q: Record<string, unknown> | undefined;
      try {
        q = (await get(t.to)).quoteResponse?.quoteRequest;
      } catch {
        return bad("address unknown to NEAR Intents");
      }
      if (!q) return bad("no stored request");
      const ok =
        q.recipient === vault && q.refundTo === vault && q.recipientType === "INTENTS" && q.refundType === "INTENTS" && q.depositType === "INTENTS" &&
        q.originAsset === usdcToken && q.destinationAsset === t.buy && q.amount === t.amount && q.dry === false &&
        q.swapType === "EXACT_INPUT" && typeof q.slippageTolerance === "number" && q.slippageTolerance <= MAX_SLIPPAGE_BPS;
      if (!ok) return bad("swap isn't ours");
      // Redirect and referral fields have no place in one of ours.
      for (const k of ["referral", "customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"]) if (q[k]) return bad("unexpected field");
      const fees = Array.isArray(q.appFees) ? (q.appFees as { recipient?: string; fee?: number }[]) : [];
      if (fees.some((f) => f.recipient !== ONECLICK_FEE_RECIPIENT || !(typeof f.fee === "number" && f.fee <= MAX_FEE_BPS))) return bad("unexpected fee");
    }),
  );
}

/**
 * The same independent check for a cross-chain deposit address, before it is shown as "send your coins here".
 * That send can't be undone, so the address must be a 1Click swap that pays this vault and refunds this owner.
 */
export async function verifyDeposit(opts: {
  address: string;
  vault: string;
  owner: string;
  sourceAsset: string;
  usdcToken: string;
  amount: string;
  fetchStatus?: (address: string) => Promise<Stored>;
}) {
  const { address, vault, owner, sourceAsset, usdcToken, amount } = opts;
  const get =
    opts.fetchStatus ??
    (async (a: string) => {
      for (let i = 0; i < 4; i++) {
        const r = await fetch(`${STATUS}?depositAddress=${encodeURIComponent(a)}`, { cache: "no-store" });
        if (r.ok) return (await r.json()) as Stored;
        if (i < 3) await new Promise((res) => setTimeout(res, 1500));
      }
      throw new Error("unknown deposit address");
    });
  const bad = (why: string): never => {
    throw new Error(`The deposit address didn't check out (${why}), so it isn't shown. Nothing was sent. Try again in a moment.`);
  };
  let q: Record<string, unknown> | undefined;
  try {
    q = (await get(address)).quoteResponse?.quoteRequest;
  } catch {
    return bad("NEAR Intents doesn't know it");
  }
  if (!q) return bad("no stored request");
  const ok =
    q.recipient === vault && q.recipientType === "INTENTS" && q.refundTo === owner && q.refundType === "INTENTS" && q.depositType === "ORIGIN_CHAIN" &&
    q.originAsset === sourceAsset && q.destinationAsset === usdcToken && q.amount === amount && q.dry === false && q.swapType === "EXACT_INPUT" &&
    typeof q.slippageTolerance === "number" && q.slippageTolerance <= MAX_SLIPPAGE_BPS;
  if (!ok) return bad("not a swap into your vault");
  for (const k of ["referral", "customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"]) if (q[k]) return bad("unexpected field");
  const fees = Array.isArray(q.appFees) ? (q.appFees as { recipient?: string; fee?: number }[]) : [];
  if (fees.some((f) => f.recipient !== ONECLICK_FEE_RECIPIENT || !(typeof f.fee === "number" && f.fee <= MAX_FEE_BPS))) return bad("unexpected fee");
}

export type CheckedSwap = { to: string; token: string; amount: string; buy: string; deadlineMs: number };

/**
 * The voter's side of the same check. A DAO's `allocate` proposal can be filed by anyone the DAO lets propose,
 * so before Kite's page offers to approve one, it looks up every transfer with NEAR Intents itself: each must be
 * a live 1Click swap of exactly that amount of that token, into an asset of this vault's plan, paying back to
 * this vault. Throws with the reason if any isn't; otherwise returns what each swap buys and when its quote ends.
 */
export async function verifyAllocateProposal(opts: {
  transfers: unknown;
  vault: string;
  planTokens: string[];
  nowMs?: number;
  fetchStatus?: (address: string) => Promise<Stored>;
}): Promise<CheckedSwap[]> {
  const { vault, planTokens } = opts;
  const now = opts.nowMs ?? Date.now();
  const get =
    opts.fetchStatus ??
    (async (address: string) => {
      const r = await fetch(`${STATUS}?depositAddress=${encodeURIComponent(address)}`, { cache: "no-store" });
      if (!r.ok) throw new Error("unknown");
      return (await r.json()) as Stored;
    });
  const list = Array.isArray(opts.transfers) ? (opts.transfers as Record<string, unknown>[]) : null;
  if (!list || list.length < 1 || list.length > 8) throw new Error("it doesn't list one to eight swaps");
  return Promise.all(
    list.map(async (t) => {
      const { to, token, amount } = t as { to?: unknown; token?: unknown; amount?: unknown };
      if (typeof to !== "string" || typeof token !== "string" || typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("a swap is malformed");
      let q: Record<string, unknown> | undefined;
      try {
        q = (await get(to)).quoteResponse?.quoteRequest;
      } catch {
        throw new Error(`${to.slice(0, 10)}… isn't a swap NEAR Intents knows`);
      }
      if (!q) throw new Error(`${to.slice(0, 10)}… isn't a swap NEAR Intents knows`);
      const buy = String(q.destinationAsset ?? "");
      const ours =
        q.recipient === vault && q.refundTo === vault && q.recipientType === "INTENTS" && q.refundType === "INTENTS" && q.depositType === "INTENTS" &&
        q.originAsset === token && q.amount === amount && q.dry === false && q.swapType === "EXACT_INPUT" &&
        typeof q.slippageTolerance === "number" && q.slippageTolerance <= MAX_SLIPPAGE_BPS && planTokens.includes(buy) && buy !== token;
      if (!ours) throw new Error(`the swap at ${to.slice(0, 10)}… doesn't pay this vault, or doesn't match the plan`);
      for (const k of ["referral", "customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"]) if (q[k]) throw new Error("a swap carries a redirect");
      const fees = Array.isArray(q.appFees) ? (q.appFees as { recipient?: string; fee?: number }[]) : [];
      if (fees.some((f) => f.recipient !== ONECLICK_FEE_RECIPIENT || !(typeof f.fee === "number" && f.fee <= MAX_FEE_BPS))) throw new Error("a swap pays someone a fee");
      const deadlineMs = Date.parse(String(q.deadline ?? ""));
      if (!Number.isFinite(deadlineMs)) throw new Error("a swap has no deadline");
      if (deadlineMs <= now) throw new Error("its quotes have expired");
      return { to, token, amount, buy, deadlineMs };
    }),
  );
}

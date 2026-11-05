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

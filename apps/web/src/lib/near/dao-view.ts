/**
 * What the console needs on top of dao.ts to show and drive a DAO-owned vault: who owns it, what a
 * proposal would do in plain words, which proposals are still open, and the proposals behind each
 * owner button. Pure functions apart from readDaoPolicy, so they can be tested without a network.
 */
import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "./config";
import { touchesVault, type DaoProposal, type ProposalKind, type VaultCall } from "./dao";
import { nearProvider } from "@/lib/near/rpc";

/* ───────────── accounts and ownership ───────────── */

/** A NEAR account name as the protocol allows it (2-64 chars, lowercase, `.`-separated parts). */
export function isAccountId(s: string): boolean {
  return s.length >= 2 && s.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
}

/** Trim and lowercase what someone typed; null when it can't be an account. */
export function cleanAccount(input: string): string | null {
  const s = input.trim().toLowerCase();
  return isAccountId(s) ? s : null;
}

/** The account that owns the vault when it isn't the connected one, or null. Unknown owner counts as ours. */
export function foreignOwner(owner: string | null | undefined, account: string | null | undefined): string | null {
  if (!owner || !account) return null;
  return owner === account ? null : owner;
}

/** The account a vault has been offered to and hasn't accepted yet. */
export function openOffer(status: { owner: string; pending_owner?: string | null }): string | null {
  const p = status.pending_owner ?? null;
  return p && p !== status.owner ? p : null;
}

export function notOwnerMessage(owner: string): string {
  return `Owned by ${owner}. Adding money and every change are DAO votes.`;
}

/** yoctoNEAR as a short NEAR amount, e.g. 100000000000000000000000n → "0.1". */
export function nearFromYocto(yocto: bigint, digits = 4): string {
  const whole = yocto / 10n ** 24n;
  const frac = (yocto % 10n ** 24n).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/* ───────────── policy ───────────── */

type RoleKind = "Everyone" | { Group: string[] } | { Member: string } | string | Record<string, unknown>;
export type DaoRole = { name: string; kind: RoleKind; permissions: string[] };
export type DaoPolicy = { roles: DaoRole[]; proposal_bond: string; proposal_period: string };

/** What the connected account may do with FunctionCall proposals under this policy, as far as the console can tell. */
export type Rights = { roles: string[]; propose: boolean; approve: boolean; tokenWeighted: boolean };

/**
 * Roles the account holds and whether they grant adding and approving FunctionCall ("call") proposals.
 * Token-weighted roles depend on a balance the console doesn't read, so they're flagged, not assumed.
 * The DAO contract is the one that enforces this; the console only uses it to explain.
 */
export function rightsOf(policy: Pick<DaoPolicy, "roles">, account: string | null): Rights {
  const held = policy.roles.filter((r) => {
    if (r.kind === "Everyone") return true;
    if (!account || typeof r.kind !== "object" || r.kind === null) return false;
    const g = (r.kind as { Group?: unknown }).Group;
    return Array.isArray(g) && g.includes(account);
  });
  const tokenWeighted = policy.roles.some((r) => typeof r.kind === "object" && r.kind !== null && "Member" in r.kind);
  const allows = (action: string) => held.some((r) => r.permissions.some((p) => [`call:${action}`, `*:${action}`, "call:*", "*:*"].includes(p)));
  return { roles: held.map((r) => r.name), propose: allows("AddProposal"), approve: allows("VoteApprove"), tokenWeighted };
}

const provider = nearProvider();

/** The DAO's full policy (roles, bond, voting period). Throws if the account isn't a SputnikDAO. */
export async function readDaoPolicy(dao: string): Promise<DaoPolicy> {
  const p = (await provider.callFunction({ contractId: dao, method: "get_policy", args: {} })) as DaoPolicy;
  if (!p || !Array.isArray(p.roles) || typeof p.proposal_bond !== "string") throw new Error(`${dao} doesn't return a SputnikDAO policy.`);
  return p;
}

/* ───────────── proposals ───────────── */

const STATUS_LABEL: Record<string, string> = {
  InProgress: "Open",
  Approved: "Passed",
  Rejected: "Rejected",
  Removed: "Removed",
  Expired: "Expired",
  Moved: "Moved",
  Failed: "Failed",
};
export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

/** Open: still taking votes and not past the DAO's voting period. */
export function isOpen(p: Pick<DaoProposal, "status" | "submission_time">, periodNs?: string, nowMs = Date.now()): boolean {
  if (p.status !== "InProgress") return false;
  if (!periodNs) return true;
  return BigInt(p.submission_time) + BigInt(periodNs) > BigInt(Math.floor(nowMs)) * 1_000_000n;
}

/** Past its voting period but never finalised: SputnikDAO still lists these as InProgress. */
export const isLapsed = (p: Pick<DaoProposal, "status" | "submission_time">, periodNs?: string, nowMs = Date.now()) =>
  p.status === "InProgress" && !!periodNs && !isOpen(p, periodNs, nowMs);

/** A proposal the console offers an Approve button for: open, and a FunctionCall on this vault only. */
export function canApprove(p: Pick<DaoProposal, "status" | "submission_time" | "kind">, vault: string, periodNs?: string, nowMs = Date.now()): boolean {
  return isOpen(p, periodNs, nowMs) && touchesVault(p.kind, vault);
}

/** Methods that move money out or change who controls the vault. Voters should read these twice. */
export function callRisk(method: string): "moves-money" | "changes-owner" | null {
  if (["withdraw", "withdraw_external", "allocate", "close_vault", "ft_transfer_call"].includes(method)) return "moves-money";
  if (["propose_owner", "accept_owner", "set_quote_signer"].includes(method)) return "changes-owner";
  return null;
}

type Limits = { band_bps?: number; max_trade_bps?: number; max_slippage_bps?: number; max_trades_per_day?: number; min_interval_secs?: number; settle_window_secs?: number };

export function limitsText(l: Limits): string {
  const parts: string[] = [];
  if (l.band_bps != null) parts.push(`steps in at ${l.band_bps / 100} pts`);
  if (l.max_trade_bps != null) parts.push(`biggest trade ${l.max_trade_bps / 100}%`);
  if (l.max_slippage_bps != null) parts.push(`worst price ${(l.max_slippage_bps / 100).toFixed(2)}%`);
  if (l.max_trades_per_day != null) parts.push(`${l.max_trades_per_day} trade${l.max_trades_per_day === 1 ? "" : "s"} a day`);
  // Shown so a voter sees every limit the call sets, including the two the sliders don't touch.
  if (l.min_interval_secs != null) parts.push(`at least ${+(l.min_interval_secs / 3600).toFixed(2)} h between trades`);
  if (l.settle_window_secs != null) parts.push(`pauses if a swap hasn't landed in ${+(l.settle_window_secs / 60).toFixed(1)} min`);
  return parts.join(", ");
}

/** One decoded vault call in plain words. Unknown methods show their raw arguments. */
export function summarizeCall(method: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (method) {
    case "create_vault": {
      const plan = Array.isArray(a.plan) ? (a.plan as { token?: string; target_bps?: number }[]) : [];
      return `Create Kite vault ${String(a.name)}.${NEAR.factory}: ${plan.map((t) => `${(t.token && assetByIntentsId(t.token)?.ticker) || t.token} ${(t.target_bps ?? 0) / 100}%`).join(", ")}`;
    }
    case "pause":
      return "Pause the vault";
    case "unpause":
      return "Unpause the vault";
    case "revoke_agent":
      return "Remove Kite's key";
    case "set_agent":
      return `Add Kite's key ${String(a.public_key ?? "")} with ${typeof a.allowance_yocto === "string" && /^\d+$/.test(a.allowance_yocto) ? nearFromYocto(BigInt(a.allowance_yocto)) : "?"} NEAR of gas allowance`;
    case "accept_owner":
      return "Take ownership of the vault";
    case "propose_owner":
      return a.new_owner ? `Offer the vault to ${String(a.new_owner)}` : "Withdraw the ownership offer";
    case "set_limits":
      return `Set guardrails: ${limitsText((a.limits ?? {}) as Limits)}`;
    case "set_plan": {
      const plan = Array.isArray(a.plan) ? (a.plan as { token?: string; target_bps?: number }[]) : [];
      return `Set the target mix: ${plan.map((t) => `${(t.token && assetByIntentsId(t.token)?.ticker) || t.token} ${(t.target_bps ?? 0) / 100}%`).join(", ")}`;
    }
    case "withdraw":
      return `Withdraw ${String(a.amount)} of ${String(a.token)} to ${String(a.receiver_id)}`;
    case "close_vault":
      return "Close the vault and return its NEAR to the owner";
    case "ft_transfer_call":
      return `Move ${usdcText(a.amount)} USDC from the DAO into vault ${String(a.msg ?? "?")}`;
    case "allocate": {
      // Never trust the amounts or addresses here: the proposal row checks each swap with NEAR Intents.
      const ts = Array.isArray(a.transfers) ? a.transfers : [];
      return `Send ${ts.length === 1 ? "an amount" : `${ts.length} amounts`} to a swap address. Kite checks each one with NEAR Intents below before offering a vote.`;
    }
    default:
      return `${method} ${JSON.stringify(args ?? {})}`;
  }
}

/** USDC base units (6 decimals) as dollars, e.g. "3.00". */
export function usdcText(base: unknown): string {
  return typeof base === "string" && /^\d+$/.test(base) ? (Number(BigInt(base)) / 1e6).toFixed(2) : "?";
}

/* ───────────── the proposals behind each owner button ───────────── */

export type OwnerAction =
  | { kind: "accept"; offeredBy: string }
  | { kind: "pause" }
  | { kind: "unpause" }
  | { kind: "revoke" }
  | { kind: "restore"; publicKey: string; allowanceYocto: string }
  | { kind: "limits"; contractLimits: Record<string, number> }
  | { kind: "plan"; plan: { token: string; target_bps: number; decimals: number; max_slippage_bps?: number }[]; text: string }
  /** Prepared elsewhere (withdraw as USDC, close): description, calls and gas per call already worked out. */
  | { kind: "prepared"; description: string; calls: VaultCall[]; gasTgas: number };

/** The description and calls for one owner action, proposed to the DAO that owns (or is taking) the vault. */
export function ownerProposal(vault: string, a: OwnerAction): { description: string; calls: VaultCall[]; gasTgas?: number } {
  switch (a.kind) {
    case "prepared":
      return { description: a.description, calls: a.calls, gasTgas: a.gasTgas };
    case "accept":
      return {
        description: `Take ownership of Kite vault ${vault}, offered by ${a.offeredBy}. Once this passes, every change to the vault is a proposal of this DAO.`,
        calls: [{ method: "accept_owner", args: {} }],
      };
    case "pause":
      return { description: `Pause Kite vault ${vault}. Kite can't trade until the DAO unpauses it.`, calls: [{ method: "pause", args: {} }] };
    case "unpause":
      return { description: `Unpause Kite vault ${vault}. Kite may trade again inside its guardrails.`, calls: [{ method: "unpause", args: {} }] };
    case "revoke":
      return { description: `Remove Kite's key from vault ${vault}. Kite can no longer trade.`, calls: [{ method: "revoke_agent", args: {} }] };
    case "restore":
      return {
        description: `Add Kite's rebalance-only key to vault ${vault}, with ${nearFromYocto(BigInt(a.allowanceYocto))} NEAR of gas allowance.`,
        calls: [{ method: "set_agent", args: { public_key: a.publicKey, allowance_yocto: a.allowanceYocto } }],
      };
    case "limits":
      return {
        description: `Change the guardrails on Kite vault ${vault}: ${limitsText(a.contractLimits)}.`,
        calls: [{ method: "set_limits", args: { limits: a.contractLimits } }],
      };
    case "plan":
      return {
        description: `Change the target mix of Kite vault ${vault} to ${a.text}. Kite trades toward it at its next hourly check, inside the vault's guardrails. If a swap is in flight when this passes, the vault refuses and the DAO votes again.`,
        calls: [{ method: "set_plan", args: { plan: a.plan } }],
      };
  }
}

/** Already an open proposal on this vault calling `method`? Saves a second bond for the same thing. */
export function openProposalFor(proposals: DaoProposal[], method: string, periodNs?: string, nowMs = Date.now()): DaoProposal | null {
  return (
    proposals.find((p) => isOpen(p, periodNs, nowMs) && ((p.kind as ProposalKind).FunctionCall?.actions ?? []).some((x) => x.method_name === method)) ?? null
  );
}

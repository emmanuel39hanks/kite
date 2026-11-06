"use client";

import type { Action } from "@near-js/transactions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { GuardSliders } from "@/components/console/guard-sliders";
import { TreasuryPolicy } from "@/components/console/treasury-policy";
import { Badge, Button, Card, Empty, PageTitle, SectionTitle, StatusNote } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { assetByIntentsId, units as fmtUnits, usd } from "@/lib/assets";
import { useMarket } from "@/lib/market/use-market";
import { accountUrl, NEAR, vaultIdFor } from "@/lib/near/config";
import { addProposalAction, approveAction, describeCalls, vaultProposals, type DaoProposal } from "@/lib/near/dao";
import {
  callRisk,
  canApprove,
  cleanAccount,
  isLapsed,
  limitsText,
  nearFromYocto,
  openOffer,
  openProposalFor,
  ownerProposal,
  readDaoPolicy,
  rightsOf,
  statusLabel,
  summarizeCall,
  type DaoPolicy,
  type OwnerAction,
} from "@/lib/near/dao-view";
import { agentAllowanceYocto, fromContractLimits, readVault, toContractLimits, type VaultState } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import type { Guardrails } from "@/lib/store";
import { slice } from "@/lib/mix";

/**
 * A Kite vault owned by a SputnikDAO: who owns it, what it holds, and the DAO's proposals that call it.
 * Every owner action here is an add_proposal on the DAO; nothing is ever sent to the vault directly.
 */
export default function DaoPage() {
  return (
    <>
      <PageTitle>DAO treasury</PageTitle>
      <Suspense fallback={null}>
        <DaoView />
      </Suspense>
    </>
  );
}

type Note = { tone: "ok" | "err"; text: string } | null;
type DaoCtx = { dao: string; policy: DaoPolicy; proposals: DaoProposal[] };
type Loaded = { state: VaultState; owner: DaoCtx | null; pending: DaoCtx | null };

function DaoView() {
  const params = useSearchParams();
  const router = useRouter();
  const w = useWallet();
  const fromUrl = cleanAccount(params.get("vault") ?? "");
  const vault = fromUrl ?? (w.accountId && !w.preview ? vaultIdFor(w.accountId) : null);

  if (w.preview)
    return (
      <Card>
        <Empty
          title="Not available in the preview"
          text="DAO vaults need a real wallet and a real DAO on NEAR. The preview doesn't simulate them."
          action={
            <Button variant="primary" icon="wallet" onClick={w.signIn}>
              Use a real wallet
            </Button>
          }
        />
      </Card>
    );

  return (
    <>
      <VaultPicker key={vault ?? ""} current={vault} onPick={(v) => router.replace(`/console/dao?vault=${encodeURIComponent(v)}`)} />
      {vault ? (
        <VaultDao key={vault} vault={vault} own={!fromUrl} />
      ) : (
        <Card className="mt-3">
          <Empty title="Pick a vault" text="Enter a Kite vault to see who owns it and what its DAO is voting on. Connect a wallet to propose changes or vote." />
        </Card>
      )}
    </>
  );
}

function VaultPicker({ current, onPick }: { current: string | null; onPick: (v: string) => void }) {
  const [input, setInput] = useState(current ?? "");
  const typed = cleanAccount(input);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed) onPick(typed);
      }}
    >
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="kite.example.near"
        aria-label="Vault account"
        spellCheck={false}
        autoCapitalize="off"
        className="h-[42px] min-w-0 flex-1 rounded-full bg-white px-4 text-[15px] ring-1 ring-inset ring-black/[0.09] outline-none placeholder:text-black/30 focus:ring-[#8cc6f6] sm:max-w-[420px]"
      />
      <Button type="submit" disabled={!typed || typed === current}>
        Open vault
      </Button>
    </form>
  );
}

async function daoCtx(account: string, vault: string): Promise<DaoCtx | null> {
  try {
    const policy = await readDaoPolicy(account);
    const proposals = await vaultProposals(account, vault).catch(() => []);
    return { dao: account, policy, proposals };
  } catch {
    return null; // not a DAO: a person's account, or a contract without get_policy
  }
}

async function load(vault: string): Promise<Loaded> {
  const state = await readVault(vault);
  const offer = openOffer(state.status);
  const [owner, pending] = await Promise.all([daoCtx(state.status.owner, vault), offer ? daoCtx(offer, vault) : Promise.resolve(null)]);
  return { state, owner, pending };
}

function VaultDao({ vault, own }: { vault: string; own: boolean }) {
  const w = useWallet();
  const [data, setData] = useState<Loaded | { error: string } | null>(null);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    let alive = true;
    load(vault)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ error: own ? "none" : `There's no Kite vault at ${vault}, or NEAR's RPC didn't answer. Check the name and try again.` }));
    return () => {
      alive = false;
    };
  }, [vault, rev]);

  /** Sign one DAO transaction, then re-read the vault and proposals once the chain has it. */
  const run = useCallback(
    async (name: string, dao: string, action: Action, ok: string) => {
      setBusy(name);
      setNote(null);
      try {
        await w.send(dao, [action]);
        setNote({ tone: "ok", text: ok });
        setTimeout(() => setRev((r) => r + 1), 2500);
      } catch (e) {
        setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(null);
      }
    },
    [w],
  );

  const propose = (ctx: DaoCtx, name: string, action: OwnerAction) => {
    const { description, calls } = ownerProposal(vault, action);
    return run(name, ctx.dao, addProposalAction(vault, description, calls, BigInt(ctx.policy.proposal_bond)), `Proposal sent to ${ctx.dao}. It runs once the DAO approves it.`);
  };
  const approve = (ctx: DaoCtx, p: DaoProposal) =>
    run(`approve-${ctx.dao}-${p.id}`, ctx.dao, approveAction(p.id, p.kind), `Vote recorded on proposal ${p.id}. If it reached the DAO's threshold, the DAO tried the calls; the list below shows whether they ran.`);

  if (!data) return <div className="mt-3 h-[260px] animate-pulse rounded-[20px] bg-[#f5f5f7]" />;
  if ("error" in data && data.error === "none")
    return (
      <Card className="mt-3">
        <Empty
          title="You don't have a vault to hand over yet"
          text={`A DAO doesn't take over your wallet. It takes over a vault. Create your vault (it will be ${vault}), then offer it to your DAO from your profile. Once the DAO votes to accept, it owns the vault and every change needs its vote. Your wallet stays yours. To look at a vault a DAO already owns, enter its name above.`}
          action={
            <Button variant="primary" icon="notepad" href="/console/explore">
              Create a vault
            </Button>
          }
        />
      </Card>
    );
  if ("error" in data) return <StatusNote tone="err" className="mt-3">{data.error}</StatusNote>;

  const { state, owner, pending } = data;
  const offer = openOffer(state.status);
  const connected = !!w.accountId;
  const daos = [owner, pending && pending.dao !== owner?.dao ? pending : null].filter((x): x is DaoCtx => !!x);

  return (
    <>
      {note && (
        <StatusNote tone={note.tone} className="mt-3">
          {note.text}
        </StatusNote>
      )}

      <Overview vault={vault} state={state} ownerIsDao={!!owner} offer={offer} onRefresh={() => setRev((r) => r + 1)} />

      {offer && pending && (
        <AcceptCard vault={vault} owner={state.status.owner} ctx={pending} account={w.accountId} busy={busy} onPropose={() => propose(pending, "accept", { kind: "accept", offeredBy: state.status.owner })} />
      )}
      {offer && !pending && (
        <Card className="mt-3 p-5">
          <p className="text-[14px] leading-5 text-[#6b6b6b]">
            Offered to {offer}, which has no DAO policy. That account takes the vault by calling accept_owner itself; this page only handles DAOs.
          </p>
        </Card>
      )}

      {owner && <OwnerActions key={JSON.stringify(state.limits)} vault={vault} state={state} ctx={owner} account={w.accountId} busy={busy} onPropose={(name, a) => propose(owner, name, a)} />}

      {daos.map((ctx) => (
        <div key={ctx.dao} className="mt-10">
          <SectionTitle actions={<Button size="sm" href={accountUrl(ctx.dao)} external icon="external">NearBlocks</Button>}>Proposals on {ctx.dao}</SectionTitle>
          <Card className="overflow-hidden">
            {ctx.proposals.length ? (
              <ul className="divide-y divide-black/[0.05] bg-white">
                {ctx.proposals.map((p) => (
                  <ProposalRow key={p.id} p={p} vault={vault} period={ctx.policy.proposal_period} connected={connected} busy={busy} onApprove={() => approve(ctx, p)} busyKey={`approve-${ctx.dao}-${p.id}`} />
                ))}
              </ul>
            ) : (
              <Empty title="No proposals for this vault" text={`None of ${ctx.dao}'s last 100 proposals call ${vault}.`} />
            )}
          </Card>
        </div>
      ))}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
      <div className="text-[13px] text-[#6b6b6b]">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[15px] break-all">{children}</div>
    </div>
  );
}

function Overview({ vault, state, ownerIsDao, offer, onRefresh }: { vault: string; state: VaultState; ownerIsDao: boolean; offer: string | null; onRefresh: () => void }) {
  const { quote } = useMarket();
  const rows = state.plan.map((t, i) => {
    const a = assetByIntentsId(t.token);
    const n = Number(state.balances[i] ?? 0n) / 10 ** t.decimals;
    return { token: t.token, a, n, target: t.target_bps / 100, value: a ? n * quote(a.id).price : null };
  });
  return (
    <div className="mt-6">
      <SectionTitle
        actions={
          <>
            <Button size="sm" icon="refresh" onClick={onRefresh}>
              Refresh
            </Button>
            <Button size="sm" href={accountUrl(vault)} external icon="external">
              NearBlocks
            </Button>
          </>
        }
      >
        {vault}
      </SectionTitle>
      <Card className="p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Owner">
            {state.status.owner} {ownerIsDao ? <Badge tone="blue">DAO</Badge> : <Badge>Not a DAO</Badge>}
          </Fact>
          <Fact label="Offered to">{offer ?? <span className="text-[#6b6b6b]">Nobody</span>}</Fact>
          <Fact label="Kite's key">{state.status.agent ? <Badge tone="green">On: rebalance and settle only</Badge> : <Badge>Off: nothing can trade</Badge>}</Fact>
          <Fact label="State">{state.status.paused ? <Badge tone="red">Paused</Badge> : <Badge tone="green">Running</Badge>}</Fact>
        </div>
        <p className="px-3 pt-4 pb-2 text-[14px] text-[#6b6b6b]">Guardrails: {limitsText(state.limits)}.</p>
        <ul className="mt-1 divide-y divide-black/[0.05] overflow-hidden rounded-2xl bg-white">
          {rows.map((r) => (
            <li key={r.token} className="flex items-center gap-3 px-4 py-3">
              {r.a ? <Logo id={r.a.id} size={28} /> : <span className="h-7 w-7 rounded-full bg-black/[0.06]" />}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[15px]">{r.a?.name ?? r.token}</div>
                <div className="text-[13px] text-[#6b6b6b] tabular-nums">
                  {fmtUnits(r.n)} {r.a?.ticker ?? ""} · target {r.target}%
                </div>
              </div>
              <div className="text-right text-[15px] tabular-nums">{r.value === null ? "–" : usd(r.value)}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RightsHint({ policy, account, need }: { policy: DaoPolicy; account: string | null; need: "propose" | "approve" }) {
  if (!account) return <p className="mt-2 text-[13px] text-[#6b6b6b]">Connect a wallet to {need === "propose" ? "create proposals" : "vote"}.</p>;
  const r = rightsOf(policy, account);
  if (r[need]) return null;
  return (
    <p className="mt-2 text-[13px] leading-5 text-[#8a5a00]">
      {r.tokenWeighted
        ? `This DAO has token-weighted roles the console can't check. It may refuse ${account}.`
        : `${account} isn't in a role that may ${need === "propose" ? "add" : "approve"} function-call proposals, so the DAO will likely refuse it.`}
    </p>
  );
}

function AcceptCard({ vault, owner, ctx, account, busy, onPropose }: { vault: string; owner: string; ctx: DaoCtx; account: string | null; busy: string | null; onPropose: () => void }) {
  const bond = BigInt(ctx.policy.proposal_bond);
  const open = owner !== ctx.dao ? openProposalFor(ctx.proposals, "accept_owner", ctx.policy.proposal_period) : null;
  return (
    <Card className="mt-3 p-5">
      <h2 className="text-[18px] tracking-[-0.03em]">Ask the DAO to accept this vault</h2>
      <p className="mt-1 max-w-[70ch] text-[14px] leading-5 text-[#6b6b6b]">
        {owner} offered {vault} to {ctx.dao}. The vault changes hands only when {ctx.dao} passes a proposal that calls accept_owner. After that, {owner} loses control and every change is a vote of
        the DAO.
      </p>
      {open ? (
        <p className="mt-3 text-[14px]">Proposal {open.id} already asks for this. Vote on it below.</p>
      ) : (
        <>
          <Button className="mt-4" variant="primary" size="sm" icon="users" onClick={onPropose} loading={busy === "accept"} disabled={!account || busy !== null}>
            Create the accept proposal ({nearFromYocto(bond)} NEAR bond)
          </Button>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            Sends add_proposal to {ctx.dao} with its {nearFromYocto(bond)} NEAR proposal bond. The proposal makes one call: accept_owner on {vault}.
          </p>
          <RightsHint policy={ctx.policy} account={account} need="propose" />
        </>
      )}
    </Card>
  );
}

function OwnerActions({
  vault,
  state,
  ctx,
  account,
  busy,
  onPropose,
}: {
  vault: string;
  state: VaultState;
  ctx: DaoCtx;
  account: string | null;
  busy: string | null;
  onPropose: (name: string, a: OwnerAction) => void;
}) {
  const current = fromContractLimits(state.limits);
  const [g, setG] = useState<Guardrails>(current);
  const changed = JSON.stringify(g) !== JSON.stringify(current);
  const bond = nearFromYocto(BigInt(ctx.policy.proposal_bond));
  const off = !account || busy !== null;
  const restoreReady = NEAR.agentPublicKey.startsWith("ed25519:");

  return (
    <div className="mt-10">
      <SectionTitle>Propose a change</SectionTitle>
      <p className="-mt-2 mb-4 max-w-[70ch] text-[14px] leading-5 text-[#6b6b6b]">
        {ctx.dao} owns {vault}, so each button creates one proposal on the DAO with its {bond} NEAR bond. Nothing changes until the DAO approves it.
      </p>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-2">
          <div className="px-4 pt-3 pb-4">
            <h2 className="text-[18px] tracking-[-0.03em]">Guardrails</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">The limits the vault enforces on every trade Kite makes. The proposal calls set_limits with these values.</p>
          </div>
          <GuardSliders value={g} onChange={setG} />
          <div className="flex flex-wrap items-center gap-2 px-3 pt-4 pb-3">
            <Button variant="primary" size="sm" onClick={() => onPropose("limits", { kind: "limits", contractLimits: toContractLimits(g, state.limits) })} loading={busy === "limits"} disabled={off || !changed}>
              Propose these guardrails
            </Button>
            {changed && (
              <Button variant="ghost" size="sm" onClick={() => setG(current)}>
                Discard
              </Button>
            )}
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="p-5">
            <h2 className="text-[18px] tracking-[-0.03em]">{state.status.paused ? "Unpause" : "Pause"}</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">
              {state.status.paused ? "Proposes unpause: Kite may trade again inside the guardrails." : "Proposes pause: Kite can't trade until the DAO unpauses."}
            </p>
            <Button
              className="mt-3"
              size="sm"
              onClick={() => onPropose("pause", state.status.paused ? { kind: "unpause" } : { kind: "pause" })}
              loading={busy === "pause"}
              disabled={off}
            >
              {state.status.paused ? "Propose unpause" : "Propose pause"}
            </Button>
          </Card>

          <Card className="p-5">
            <h2 className="text-[18px] tracking-[-0.03em]">Kite&apos;s key</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">
              {state.status.agent
                ? "Proposes revoke_agent: deletes Kite's key from the vault, so nothing can trade."
                : `Proposes set_agent: adds Kite's rebalance-only key with ${nearFromYocto(BigInt(agentAllowanceYocto()))} NEAR of gas allowance.`}
            </p>
            <Button
              className="mt-3"
              size="sm"
              onClick={() =>
                onPropose("key", state.status.agent ? { kind: "revoke" } : { kind: "restore", publicKey: NEAR.agentPublicKey, allowanceYocto: agentAllowanceYocto() })
              }
              loading={busy === "key"}
              disabled={off || (!state.status.agent && !restoreReady)}
            >
              {state.status.agent ? "Propose removing Kite's key" : "Propose restoring Kite's key"}
            </Button>
            {!state.status.agent && !restoreReady && <p className="mt-2 text-[13px] text-[#8a5a00]">This deployment has no Kite key configured, so it can&apos;t propose restoring it.</p>}
          </Card>

          <TreasuryPolicy
            vault={vault}
            dao={ctx.dao}
            plan={state.plan.flatMap((t) => {
              const a = assetByIntentsId(t.token);
              return a ? [slice(a.id, t.target_bps / 100)] : [];
            })}
            limits={g}
            timing={state.limits}
            planLocked={state.plan.every((t) => assetByIntentsId(t.token)) ? undefined : "This plan holds a token Kite doesn't recognise, so only the guardrails can be proposed here."}
          />

          <Card className="p-4">
            <RightsHint policy={ctx.policy} account={account} need="propose" />
            <p className="text-[13px] leading-5 text-[#6b6b6b]">The DAO checks who may propose and vote. If it refuses, its error shows above.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = { InProgress: "blue", Approved: "green", Rejected: "red", Removed: "red", Failed: "red" };

function ProposalRow({
  p,
  vault,
  period,
  connected,
  busy,
  busyKey,
  onApprove,
}: {
  p: DaoProposal;
  vault: string;
  period: string;
  connected: boolean;
  busy: string | null;
  busyKey: string;
  onApprove: () => void;
}) {
  const calls = describeCalls(p.kind);
  const lapsed = isLapsed(p, period);
  const approvable = canApprove(p, vault, period);
  const when = new Date(Number(BigInt(p.submission_time) / 1_000_000n));
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px]">Proposal {p.id}</span>
            {lapsed ? <Badge>Voting period over</Badge> : <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{statusLabel(p.status)}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            By {p.proposer} · {when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
          {p.description && <p className="mt-2 max-w-[80ch] text-[14px] leading-5 break-words">{p.description}</p>}
          <ul className="mt-2 space-y-1">
            {calls.map((c, i) => {
              const risk = callRisk(c.method);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <code className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[12px]">{c.method}</code>
                  <span className="break-all">{summarizeCall(c.method, c.args)}</span>
                  {risk === "moves-money" && <Badge tone="amber">Moves money</Badge>}
                  {risk === "changes-owner" && <Badge tone="amber">Changes control</Badge>}
                </li>
              );
            })}
          </ul>
        </div>
        {approvable && (
          <Button size="sm" variant="primary" icon="check" onClick={onApprove} loading={busy === busyKey} disabled={!connected || busy !== null}>
            Approve
          </Button>
        )}
      </div>
    </li>
  );
}

"use client";

import type { Action } from "@near-js/transactions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { CreateDaoVault } from "@/components/console/create-dao-vault";
import { DaoFundCard } from "@/components/console/dao-fund-card";
import { GuardSliders } from "@/components/console/guard-sliders";
import { MixSliders } from "@/components/console/mix-sliders";
import { TreasuryPolicy } from "@/components/console/treasury-policy";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, Disclosure, Empty, PageTitle, Segmented, StatusNote } from "@/components/console/ui";
import { Donut } from "@/components/charts";
import { Logo } from "@/components/logo";
import { assetByIntentsId, units as fmtUnits, usd } from "@/lib/assets";
import { useMarket } from "@/lib/market/use-market";
import { verifyAllocateProposal, type CheckedSwap } from "@/lib/near/allocate-check";
import { accountUrl, NEAR } from "@/lib/near/config";
import { pickMyVault, refreshMyVault, useMyVault } from "@/lib/near/my-vault";
import { myDaos, rememberDao, type MyDao } from "@/lib/near/known-daos";
import { addProposalAction, approveAction, describeCalls, vaultProposals, type DaoProposal } from "@/lib/near/dao";
import {
  callRisk,
  canApprove,
  cleanAccount,
  isLapsed,
  isOpen,
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
import { mixValid, slice, type Slice } from "@/lib/mix";

/**
 * A Kite vault owned by a SputnikDAO: who owns it, what it holds, and the DAO's proposals that call it.
 * Every owner action here is an add_proposal on the DAO; nothing is ever sent to the vault directly.
 */
export default function DaoPage() {
  return (
    <Suspense fallback={null}>
      <DaoView />
    </Suspense>
  );
}

type Note = { tone: "ok" | "err"; text: string } | null;
type DaoCtx = { dao: string; policy: DaoPolicy; proposals: DaoProposal[] };
type Loaded = { state: VaultState; owner: DaoCtx | null; pending: DaoCtx | null };

const MODES = ["Create a vault", "Open a vault"] as const;
type Mode = (typeof MODES)[number];

const HOW = [
  { icon: "users", title: "One vote creates it", text: "A council member files one proposal. When it passes, the vault exists, owned by the DAO from the first block." },
  { icon: "refresh", title: "Kite keeps the mix", text: "Kite's key on the vault can only rebalance and settle, inside the limits the DAO voted for." },
  { icon: "shield", title: "The DAO stays in charge", text: "Every withdrawal, rule change, pause or key change is a proposal the DAO votes on. Kite can't move money out." },
] as const;

function DaoView() {
  const params = useSearchParams();
  const router = useRouter();
  const w = useWallet();
  const fromUrl = cleanAccount(params.get("vault") ?? "");
  const [picked, setPicked] = useState<Mode | null>(null);
  const [createFor, setCreateFor] = useState("");
  const [byName, setByName] = useState(false);
  const mode: Mode = picked ?? (fromUrl ? "Open a vault" : "Create a vault");
  const mine = useMyVault(w.accountId && !w.preview ? w.accountId : null);
  const vault = fromUrl ?? (mine?.exists ? mine.vault : null);

  // The preview shows all of this too: it only reads NEAR mainnet. Filing or voting needs a real wallet.
  const open = (v: string) => {
    setPicked("Open a vault");
    router.replace(`/console/dao?vault=${encodeURIComponent(v)}`);
  };
  return (
    <>
      <PageTitle actions={<Segmented options={MODES} value={mode} onChange={setPicked} label="What to do" size="md" />}>DAO treasury</PageTitle>
      <YourDaos account={w.preview ? null : w.accountId} current={mode === "Open a vault" ? fromUrl : null} onPick={open} onCreate={(d) => (setCreateFor(d), setPicked("Create a vault"))} onByName={() => (setPicked("Open a vault"), setByName(true))} />

      {mode === "Create a vault" ? (
        <>
          <ul className="mb-4 grid gap-2 sm:grid-cols-3">
            {HOW.map((h) => (
              <li key={h.title} className="flex gap-3 rounded-[20px] bg-[#f5f5f7] p-4 ring-1 ring-inset ring-black/[0.06]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                  <Icon name={h.icon} size={17} />
                </span>
                <div>
                  <div className="text-[15px] tracking-[-0.02em]">{h.title}</div>
                  <p className="mt-0.5 text-[13px] leading-5 text-[#6b6b6b]">{h.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <CreateDaoVault key={createFor} initialDao={createFor} onOpen={open} />
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Already have one?{" "}
            <button type="button" className="cursor-pointer text-black underline underline-offset-2" onClick={() => setPicked("Open a vault")}>
              Open a DAO&apos;s vault
            </button>{" "}
            to see what it holds and vote on its proposals.
          </p>
        </>
      ) : (
        <>
          {(!fromUrl || byName) && (
            <Card className="mb-3 p-5">
              <h2 className="text-[17px] tracking-[-0.03em]">Open a vault by name</h2>
              <p className="mt-0.5 mb-4 text-[13px] text-[#6b6b6b]">Anyone can look. Voting needs a wallet in the DAO.</p>
              <VaultPicker key={vault ?? ""} current={vault} onPick={(v) => (setByName(false), open(v))} />
            </Card>
          )}
          {vault ? (
            <VaultDao key={vault} vault={vault} own={!fromUrl} onCreate={() => setPicked("Create a vault")} initialTab={TAB_PARAM[params.get("tab") ?? ""]} />
          ) : (
            <Card className="mt-3">
              <Empty title="Pick a vault" text="Enter a Kite vault, like treasury.kitevaults.near, to see who owns it and what its DAO is voting on." />
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** The DAOs you're in, each with its Kite vaults (one click to open) or a way to create one. */
function YourDaos({ account, current, onPick, onCreate, onByName }: { account: string | null; current: string | null; onPick: (v: string) => void; onCreate: (dao: string) => void; onByName: () => void }) {
  const [list, setList] = useState<MyDao[] | null>(null);
  useEffect(() => {
    let alive = true;
    myDaos(account).then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [account]);
  if (!list?.length) return null;
  // A vault is open: a slim switcher, so the vault itself has the page.
  if (current)
    return (
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {list.flatMap((d) =>
          d.vaults.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onPick(v)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-[13px] ring-1 ring-inset transition-colors ${
                v === current ? "bg-black text-white ring-black" : "bg-white ring-black/[0.08] hover:bg-[#f5f5f7]"
              }`}
            >
              <Icon name="dao" size={13} />
              {v.replace(`.${NEAR.factory}`, "")}
            </button>
          )),
        )}
        <button type="button" onClick={onByName} className="cursor-pointer px-2 text-[13px] text-[#6b6b6b] underline underline-offset-2 hover:text-black">
          Open another
        </button>
      </div>
    );
  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Icon name="dao" size={17} className="text-black/55" />
        <h2 className="text-[16px] tracking-[-0.02em]">Your DAOs</h2>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((d) => (
          <li key={d.dao} className="rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <div className="truncate text-[14px] tracking-[-0.02em]">{d.dao.replace(".sputnik-dao.near", "")}</div>
            <div className="truncate text-[12px] text-[#6b6b6b]">{d.roles.length ? `You: ${d.roles.join(", ")}` : d.dao}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.vaults.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onPick(v)}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-[13px] ring-1 ring-inset transition-colors ${
                    v === current ? "bg-black text-white ring-black" : "bg-[#f5f5f7] ring-black/[0.06] hover:bg-[#ececef]"
                  }`}
                >
                  {v.replace(`.${NEAR.factory}`, "")}
                </button>
              ))}
              <button type="button" onClick={() => onCreate(d.dao)} className="flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-[#6b6b6b] ring-1 ring-inset ring-black/[0.06] hover:text-black">
                <Icon name="plus" size={12} />
                {d.vaults.length ? "Another vault" : "Create a vault"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
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
        placeholder="treasury.kitevaults.near"
        aria-label="Vault account"
        spellCheck={false}
        autoCapitalize="off"
        className="h-[42px] min-w-0 flex-1 rounded-full bg-white px-4 text-[15px] ring-1 ring-inset ring-black/[0.09] outline-none placeholder:text-black/30 focus:ring-[#8cc6f6] sm:max-w-[420px]"
      />
      <Button type="submit" variant="primary" disabled={!typed || typed === current}>
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

function VaultDao({ vault, own, onCreate, initialTab }: { vault: string; own: boolean; onCreate: () => void; initialTab?: Tab }) {
  const w = useWallet();
  const router = useRouter();
  const [data, setData] = useState<Loaded | { error: string } | null>(null);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [tab, setTab] = useState<Tab | null>(initialTab ?? null);

  useEffect(() => {
    let alive = true;
    load(vault)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ error: own ? "none" : `There's no Kite vault at ${vault}, or NEAR's RPC didn't answer. Check the name and try again.` }));
    return () => {
      alive = false;
    };
  }, [vault, rev, own]);

  /** Sign one DAO transaction, then re-read the vault and proposals once the chain has it. */
  const run = useCallback(
    async (name: string, receiver: string, actions: Action | Action[], ok: string) => {
      setBusy(name);
      setNote(null);
      try {
        await w.send(receiver, Array.isArray(actions) ? actions : [actions]);
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
          title="Your wallet has no vault yet"
          text="That's fine for a DAO: its vault doesn't come from your wallet. The DAO gets its own vault, named after it, by one vote. To look at a vault a DAO already owns, enter its name above."
          action={
            <Button variant="primary" icon="notepad" onClick={onCreate}>
              Create a vault for your DAO
            </Button>
          }
        />
      </Card>
    );
  if ("error" in data) return <StatusNote tone="err" className="mt-3">{data.error}</StatusNote>;

  const { state, owner, pending } = data;
  if (owner) rememberDao(owner.dao);
  const offer = openOffer(state.status);
  const connected = !!w.accountId;
  const daos = [owner, pending && pending.dao !== owner?.dao ? pending : null].filter((x): x is DaoCtx => !!x);

  const open = owner ? owner.proposals.filter((p) => isOpen(p, owner.policy.proposal_period)).length : 0;
  const empty = state.balances.every((b) => b === 0n);
  const shown: Tab = tab ?? (open ? "Proposals" : empty ? "Add money" : "Proposals");
  const proposalList = daos.map((ctx) => (
    <Card key={ctx.dao} className="overflow-hidden">
      {ctx.proposals.length ? (
        <ul className="divide-y divide-black/[0.05] bg-white">
          {ctx.proposals.map((p) => (
            <ProposalRow key={p.id} p={p} vault={vault} planTokens={state.plan.map((t) => t.token)} period={ctx.policy.proposal_period} connected={connected} busy={busy} onApprove={() => approve(ctx, p)} busyKey={`approve-${ctx.dao}-${p.id}`} />
          ))}
        </ul>
      ) : (
        <Empty title="No votes yet" text="Proposals about this vault show here, with a button to approve them." />
      )}
    </Card>
  ));

  return (
    <>
      <Overview
        vault={vault}
        state={state}
        owner={owner?.dao ?? null}
        offer={offer}
        onRefresh={() => setRev((r) => r + 1)}
        onDashboard={
          w.accountId && !w.preview
            ? () => {
                rememberDao(state.status.owner);
                pickMyVault(w.accountId!, vault);
                refreshMyVault(w.accountId!);
                router.push("/console");
              }
            : undefined
        }
      />

      {note && (
        <StatusNote tone={note.tone} className="mt-3">
          {note.text}
        </StatusNote>
      )}

      {offer && pending && (
        <AcceptCard vault={vault} owner={state.status.owner} ctx={pending} account={w.accountId} busy={busy} onPropose={() => propose(pending, "accept", { kind: "accept", offeredBy: state.status.owner })} />
      )}
      {offer && !pending && (
        <Card className="mt-3 p-5">
          <p className="text-[14px] leading-5 text-[#6b6b6b]">Offered to {offer}, which isn&apos;t a DAO. That account accepts it itself.</p>
        </Card>
      )}

      {owner ? (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented options={TABS} value={shown} onChange={setTab} label="Vault sections" size="md" />
            {shown === "Proposals" && open > 0 && <Badge tone="blue">{open} waiting for a vote</Badge>}
          </div>
          {shown === "Proposals" && proposalList}
          {shown === "Add money" && <DaoFundCard vault={vault} dao={owner.dao} policy={owner.policy} proposals={owner.proposals} plan={state.plan} balances={state.balances} pending={!!state.status.pending} rev={rev} busy={busy} send={run} onVotes={() => setTab("Proposals")} />}
          {shown === "Change" && <OwnerActions key={JSON.stringify([state.limits, state.plan])} vault={vault} state={state} ctx={owner} account={w.accountId} busy={busy} onPropose={(name, a) => propose(owner, name, a)} />}
        </div>
      ) : (
        daos.length > 0 && <div className="mt-8 space-y-3">{proposalList}</div>
      )}
    </>
  );
}

const TABS = ["Proposals", "Add money", "Change"] as const;
type Tab = (typeof TABS)[number];
const TAB_PARAM: Record<string, Tab> = { votes: "Proposals", add: "Add money", change: "Change" };

function Overview({ vault, state, owner, offer, onRefresh, onDashboard }: { vault: string; state: VaultState; owner: string | null; offer: string | null; onRefresh: () => void; onDashboard?: () => void }) {
  const { quote } = useMarket();
  const rows = state.plan.map((t, i) => {
    const a = assetByIntentsId(t.token);
    const n = Number(state.balances[i] ?? 0n) / 10 ** t.decimals;
    return { token: t.token, a, n, target: t.target_bps / 100, value: a ? n * quote(a.id).price : null };
  });
  const priced = rows.every((r) => r.value !== null);
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const target = rows.flatMap((r) => (r.a ? [slice(r.a.id, r.target)] : []));
  const g = fromContractLimits(state.limits);
  return (
    <Card className="mt-2 p-2">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 pt-3 pb-4">
        <div className="min-w-0">
          <h2 className="truncate text-[26px] leading-8 tracking-[-0.05em]">{vault.replace(`.${NEAR.factory}`, "")}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[#6b6b6b]">
            <span>{owner ? `Owned by ${owner}` : `Owner ${state.status.owner}`}</span>
            {state.status.paused ? <Badge tone="red">Paused</Badge> : <Badge tone="green">Running</Badge>}
            {state.status.agent ? <Badge tone="green">Kite&apos;s key on</Badge> : <Badge>Kite&apos;s key off</Badge>}
            {offer && <Badge tone="amber">Offered to {offer}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {onDashboard && (
            <Button size="sm" variant="primary" icon="home" onClick={onDashboard}>
              Dashboard
            </Button>
          )}
          <Button size="sm" icon="refresh" onClick={onRefresh}>
            Refresh
          </Button>
          <Button size="sm" href={accountUrl(vault)} external icon="external">
            NearBlocks
          </Button>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex items-center gap-5 rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <Donut slices={target} size={92} thickness={6} />
          <div>
            <div className="text-[13px] text-[#6b6b6b]">Worth now</div>
            <div className="text-[30px] leading-9 tracking-[-0.05em] tabular-nums">{priced ? usd(total) : "–"}</div>
          </div>
        </div>
        <ul className="divide-y divide-black/[0.05] overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          {rows.map((r) => {
            const now = priced && total > 0 && r.value !== null ? (r.value / total) * 100 : null;
            return (
              <li key={r.token} className="flex items-center gap-3 px-4 py-3">
                {r.a ? <Logo id={r.a.id} size={28} /> : <span className="h-7 w-7 rounded-full bg-black/[0.06]" />}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[15px]">{r.a?.name ?? r.token}</div>
                  <div className="text-[13px] text-[#6b6b6b] tabular-nums">
                    {fmtUnits(r.n)} {r.a?.ticker ?? ""}
                  </div>
                </div>
                <div className="hidden w-[120px] sm:block">
                  <div className="flex justify-between text-[12px] text-[#6b6b6b] tabular-nums">
                    <span>{now === null ? "–" : `${now.toFixed(0)}%`} now</span>
                    <span>{r.target}% target</span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-black/[0.06]">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, now ?? 0)}%`, background: r.a ? slice(r.a.id, 0).color : "#999" }} />
                    <div className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-black" style={{ left: `${r.target}%` }} />
                  </div>
                </div>
                <div className="w-[88px] text-right text-[15px] tabular-nums">{r.value === null ? "–" : usd(r.value)}</div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-2 text-[12px]">
        {[`Steps in at ${g.driftBand} pts`, `Biggest trade ${g.maxTradePct}%`, `Worst price ${(g.slippageBps / 100).toFixed(2)}%`, `${g.tradesPerDay} trades a day`].map((t) => (
          <span key={t} className="rounded-full bg-white px-2.5 py-1 text-[#6b6b6b] ring-1 ring-inset ring-black/[0.06]">
            {t}
          </span>
        ))}
      </div>
    </Card>
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
          <Button className="mt-4" variant="primary" size="sm" icon="dao" onClick={onPropose} loading={busy === "accept"} disabled={!account || busy !== null}>
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
  // The target mix, same assets: only the shares change, so each token keeps its decimals and price limit.
  const planNow: Slice[] = state.plan.flatMap((t) => {
    const a = assetByIntentsId(t.token);
    return a ? [slice(a.id, t.target_bps / 100)] : [];
  });
  const planKnown = planNow.length === state.plan.length;
  const [mix, setMix] = useState<Slice[]>(planNow);
  const mixChanged = JSON.stringify(mix.map((s) => s.weight)) !== JSON.stringify(planNow.map((s) => s.weight));
  const proposeMix = () =>
    onPropose("plan", {
      kind: "plan",
      plan: state.plan.map((t, i) => ({ ...t, target_bps: Math.round(mix[i].weight * 100) })),
      text: mix.map((s) => `${assetByIntentsId(state.plan[mix.indexOf(s)].token)?.ticker ?? s.id} ${s.weight}%`).join(", "),
    });

  const [editRules, setEditRules] = useState(false);
  const rights = account ? rightsOf(ctx.policy, account) : null;

  return (
    <div className="space-y-3">
      {(!account || (rights && !rights.propose)) && (
        <Card className="p-4">
          <RightsHint policy={ctx.policy} account={account} need="propose" />
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {planKnown && (
          <Card className="flex flex-col p-5">
            <h3 className="text-[17px] tracking-[-0.03em]">Target mix</h3>
            <p className="mt-0.5 mb-4 text-[13px] text-[#6b6b6b]">Kite trades toward it at its next daily check.</p>
            <MixSliders mix={mix} onChange={setMix} disabled={off} />
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <Button variant="primary" size="sm" onClick={proposeMix} loading={busy === "plan"} disabled={off || !mixChanged || !mixValid(mix) || !!state.status.pending}>
                Propose this mix
              </Button>
              {mixChanged && (
                <Button variant="ghost" size="sm" onClick={() => setMix(planNow)}>
                  Discard
                </Button>
              )}
            </div>
          </Card>
        )}

        <Card className="flex flex-col p-5">
          <h3 className="text-[17px] tracking-[-0.03em]">Rules</h3>
          <p className="mt-0.5 mb-4 text-[13px] text-[#6b6b6b]">The limits the vault enforces on every trade.</p>
          <ul className="space-y-2 text-[14px]">
            {(
              [
                ["Steps in at", `${g.driftBand} pts`],
                ["Biggest single trade", `${g.maxTradePct}%`],
                ["Worst price accepted", `${(g.slippageBps / 100).toFixed(2)}%`],
                ["Trades per day", String(g.tradesPerDay)],
              ] as const
            ).map(([l, v]) => (
              <li key={l} className="flex justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                <span className="text-[#6b6b6b]">{l}</span>
                <span className="tabular-nums">{v}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
            {changed ? (
              <>
                <Button variant="primary" size="sm" onClick={() => onPropose("limits", { kind: "limits", contractLimits: toContractLimits(g, state.limits) })} loading={busy === "limits"} disabled={off}>
                  Propose these rules
                </Button>
                <Button variant="ghost" size="sm" onClick={() => (setG(current), setEditRules(false))}>
                  Discard
                </Button>
              </>
            ) : (
              <Button size="sm" icon="shield" onClick={() => setEditRules((v) => !v)} disabled={off}>
                {editRules ? "Done" : "Change rules"}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {(editRules || changed) && (
        <Card className="p-2">
          <GuardSliders value={g} onChange={setG} vaultUsd={undefined} />
        </Card>
      )}

      <Card className="divide-y divide-black/[0.05] overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-4">
          <div>
            <div className="text-[15px] tracking-[-0.02em]">{state.status.paused ? "Paused" : "Running"}</div>
            <div className="text-[13px] text-[#6b6b6b]">{state.status.paused ? "Kite can't trade until the DAO unpauses." : "Pause stops Kite trading until the DAO unpauses."}</div>
          </div>
          <Button size="sm" onClick={() => onPropose("pause", state.status.paused ? { kind: "unpause" } : { kind: "pause" })} loading={busy === "pause"} disabled={off}>
            {state.status.paused ? "Propose unpause" : "Propose pause"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-4">
          <div>
            <div className="text-[15px] tracking-[-0.02em]">Kite&apos;s key {state.status.agent ? "is on" : "is off"}</div>
            <div className="text-[13px] text-[#6b6b6b]">{state.status.agent ? "It can only rebalance and settle." : "Nothing can trade until it's restored."}</div>
          </div>
          <Button
            size="sm"
            onClick={() => onPropose("key", state.status.agent ? { kind: "revoke" } : { kind: "restore", publicKey: NEAR.agentPublicKey, allowanceYocto: agentAllowanceYocto() })}
            loading={busy === "key"}
            disabled={off || (!state.status.agent && !restoreReady)}
          >
            {state.status.agent ? "Propose removing it" : "Propose restoring it"}
          </Button>
        </div>
      </Card>

      <Disclosure title="Verified treasury policy, written by NEAR AI">
        <TreasuryPolicy
          vault={vault}
          dao={ctx.dao}
          plan={planNow}
          limits={g}
          timing={state.limits}
          planLocked={planKnown ? undefined : "This plan holds a token Kite doesn't recognise, so only the rules can be proposed here."}
        />
      </Disclosure>
      <p className="px-1 text-[12px] text-[#6b6b6b]">Each button files one proposal{bond !== "0" ? ` with the DAO's ${bond} NEAR bond` : ""}. Nothing changes until the DAO approves it.</p>
    </div>
  );
}

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = { InProgress: "blue", Approved: "green", Rejected: "red", Removed: "red", Failed: "red" };

function ProposalRow({
  p,
  vault,
  planTokens,
  period,
  connected,
  busy,
  busyKey,
  onApprove,
}: {
  p: DaoProposal;
  vault: string;
  planTokens: string[];
  period: string;
  connected: boolean;
  busy: string | null;
  busyKey: string;
  onApprove: () => void;
}) {
  const calls = describeCalls(p.kind);
  const lapsed = isLapsed(p, period);
  const swaps = useSwapCheck(p, vault, planTokens);
  const approvable = canApprove(p, vault, period) && (swaps === null || swaps.ok === true);
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
          {p.description && (
            <details className="group mt-2 max-w-[80ch]">
              <summary className="cursor-pointer list-none text-[14px] leading-5 break-words [&::-webkit-details-marker]:hidden">
                <span className="line-clamp-2 group-open:line-clamp-none">{p.description}</span>
                <span className="mt-1 inline-block text-[12px] text-[#6b6b6b] underline underline-offset-2 group-open:hidden">Full text</span>
              </summary>
            </details>
          )}
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
          {swaps && <SwapList check={swaps} />}
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

type SwapCheck = { ok: null } | { ok: true; swaps: CheckedSwap[] } | { ok: false; why: string };

/**
 * For an open `allocate` proposal: check every swap with NEAR Intents before the page offers a vote, because anyone
 * the DAO lets propose can file one. Null for any other proposal.
 */
function useSwapCheck(p: DaoProposal, vault: string, planTokens: string[]): SwapCheck | null {
  // Kite files one allocate per swap; gather the transfers of every allocate in the proposal and check them all.
  const calls = describeCalls(p.kind).filter((c) => c.method === "allocate");
  const transfers = calls.flatMap((c) => {
    const t = (c.args as { transfers?: unknown } | null)?.transfers;
    return Array.isArray(t) ? t : [null];
  });
  const call = calls.length > 0;
  const open = p.status === "InProgress";
  const [check, setCheck] = useState<SwapCheck>({ ok: null });
  const key = JSON.stringify(transfers);
  useEffect(() => {
    if (!call || !open) return;
    let alive = true;
    verifyAllocateProposal({ transfers: JSON.parse(key), vault, planTokens })
      .then((swaps) => alive && setCheck({ ok: true, swaps }))
      .catch((e) => alive && setCheck({ ok: false, why: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the proposal's calls change
  }, [key, open, vault]);
  return call && open ? check : null;
}

function SwapList({ check }: { check: SwapCheck }) {
  if (check.ok === null) return <p className="mt-2 text-[13px] text-[#6b6b6b]">Checking each swap with NEAR Intents…</p>;
  if (check.ok === false)
    return (
      <p className="mt-2 max-w-[80ch] text-[13px] leading-5 text-rose-600">
        Don&apos;t approve this from Kite: {check.why}. Kite won&apos;t offer a vote on it.
      </p>
    );
  const until = Math.min(...check.swaps.map((s) => s.deadlineMs));
  return (
    <div className="mt-2 rounded-xl bg-[#05a800]/[0.06] px-3 py-2 text-[13px] leading-5">
      <div className="text-[#05a800]">Checked with NEAR Intents: every swap pays back to this vault.</div>
      <ul className="mt-1 space-y-0.5">
        {check.swaps.map((s) => {
          const from = assetByIntentsId(s.token);
          const to = assetByIntentsId(s.buy);
          const n = Number(BigInt(s.amount)) / 10 ** (from?.decimals ?? 6);
          return (
            <li key={s.to} className="tabular-nums">
              {fmtUnits(n)} {from?.ticker ?? s.token} → {to?.name ?? s.buy}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-[#6b6b6b]">Quotes good until {new Date(until).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. After that, approving does nothing useful: file a new one.</div>
    </div>
  );
}

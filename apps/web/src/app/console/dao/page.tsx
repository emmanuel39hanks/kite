"use client";

import type { Action } from "@near-js/transactions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { CreateDaoVault } from "@/components/console/create-dao-vault";
import { DaoFundCard } from "@/components/console/dao-fund-card";
import { DaoPayout } from "@/components/console/dao-payout";
import { GuardSliders } from "@/components/console/guard-sliders";
import { MixSliders } from "@/components/console/mix-sliders";
import { TreasuryPolicy } from "@/components/console/treasury-policy";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, Disclosure, Empty, PageTitle, Pager, Segmented, StatusNote, usePaged } from "@/components/console/ui";
import { Donut } from "@/components/charts";
import { Logo } from "@/components/logo";
import { assetByIntentsId, units as fmtUnits, usd } from "@/lib/assets";
import { useMarket } from "@/lib/market/use-market";
import { verifyAllocateProposal, verifyConvert, type CheckedSwap } from "@/lib/near/allocate-check";
import { accountUrl, NEAR, trezuUrl } from "@/lib/near/config";
import { pickMyVault, refreshMyVault, useMyVault } from "@/lib/near/my-vault";
import { closeVaultCalls, usdcInIntents, withdrawAllProposal } from "@/lib/near/dao-fund";
import { myDaos, openDaoRequests, rememberDao, type DaoRequest, type MyDao } from "@/lib/near/known-daos";
import { approveAction, describeCalls, proposeActions, vaultProposals, type DaoProposal } from "@/lib/near/dao";
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
import { rebalanceWarning } from "@/lib/minimums";

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
      <DaoRequests account={w.preview ? null : w.accountId} />
      <YourDaos account={w.preview ? null : w.accountId} current={mode === "Open a vault" ? fromUrl : null} onPick={open} onCreate={(d) => (setCreateFor(d), setPicked("Create a vault"))} onByName={() => (setPicked("Open a vault"), setByName(true))} onOnly={(d) => setCreateFor((c) => c || d)} />

      {mode === "Create a vault" ? (
        <>
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
              <Empty title="Pick a vault" text="Enter a Kite vault, like yourdao.kitevaults.near, to see who owns it and what its DAO is voting on." />
            </Card>
          )}
        </>
      )}
    </>
  );
}

/** Payment requests waiting on your DAOs, with a vote button: approving works on the DAO's real balance. */
function DaoRequests({ account }: { account: string | null }) {
  const w = useWallet();
  const [list, setList] = useState<DaoRequest[] | null>(null);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    myDaos(account)
      .then((d) => openDaoRequests(d.map((x) => x.dao)))
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [account, rev]);
  useEffect(() => {
    const again = () => setRev((x) => x + 1);
    window.addEventListener("kite-dao-requests", again);
    return () => window.removeEventListener("kite-dao-requests", again);
  }, []);
  if (!list?.length && !note) return null;
  const approve = async (r: DaoRequest) => {
    const key = `${r.dao}-${r.id}`;
    setBusy(key);
    setNote(null);
    try {
      // A payment needs little gas, and wallets reserve the cost of all of it up front: ask for only what it needs.
      const near = (r.kind as { Transfer?: { token_id: string } }).Transfer?.token_id === "";
      await w.send(r.dao, [approveAction(r.id, r.kind as DaoProposal["kind"], near ? 50n : 100n)]);
      setNote({ tone: "ok", text: `Approved request ${r.id} on ${r.dao}. If that was the last vote needed, it has been paid.` });
      setTimeout(() => setRev((x) => x + 1), 2500);
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="mb-4 p-4">
      <h2 className="px-1 text-[16px] tracking-[-0.02em]">Waiting for your vote</h2>
      <p className="mb-3 px-1 text-[12px] text-[#6b6b6b]">Payments your DAOs have been asked to make. Your wallet shows the full details before you sign.</p>
      <ul className="space-y-2">
        {(list ?? []).map((r) => (
          <li key={`${r.dao}-${r.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <div className="min-w-0">
              <div className="text-[14px] break-all">{r.text}</div>
              <div className="text-[12px] text-[#6b6b6b]">
                {r.dao.replace(".sputnik-dao.near", "")} · request {r.id}
              </div>
            </div>
            <Button size="sm" variant="primary" icon="check" onClick={() => approve(r)} loading={busy === `${r.dao}-${r.id}`} disabled={!w.accountId || busy !== null}>
              Approve
            </Button>
          </li>
        ))}
      </ul>
      {note && (
        <StatusNote tone={note.tone} className="mt-3">
          {note.text}
        </StatusNote>
      )}
    </Card>
  );
}

/** The DAOs you're in, each with its Kite vaults (one click to open) or a way to create one. */
function YourDaos({ account, current, onPick, onCreate, onByName, onOnly }: { account: string | null; current: string | null; onPick: (v: string) => void; onCreate: (dao: string) => void; onByName: () => void; onOnly?: (dao: string) => void }) {
  const [list, setList] = useState<MyDao[] | null>(null);
  // In exactly one DAO: the create form starts with it filled in.
  const only = list?.length === 1 ? list[0].dao : null;
  useEffect(() => {
    if (only) onOnly?.(only);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tell the parent when the one DAO changes, not when its callback does
  }, [only]);
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
            <DaoPayout dao={d.dao} onFiled={() => window.dispatchEvent(new Event("kite-dao-requests"))} />
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
        placeholder="yourdao.kitevaults.near"
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

/** One read of the vault and its DAO, tried a few times: right after a wallet signature, NEAR's RPC often stumbles once. */
async function load(vault: string): Promise<Loaded> {
  for (let i = 0; ; i++) {
    try {
      return await loadOnce(vault);
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

async function loadOnce(vault: string): Promise<Loaded> {
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
      // A refresh that fails keeps what's on screen; only a first load can end in "no vault here".
      .catch(() => alive && setData((prev) => (prev && !("error" in prev) ? prev : { error: own ? "none" : `There's no Kite vault at ${vault}, or NEAR's RPC didn't answer. Check the name and try again.` })));
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
      } catch (e) {
        // A wallet can report "cancelled" for a transaction it did send (its window was closed before it answered).
        // The chain is the judge: say what the wallet said, then re-read below like any other outcome.
        const said = e instanceof Error ? e.message : String(e);
        setNote({ tone: "err", text: /cancel|closed|reject/i.test(said) ? `${said}. If you did approve it in your wallet, it shows below in a few seconds.` : said });
      } finally {
        setBusy(null);
        // The chain takes a few seconds to show a new proposal or balance. Re-read a few times so the page
        // moves on by itself instead of waiting for a manual refresh.
        for (const ms of [1200, 3500, 8000, 16000]) setTimeout(() => setRev((r) => r + 1), ms);
      }
    },
    [w],
  );
  // Votes and swaps land without this page doing anything (a vote cast in Trezu, Kite's hourly trade). Re-read while
  // the page is in view: every 5 seconds while a proposal is waiting for votes, every 12 otherwise, and at once when
  // someone comes back to this tab.
  const waiting = !!data && !("error" in data) && [data.owner, data.pending].some((c) => c?.proposals.some((p) => isOpen(p, c.policy.proposal_period)));
  useEffect(() => {
    const reread = () => document.visibilityState === "visible" && setRev((r) => r + 1);
    const t = setInterval(reread, waiting ? 5_000 : 12_000);
    document.addEventListener("visibilitychange", reread);
    window.addEventListener("focus", reread);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", reread);
      window.removeEventListener("focus", reread);
    };
  }, [waiting]);

  const propose = async (ctx: DaoCtx, name: string, action: OwnerAction) => {
    const { description, calls, gasTgas } = ownerProposal(vault, action);
    const { actions, topUp } = await proposeActions(ctx.dao, vault, description, calls, BigInt(ctx.policy.proposal_bond), gasTgas);
    const added = topUp > 0n ? ` ${(Number(topUp / 10n ** 18n) / 1e6).toFixed(3)} NEAR went along for the DAO's storage.` : "";
    return run(name, ctx.dao, actions, `Proposal sent to ${ctx.dao}.${added} It runs once the DAO approves it.`);
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
  const planTokens = state.plan.map((t) => t.token);
  const proposalList = daos.map((ctx) => (
    <ProposalsCard key={ctx.dao} ctx={ctx} vault={vault} planTokens={planTokens} connected={connected} busy={busy} onApprove={(p) => approve(ctx, p)} />
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
          {shown === "Add money" && <DaoFundCard vault={vault} dao={owner.dao} policy={owner.policy} proposals={owner.proposals} plan={state.plan} balances={state.balances} pending={!!state.status.pending} rev={rev} busy={busy} send={run} onVotes={() => setTab("Proposals")} onApprove={(p) => run(`approve-${owner.dao}-${p.id}`, owner.dao, approveAction(p.id, p.kind), `Vote recorded on proposal ${p.id}.`)} />}
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
  // What the vault holds, in dollars: the vault refuses trades under $1, so its size decides which rules can trade at all.
  const { quote } = useMarket();
  const vaultUsd = state.plan.reduce((sum, t, i) => {
    const a = assetByIntentsId(t.token);
    return a ? sum + (Number(state.balances[i] ?? 0n) / 10 ** t.decimals) * quote(a.id).price : sum;
  }, 0);
  const sizeWarning = vaultUsd > 0 ? rebalanceWarning(vaultUsd, g, state.plan.length) : null;
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
            <p className="mt-0.5 mb-4 text-[13px] text-[#6b6b6b]">Kite trades toward it at its next hourly check.</p>
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
          <GuardSliders value={g} onChange={setG} vaultUsd={vaultUsd || undefined} assets={state.plan.length} />
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

      <TakeOut vault={vault} state={state} ctx={ctx} off={off} busy={busy} onPropose={onPropose} />

      <Disclosure title="Verified treasury policy, written by NEAR AI">
        {sizeWarning && (
          <StatusNote tone="warn" className="mb-2">
            {sizeWarning}
          </StatusNote>
        )}
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

/** Money back to the DAO as USDC, then closing the vault for its NEAR deposit. Both are proposals. */
function TakeOut({ vault, state, ctx, off, busy, onPropose }: { vault: string; state: VaultState; ctx: DaoCtx; off: boolean; busy: string | null; onPropose: (name: string, a: OwnerAction) => void }) {
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    let alive = true;
    usdcInIntents(vault).then((v) => alive && setUsdc(v)).catch(() => alive && setUsdc(null));
    return () => {
      alive = false;
    };
  }, [vault, state]);
  const holdings = [...state.plan.map((t, i) => ({ token: t.token, amount: state.balances[i] ?? 0n })), ...(state.plan.some((t) => t.token === NEAR.usdc) ? [] : [{ token: NEAR.usdc, amount: usdc ?? 0n }])].filter((h) => h.amount > 0n);
  const empty = usdc !== null && holdings.length === 0;
  const hours = Math.max(1, Math.min(72, Math.ceil(Number(BigInt(ctx.policy.proposal_period) / 1_000_000_000n) / 3600)));
  const names = (t: string) => assetByIntentsId(t)?.name ?? t;

  const withdraw = async () => {
    setErr(null);
    setQuoting(true);
    try {
      const p = await withdrawAllProposal({ vault, dao: ctx.dao, holdings, hours, names });
      onPropose("withdraw", { kind: "prepared", description: p.description, calls: p.calls, gasTgas: p.gasTgas });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  };
  const close = () => {
    const c = closeVaultCalls();
    onPropose("close", { kind: "prepared", description: `Close Kite vault ${vault}. It's empty; the vault deletes itself and its ${NEAR.factoryDepositNear} NEAR deposit (less gas used) goes back to this DAO.`, calls: c.calls, gasTgas: c.gasTgas });
  };

  return (
    <Card className="divide-y divide-black/[0.05] overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-4">
        <div>
          <div className="text-[15px] tracking-[-0.02em]">Withdraw everything as USDC</div>
          <div className="text-[13px] text-[#6b6b6b]">Every holding is swapped to USDC and paid to {ctx.dao}. Approve within {hours} hours.</div>
        </div>
        <Button size="sm" icon="withdraw" onClick={withdraw} loading={quoting || busy === "withdraw"} disabled={off || holdings.length === 0 || !!state.status.pending}>
          Propose withdrawing
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-4">
        <div>
          <div className="text-[15px] tracking-[-0.02em]">Close the vault</div>
          <div className="text-[13px] text-[#6b6b6b]">{empty ? `Returns the ${NEAR.factoryDepositNear} NEAR deposit to the DAO.` : "Once it's empty. Withdraw first."}</div>
        </div>
        <Button size="sm" variant="danger" onClick={close} loading={busy === "close"} disabled={off || !empty || !!state.status.pending}>
          Propose closing
        </Button>
      </div>
      {err && <p className="bg-white px-5 pb-4 text-[13px] text-rose-600">{err}</p>}
    </Card>
  );
}

const STATUS_TONE: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = { InProgress: "blue", Approved: "green", Rejected: "red", Removed: "red", Failed: "red" };

/** One DAO's proposals about this vault, newest first, five to a page. */
function ProposalsCard({ ctx, vault, planTokens, connected, busy, onApprove }: { ctx: DaoCtx; vault: string; planTokens: string[]; connected: boolean; busy: string | null; onApprove: (p: DaoProposal) => void }) {
  const paged = usePaged(ctx.proposals, 5);
  return (
    <Card className="overflow-hidden">
      {ctx.proposals.length ? (
        <>
          <ul className="divide-y divide-black/[0.05] bg-white">
            {paged.rows.map((p) => (
              <ProposalRow key={p.id} p={p} dao={ctx.dao} vault={vault} planTokens={planTokens} period={ctx.policy.proposal_period} connected={connected} busy={busy} onApprove={() => onApprove(p)} busyKey={`approve-${ctx.dao}-${p.id}`} />
            ))}
          </ul>
          <Pager {...paged} label="Proposal pages" />
        </>
      ) : (
        <Empty title="No votes yet" text="Proposals about this vault show here, with a button to approve them." />
      )}
    </Card>
  );
}

function ProposalRow({
  p,
  dao,
  vault,
  planTokens,
  period,
  connected,
  busy,
  busyKey,
  onApprove,
}: {
  p: DaoProposal;
  dao: string;
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
  const out = useWithdrawCheck(p, dao);
  const approvable = canApprove(p, vault, period) && (swaps === null || swaps.ok === true) && (out === null || out.ok === true);
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
          {out && (
            <p className={`mt-2 text-[13px] ${out.ok === false ? "text-rose-600" : out.ok ? "text-[#05a800]" : "text-[#6b6b6b]"}`}>
              {out.ok === null ? "Checking each withdrawal with NEAR Intents…" : out.ok ? `Checked: every withdrawal becomes USDC paid to ${dao}.` : `Not offered for a vote: ${out.why}`}
            </p>
          )}
        </div>
        {approvable && (
          // Trezu sponsors the vote's gas, so that's the default; Kite has already checked the calls above.
          trezuUrl(dao) ? (
            <div className="flex flex-col items-end gap-1.5">
              <Button size="sm" variant="primary" icon="external" href={trezuUrl(dao)!} external>
                Approve in Trezu
              </Button>
              <button type="button" onClick={onApprove} disabled={!connected || busy !== null} className="cursor-pointer text-[12px] text-[#6b6b6b] underline underline-offset-2 hover:text-black disabled:cursor-not-allowed disabled:opacity-50">
                {busy === busyKey ? "Waiting for your wallet…" : "or approve here"}
              </button>
            </div>
          ) : (
            <Button size="sm" variant="primary" icon="check" onClick={onApprove} loading={busy === busyKey} disabled={!connected || busy !== null}>
              Approve
            </Button>
          )
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
/**
 * A proposal that withdraws from the vault must pay the DAO: either straight to the DAO's account, or to a 1Click
 * address that NEAR Intents confirms swaps into USDC delivered to the DAO (refunds to the DAO). Anything else isn't
 * offered for a vote here.
 */
function useWithdrawCheck(p: DaoProposal, dao: string): { ok: null } | { ok: true } | { ok: false; why: string } | null {
  const calls = describeCalls(p.kind).filter((c) => c.method === "withdraw" || c.method === "withdraw_external");
  const open = p.status === "InProgress";
  const key = JSON.stringify(calls);
  const [check, setCheck] = useState<{ ok: null } | { ok: true } | { ok: false; why: string }>({ ok: null });
  useEffect(() => {
    if (!calls.length || !open) return;
    let alive = true;
    (async () => {
      const list = JSON.parse(key) as { method: string; args: { token?: string; amount?: string; receiver_id?: string } | null }[];
      const swaps: { token: string; amount: string; to: string }[] = [];
      for (const c of list) {
        const a = c.args ?? {};
        if (c.method === "withdraw_external") {
          if (a.receiver_id !== dao) throw new Error(`a withdrawal pays ${a.receiver_id ?? "someone"}, not ${dao}`);
          continue;
        }
        if (!a.token || !a.amount || !a.receiver_id) throw new Error("a withdrawal is missing its details");
        if (a.receiver_id !== dao) swaps.push({ token: a.token, amount: a.amount, to: a.receiver_id });
      }
      if (swaps.length) await verifyConvert({ transfers: swaps, owner: dao, usdcToken: NEAR.usdc });
    })()
      .then(() => alive && setCheck({ ok: true }))
      .catch((e) => alive && setCheck({ ok: false, why: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the proposal's calls change
  }, [key, open, dao]);
  return calls.length && open ? check : null;
}

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

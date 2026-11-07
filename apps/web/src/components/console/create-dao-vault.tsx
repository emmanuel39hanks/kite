"use client";

import { useEffect, useState } from "react";
import { Donut } from "@/components/charts";
import { MixBuilder } from "@/components/console/mix-builder";
import { GuardSliders } from "@/components/console/guard-sliders";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, StatusNote } from "@/components/console/ui";
import { RULE_PRESETS, sameRules } from "@/lib/guard-presets";
import { MAX_ASSETS, mixValid, type Slice } from "@/lib/mix";
import { Logo } from "@/components/logo";
import { ASSETS, assetById } from "@/lib/assets";
import { NEAR, trezuUrl } from "@/lib/near/config";
import { approveAction, type DaoProposal } from "@/lib/near/dao";
import { canApprove, cleanAccount, nearFromYocto, readDaoPolicy, rightsOf, type DaoPolicy } from "@/lib/near/dao-view";
import { rememberDao } from "@/lib/near/known-daos";
import { minToRebalance } from "@/lib/minimums";
import {
  createVaultDescription,
  createVaultKind,
  createVaultProposalAction,
  claimRefundProposalAction,
  refundOwed,
  vaultBelongsTo,
  factoryVaultId,
  factoryVerified,
  findCreateProposal,
  proposalVaultName,
  readFactory,
  spendableNear,
  validVaultName,
  vaultNameFree,
  type FactoryConfig,
} from "@/lib/near/factory";
import { useWallet } from "@/lib/near/wallet";
import { JsonRpcProvider } from "near-api-js";
import { PLAN_DATA } from "@/lib/plans";
import { DEFAULT_GUARDRAILS, type Guardrails } from "@/lib/store";

const field =
  "h-[42px] w-full rounded-full bg-white px-4 text-[15px] ring-1 ring-inset ring-black/[0.09] outline-none placeholder:text-black/30 focus:ring-[#8cc6f6] disabled:opacity-60";
const PLANS = PLAN_DATA.filter((p) => !p.comingSoon);
const provider = new JsonRpcProvider({ url: NEAR.rpc });
/** Room above the vault's deposit for the proposal's own storage on the DAO and other proposals that spend first. */
const MARGIN = 10n ** 23n;

type Check = { ok: boolean | null; text: string };
type Checked = {
  /** The inputs these answers belong to: a check never vouches for different inputs. */
  for: string;
  factory: FactoryConfig | null;
  verified: { locked: boolean; sameCode: boolean } | null;
  policy: DaoPolicy | null;
  spendable: bigint | null;
  free: boolean | null;
  /** A create proposal the connected wallet already filed for this name (e.g. before a wallet redirect). */
  existing: DaoProposal | null;
  /** NEAR the factory owes this DAO from a failed creation. */
  owed: bigint;
};

/** A vault name from the DAO's own: `foo` from `foo.sputnik-dao.near`. */
const nameFor = (dao: string) => dao.split(".")[0].replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "").replace(/[-_]{2,}/g, "-").slice(0, 32);

/**
 * A DAO creates its own vault: a council member files one proposal that calls Kite's factory, and when it
 * passes the vault exists as `<name>.kitevaults.near`, owned by the DAO from the first block.
 */
export function CreateDaoVault({ onOpen, initialDao = "" }: { onOpen: (vault: string) => void; initialDao?: string }) {
  const w = useWallet();
  const [dao, setDao] = useState(initialDao);
  const [name, setName] = useState(initialDao ? nameFor(initialDao) : "");
  const [nameTouched, setNameTouched] = useState(false);
  const [planSlug, setPlanSlug] = useState(PLANS[PLANS.length - 1]?.slug ?? "");
  /** "custom" once the council builds its own mix instead of taking one of Kite's plans. */
  const [custom, setCustom] = useState<Slice[] | null>(null);
  const [fineTune, setFineTune] = useState(false);
  const [g, setG] = useState<Guardrails>(DEFAULT_GUARDRAILS);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DaoProposal | null>(null);
  /** After a vote: whether the vault under that name is really this DAO's (null until checked). */
  const [ours, setOurs] = useState<boolean | null>(null);

  const daoId = cleanAccount(dao);
  const plan = PLANS.find((p) => p.slug === planSlug) ?? PLANS[0];
  const mix = custom ?? plan.mix;
  const mixOk = mixValid(mix);
  const vault = validVaultName(name) ? factoryVaultId(name) : null;
  const key = `${daoId}|${name}|${w.accountId ?? ""}`;
  const current = checked?.for === key ? checked : null;

  // Read everything the proposal depends on, a moment after typing stops.
  useEffect(() => {
    if (!daoId || !vault) return;
    let alive = true;
    const t = setTimeout(async () => {
      const [factory, policy, spendable, free, existing, owed] = await Promise.all([
        readFactory(),
        readDaoPolicy(daoId).catch(() => null),
        spendableNear(daoId).catch(() => null),
        vaultNameFree(name).catch(() => null),
        w.accountId && !w.preview ? findCreateProposal(daoId, w.accountId, name).catch(() => null) : Promise.resolve(null),
        refundOwed(daoId),
      ]);
      const verified = factory ? await factoryVerified(factory).catch(() => null) : null;
      if (alive) setChecked({ for: key, factory, verified, policy, spendable, free, existing, owed });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [daoId, vault, name, key, w.accountId, w.preview]);

  const rights = current?.policy ? rightsOf(current.policy, w.accountId) : null;
  const need = (current?.factory ? BigInt(current.factory.min_deposit) : 0n) + MARGIN;
  const deposit = current?.factory ? nearFromYocto(BigInt(current.factory.min_deposit), 2) : NEAR.factoryDepositNear;
  const checks: Check[] = !daoId || !vault || !current
    ? []
    : [
        !current.factory
          ? { ok: false, text: `Kite's factory isn't live at ${NEAR.factory} yet` }
          : { ok: !!current.verified?.locked && !!current.verified?.sameCode, text: !current.verified ? `Couldn't check ${NEAR.factory}` : !current.verified.locked ? `${NEAR.factory} still has keys, so it could be changed` : !current.verified.sameCode ? `${NEAR.factory} deploys different code from this site's vault` : `${NEAR.factory} has no keys and deploys this site's vault code` },
        { ok: !!NEAR.agentPublicKey, text: NEAR.agentPublicKey ? "Kite's key goes on the vault, limited to rebalance and settle" : "This site has no Kite key set, so nothing would trade" },
        { ok: !!current.policy, text: current.policy ? `${daoId} is a SputnikDAO` : `${daoId} isn't a SputnikDAO Kite can read` },
        { ok: current.free, text: current.free === null ? `Couldn't check whether ${vault} is free` : current.free ? `${vault} is free` : `${vault} is taken` },
        {
          ok: current.spendable === null ? null : current.spendable >= need,
          text:
            current.spendable === null
              ? "Couldn't read the DAO's balance"
              : current.spendable >= need
                ? `The DAO has ${nearFromYocto(current.spendable, 2)} NEAR to spend; the vault takes ${deposit}`
                : `The DAO has ${nearFromYocto(current.spendable, 2)} NEAR to spend; send it ${nearFromYocto(need - current.spendable, 2)} more (${deposit} for the vault, 0.1 to spare)`,
        },
        !w.accountId || w.preview
          ? { ok: null, text: "Connect a real wallet that's on the DAO's council to file it" }
          : { ok: !!rights?.propose, text: rights?.propose ? `${w.accountId} can file proposals on ${daoId}` : `${w.accountId} can't file proposals on ${daoId}` },
      ];
  const openExisting = current?.existing?.status === "InProgress" ? current.existing : null;
  const ready = mixOk && checks.length > 0 && checks.every((c) => c.ok === true) && !w.preview && !openExisting;

  const [owedNow, setOwedNow] = useState(0n);
  const [note, setNote] = useState<string | null>(null);

  /** Show a proposal, and check what's really at its name: whatever voted it through (Kite, Trezu, anyone). */
  const reread = async (id: number) => {
    if (!daoId) return;
    const p = (await provider.callFunction({ contractId: daoId, method: "get_proposal", args: { id } })) as DaoProposal;
    setProposal(p);
    setOwedNow(p.status === "Failed" ? await refundOwed(daoId) : 0n);
    const n = proposalVaultName(p);
    if (n) {
      const made = !(await vaultNameFree(n));
      setOurs(made ? await vaultBelongsTo(n, daoId) : null);
    }
  };

  const propose = async () => {
    if (!ready || !daoId || !current?.policy || !w.accountId || busy) return;
    setBusy("Waiting for your wallet…");
    setErr(null);
    try {
      await w.send(daoId, [createVaultProposalAction(daoId, name, mix, g, BigInt(current.policy.proposal_bond), (id) => assetById(id).name)]);
      rememberDao(daoId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    // Whatever the wallet said, look for the proposal itself: ours, for this name, newest first.
    try {
      setBusy("Finding the proposal…");
      const p = await findCreateProposal(daoId, w.accountId, name);
      if (p) {
        setErr(null);
        await reread(p.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!proposal || !daoId || busy) return;
    setBusy("Waiting for your wallet…");
    setErr(null);
    try {
      await w.send(daoId, [approveAction(proposal.id, proposal.kind)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    try {
      setBusy("Checking the vault…");
      await new Promise((r) => setTimeout(r, 3000));
      await reread(proposal.id);
    } catch {
      /* the badge keeps the last status we read */
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!daoId) return;
    try {
      const args = { proposal: { description: createVaultDescription(daoId, name, mix, g, (id) => assetById(id).name), kind: createVaultKind(name, mix, g) } };
      await navigator.clipboard.writeText(JSON.stringify(args, null, 2));
    } catch (e) {
      setErr(e instanceof Error && !/clipboard/i.test(e.message) ? e.message : "Couldn't copy. Your browser blocked the clipboard.");
    }
  };

  const claim = async () => {
    if (!daoId || !current?.policy || busy) return;
    setBusy("Waiting for your wallet…");
    setErr(null);
    try {
      await w.send(daoId, [claimRefundProposalAction(BigInt(current.policy.proposal_bond))]);
      setErr(null);
      setNote(`Claim filed on ${daoId}. Once the council approves it, ${NEAR.factory} sends the NEAR back to the DAO.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const voted = !!(proposal && w.accountId && (proposal as DaoProposal & { votes?: Record<string, unknown> }).votes?.[w.accountId]);
  const canVote = proposal && !voted && rights?.approve && canApprove(proposal, NEAR.factory, current?.policy?.proposal_period);
  const proposed = proposal ? proposalVaultName(proposal) : null;

  const rulePreset = RULE_PRESETS.find((p) => sameRules(p.g, g));
  const statusTone = proposal?.status === "Approved" ? "green" : proposal?.status === "InProgress" ? "amber" : "red";

  return (
    <Card className="p-2">
      <div className="rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)] sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[24px] tracking-[-0.04em]">Create a vault for your DAO</h2>
            <p className="mt-1 max-w-[60ch] text-[15px] leading-[22px] text-[#6b6b6b]">
              One vote, and the DAO has its own vault at <span className="text-black">name.{NEAR.factory}</span>. It belongs to the DAO from the first block; no one&apos;s wallet ever holds it.
            </p>
          </div>
          {proposal && (
            <Badge tone={statusTone}>
              Proposal {proposal.id}: {proposal.status === "InProgress" ? "open" : proposal.status === "Approved" ? "passed" : proposal.status.toLowerCase()}
            </Badge>
          )}
        </div>

        {!proposal && (
          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <ol className="space-y-8">
              <Step n={1} title="Which DAO">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] text-[#6b6b6b]">The DAO</span>
                    <input
                      value={dao}
                      onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        setDao(v);
                        if (!nameTouched) setName(nameFor(v));
                      }}
                      placeholder="yourdao.sputnik-dao.near"
                      spellCheck={false}
                      autoCapitalize="off"
                      className={field}
                      disabled={!!busy}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] text-[#6b6b6b]">Vault name</span>
                    <div className="relative">
                      <input value={name} onChange={(e) => (setName(e.target.value.trim().toLowerCase()), setNameTouched(true))} placeholder="treasury" spellCheck={false} autoCapitalize="off" className={`${field} pr-[132px]`} disabled={!!busy} />
                      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-black/35">.{NEAR.factory}</span>
                    </div>
                    {name && !vault && <span className="mt-1 block text-[12px] text-rose-600">2 to 32 lowercase letters, digits, - or _.</span>}
                  </label>
                </div>
              </Step>

              <Step n={2} title="What it holds" hint={`Start from one of Kite's plans, or pick your own two to ${MAX_ASSETS} assets.`}>
                <div role="radiogroup" aria-label="What the vault holds" className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                  {PLANS.map((p) => {
                    const on = !custom && p.slug === planSlug;
                    return (
                      <button
                        key={p.slug}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!!busy}
                        onClick={() => (setPlanSlug(p.slug), setCustom(null))}
                        className={`cursor-pointer rounded-2xl p-3.5 text-left transition-[background-color,box-shadow] ${on ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"}`}
                      >
                        <div className="flex -space-x-1.5">
                          {p.mix.map((s) => (
                            <Logo key={s.id} id={s.id} size={22} className={on ? "ring-2 ring-white" : "ring-2 ring-[#f5f5f7]"} />
                          ))}
                        </div>
                        <div className="mt-2 text-[15px] tracking-[-0.02em]">{p.name}</div>
                        <div className="truncate text-[12px] text-[#6b6b6b]">{p.mix.map((s) => `${assetById(s.id).ticker} ${s.weight}%`).join(", ")}</div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!!custom}
                    disabled={!!busy}
                    onClick={() => !custom && setCustom(plan.mix)}
                    className={`flex cursor-pointer flex-col justify-between rounded-2xl p-3.5 text-left transition-[background-color,box-shadow] ${custom ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"}`}
                  >
                    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-black text-white">
                      <Icon name="plus" size={13} stroke={2} />
                    </span>
                    <span>
                      <span className="mt-2 block text-[15px] tracking-[-0.02em]">Build your own</span>
                      <span className="block text-[12px] text-[#6b6b6b]">Any {MAX_ASSETS} of {PICKABLE} assets</span>
                    </span>
                  </button>
                </div>
                {custom && (
                  <div className="mt-3">
                    <MixBuilder mix={custom} onChange={setCustom} disabled={!!busy} />
                    {!mixOk && <p className="mt-2 text-[12px] text-rose-600">Pick at least two assets.</p>}
                  </div>
                )}
              </Step>

              <Step n={3} title="How Kite trades" hint="Written into the vault. Kite can't change them; only a DAO vote can.">
                <div role="radiogroup" aria-label="Rules" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RULE_PRESETS.map((p) => {
                    const on = !fineTune && rulePreset?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!!busy}
                        onClick={() => (setG(p.g), setFineTune(false))}
                        className={`cursor-pointer rounded-2xl px-3.5 py-3 text-left transition-[background-color,box-shadow] ${on ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"}`}
                      >
                        <div className="text-[15px] tracking-[-0.02em]">{p.label}</div>
                        <div className="text-[12px] text-[#6b6b6b]">
                          {p.g.driftBand} pts drift, {p.g.tradesPerDay}/day
                        </div>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={fineTune || !rulePreset}
                    disabled={!!busy}
                    onClick={() => setFineTune(true)}
                    className={`cursor-pointer rounded-2xl px-3.5 py-3 text-left transition-[background-color,box-shadow] ${fineTune || !rulePreset ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#ececef]"}`}
                  >
                    <div className="text-[15px] tracking-[-0.02em]">Fine-tune</div>
                    <div className="text-[12px] text-[#6b6b6b]">Set each limit</div>
                  </button>
                </div>
                <p className="mt-3 text-[13px] leading-5 text-[#6b6b6b]">
                  Trades when anything drifts {g.driftBand} points, moves at most {g.maxTradePct}% of the vault at once, refuses a price more than {(g.slippageBps / 100).toFixed(2)}% under fair value, and makes up to {g.tradesPerDay} trade{g.tradesPerDay === 1 ? "" : "s"} a day.
                </p>
                {(fineTune || !rulePreset) && (
                  <div className="mt-3 rounded-2xl bg-[#f5f5f7] p-2">
                    <GuardSliders value={g} onChange={setG} />
                  </div>
                )}
                <p className="mt-3 text-[13px] leading-5 text-[#6b6b6b]">
                  Every trade Kite makes is at least $1; the vault refuses smaller ones. With these rules Kite steps in on time once the vault holds about{" "}
                  <span className="text-black">${minToRebalance(g, mix.length)}</span>. Funding it with less still invests the money; it just waits for a bigger drift, or never trades if the biggest trade is under $1.
                </p>
              </Step>
            </ol>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl bg-[#f5f5f7] p-4">
                <div className="text-[13px] text-[#6b6b6b]">The proposal</div>
                <div className="mt-1 truncate text-[17px] tracking-[-0.03em]">{vault ?? "name." + NEAR.factory}</div>
                <div className="mt-4 flex items-center gap-4">
                  <div className="shrink-0">
                    <Donut slices={mixOk ? mix : []} size={92} thickness={6} />
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1">
                    {mix.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-[13px]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                        <span className="min-w-0 flex-1 truncate">{assetById(s.id).ticker}</span>
                        <span className="tabular-nums text-[#6b6b6b]">{s.weight}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <dl className="mt-4 space-y-1.5 border-t border-black/[0.06] pt-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#6b6b6b]">Owner</dt>
                    <dd className="truncate">{daoId ?? "the DAO"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#6b6b6b]">From the DAO</dt>
                    <dd className="tabular-nums">{deposit} NEAR</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#6b6b6b]">Back on close</dt>
                    <dd>All but gas</dd>
                  </div>
                </dl>

                {checks.length > 0 && (
                  <ul className="mt-4 space-y-1.5 border-t border-black/[0.06] pt-3">
                    {checks.map((c) => (
                      <li key={c.text} className="flex items-start gap-2 text-[12px] leading-[18px]">
                        <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.ok ? "bg-[#05a800] text-white" : c.ok === false ? "bg-rose-500 text-white" : "bg-black/10"}`}>
                          {c.ok !== null && <Icon name={c.ok ? "check" : "x"} size={10} stroke={2.4} />}
                        </span>
                        <span className="min-w-0 break-words">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!checks.length && <p className="mt-4 border-t border-black/[0.06] pt-3 text-[12px] leading-[18px] text-[#6b6b6b]">Enter the DAO and a name, and Kite checks the factory, the DAO, the name and the balance on NEAR before anything is filed.</p>}

                <div className="mt-4 grid gap-2">
                  <Button variant="primary" icon="share" onClick={propose} loading={!!busy} disabled={!ready} className="w-full">
                    {busy ?? "Propose to the DAO"}
                  </Button>
                  {daoId && vault && mixOk && (
                    <Button icon="copy" onClick={copy} className="w-full">
                      Copy the proposal
                    </Button>
                  )}
                </div>
                {w.preview && <p className="mt-2 text-[12px] leading-[18px] text-[#6b6b6b]">The preview can&apos;t file DAO proposals. Connect a real wallet that&apos;s on the council.</p>}
              </div>

              {current && current.owed > 0n && (
                <StatusNote tone="ok" className="mt-3">
                  {NEAR.factory} owes {daoId} {nearFromYocto(current.owed, 2)} NEAR from a vault creation that failed. The DAO gets it back with one proposal.{" "}
                  {rights?.propose && !w.preview && (
                    <button type="button" className="cursor-pointer underline underline-offset-2" onClick={claim}>
                      Propose claiming it
                    </button>
                  )}
                </StatusNote>
              )}
              {note && (
                <StatusNote tone="ok" className="mt-3">
                  {note}
                </StatusNote>
              )}
              {openExisting && (
                <StatusNote tone="ok" className="mt-3">
                  You already filed proposal {openExisting.id} on {daoId} for this vault, and it&apos;s still open.{" "}
                  <button type="button" className="cursor-pointer underline underline-offset-2" onClick={() => void reread(openExisting.id).catch(() => setProposal(openExisting))}>
                    Open it
                  </button>
                </StatusNote>
              )}
            </aside>
          </div>
        )}

        {proposal && (
          <div className="mt-6 space-y-4">
            <ProposalSteps status={proposal.status} made={ours === true} />
            <p className="max-w-[70ch] text-[15px] leading-[22px]">
              Proposal {proposal.id} on {daoId} asks the DAO to create <span className="font-mono text-[14px]">{proposed ? factoryVaultId(proposed) : "a vault"}</span>.{" "}
              {proposal.status === "InProgress"
                ? "Once enough of the council approves it, the DAO pays the deposit and the vault appears."
                : proposal.status === "Approved"
                  ? "It passed."
                  : owedNow > 0n
                    ? `It didn't run, and nothing was created. ${NEAR.factory} holds ${nearFromYocto(owedNow, 2)} NEAR for the DAO, which it gets back with one claim proposal (on the form).`
                    : "It didn't run. Nothing was created, and the DAO's NEAR came back."}
            </p>
            <div className="flex flex-wrap gap-2">
              {canVote && (
                <>
                  <Button variant="primary" icon="external" href={trezuUrl(daoId)} external>
                    Approve in Trezu
                  </Button>
                  <Button variant="ghost" icon="check" onClick={approve} loading={!!busy}>
                    {busy ?? "Approve here"}
                  </Button>
                </>
              )}
              {ours === true && proposed && (
                <Button variant="primary" iconRight="arrow-right" onClick={() => onOpen(factoryVaultId(proposed))}>
                  Open the vault
                </Button>
              )}
              <Button variant="ghost" onClick={() => (setProposal(null), setOurs(null))}>
                Start again
              </Button>
            </div>
            {ours === false && proposed && (
              <StatusNote tone="err">
                {factoryVaultId(proposed)} exists, but it isn&apos;t {daoId}&apos;s: someone else created it first.{" "}
                {proposal.status === "InProgress" ? "This proposal will fail when it runs, and the DAO keeps its NEAR." : "The DAO's proposal failed and the DAO keeps its NEAR."} Start again with another name, and don&apos;t send anything to that vault.
              </StatusNote>
            )}
            {proposal.status === "InProgress" && !canVote && <p className="text-[13px] text-[#6b6b6b]">{voted ? "You've voted. It runs once enough of the council approves, here or in Trezu." : "The council can approve it here or in Trezu."}</p>}
          </div>
        )}

        {err && (
          <StatusNote tone="err" className="mt-4">
            {err}
          </StatusNote>
        )}
      </div>
    </Card>
  );
}

/** Assets a council can pick by hand: every live asset, earning versions counted with their base. */
const PICKABLE = ASSETS.filter((a) => a.live && !a.earn).length;

/** One numbered part of the form: the parts are filled in order, so the numbers mean something. */
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-black text-[13px] text-white tabular-nums">{n}</span>
      <div>
        <h3 className="pt-0.5 text-[17px] leading-6 tracking-[-0.03em]">{title}</h3>
        {hint && <p className="mt-0.5 text-[13px] leading-5 text-[#6b6b6b]">{hint}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </li>
  );
}

/** Where the proposal is: filed, voted through, vault made. */
function ProposalSteps({ status, made }: { status: DaoProposal["status"]; made: boolean }) {
  const failed = status !== "InProgress" && status !== "Approved";
  const stages = [
    { label: "Filed", done: true },
    { label: failed ? "Didn't pass" : "Voted through", done: status === "Approved", bad: failed },
    { label: "Vault created", done: made },
  ];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
      {stages.map((s) => (
        <li key={s.label}>
          <span className={`block h-1 rounded-full ${s.bad ? "bg-rose-500" : s.done ? "bg-[#05a800]" : "bg-black/[0.08]"}`} />
          <span className={`mt-2 block text-[13px] ${s.done || s.bad ? "text-black" : "text-black/40"}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

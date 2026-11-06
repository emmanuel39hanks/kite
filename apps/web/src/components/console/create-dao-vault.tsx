"use client";

import { useEffect, useState } from "react";
import { MixBar } from "@/components/charts";
import { GuardSliders } from "@/components/console/guard-sliders";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, StatusNote } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { assetById } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import { approveAction, type DaoProposal } from "@/lib/near/dao";
import { canApprove, cleanAccount, nearFromYocto, readDaoPolicy, rightsOf, type DaoPolicy } from "@/lib/near/dao-view";
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
export function CreateDaoVault({ onOpen }: { onOpen: (vault: string) => void }) {
  const w = useWallet();
  const [dao, setDao] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [planSlug, setPlanSlug] = useState(PLANS[PLANS.length - 1]?.slug ?? "");
  const [g, setG] = useState<Guardrails>(DEFAULT_GUARDRAILS);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DaoProposal | null>(null);
  /** After a vote: whether the vault under that name is really this DAO's (null until checked). */
  const [ours, setOurs] = useState<boolean | null>(null);

  const daoId = cleanAccount(dao);
  const plan = PLANS.find((p) => p.slug === planSlug) ?? PLANS[0];
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
  const ready = checks.length > 0 && checks.every((c) => c.ok === true) && !w.preview && !current?.existing;

  const reread = async (id: number) => {
    if (!daoId) return;
    const p = (await provider.callFunction({ contractId: daoId, method: "get_proposal", args: { id } })) as DaoProposal;
    setProposal(p);
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
      await w.send(daoId, [createVaultProposalAction(daoId, name, plan.mix, g, BigInt(current.policy.proposal_bond), (id) => assetById(id).name)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    // Whatever the wallet said, look for the proposal itself: ours, for this name, newest first.
    try {
      setBusy("Finding the proposal…");
      const p = await findCreateProposal(daoId, w.accountId, name);
      if (p) {
        setErr(null);
        setProposal(p);
      }
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
      const args = { proposal: { description: createVaultDescription(daoId, name, plan.mix, g, (id) => assetById(id).name), kind: createVaultKind(name, plan.mix, g) } };
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const voted = !!(proposal && w.accountId && (proposal as DaoProposal & { votes?: Record<string, unknown> }).votes?.[w.accountId]);
  const canVote = proposal && !voted && rights?.approve && canApprove(proposal, NEAR.factory, current?.policy?.proposal_period);
  const proposed = proposal ? proposalVaultName(proposal) : null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] tracking-[-0.03em]">Create a vault for your DAO</h2>
          <p className="mt-1 max-w-[62ch] text-[14px] leading-5 text-[#6b6b6b]">
            The DAO votes once, and its vault appears as <span className="text-black">name.{NEAR.factory}</span>, owned by the DAO from the first block. No one&apos;s wallet ever holds it. It costs the DAO {NEAR.factoryDepositNear} NEAR: the vault keeps it for its code&apos;s storage and for gas, and returns what&apos;s left when it&apos;s closed.
          </p>
        </div>
        {proposal && <Badge tone={proposal.status === "Approved" ? "green" : proposal.status === "InProgress" ? "amber" : "red"}>Proposal {proposal.id}: {proposal.status === "InProgress" ? "open" : proposal.status === "Approved" ? "passed" : proposal.status.toLowerCase()}</Badge>}
      </div>

      {!proposal && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
                <input value={name} onChange={(e) => (setName(e.target.value.trim().toLowerCase()), setNameTouched(true))} placeholder="treasury" spellCheck={false} autoCapitalize="off" className={`${field} pr-[150px]`} disabled={!!busy} />
                <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-black/35">.{NEAR.factory}</span>
              </div>
              {name && !vault && <span className="mt-1 block text-[12px] text-rose-600">2 to 32 lowercase letters, digits, - or _.</span>}
            </label>
          </div>

          <div className="mt-5 text-[13px] text-[#6b6b6b]">What the vault holds</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {PLANS.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => setPlanSlug(p.slug)}
                aria-pressed={p.slug === planSlug}
                className={`cursor-pointer rounded-2xl p-3.5 text-left transition-[background-color,box-shadow] ${p.slug === planSlug ? "bg-white ring-2 ring-black" : "bg-white/60 ring-1 ring-inset ring-black/[0.06] hover:bg-white"}`}
              >
                <div className="flex -space-x-1.5">
                  {p.mix.map((s) => (
                    <Logo key={s.id} id={s.id} size={24} className="ring-2 ring-white" />
                  ))}
                </div>
                <div className="mt-2 text-[15px] tracking-[-0.02em]">{p.name}</div>
                <div className="text-[12px] text-[#6b6b6b]">{p.mix.map((s) => `${assetById(s.id).ticker} ${s.weight}%`).join(" · ")}</div>
                <MixBar slices={p.mix} className="mt-2.5 h-1" />
              </button>
            ))}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-[14px]">The rules Kite trades within</summary>
            <div className="mt-3">
              <GuardSliders value={g} onChange={setG} />
            </div>
          </details>

          {checks.length > 0 && (
            <ul className="mt-5 space-y-1.5">
              {checks.map((c) => (
                <li key={c.text} className="flex items-start gap-2 text-[13px] leading-5">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.ok ? "bg-[#05a800] text-white" : c.ok === false ? "bg-rose-500 text-white" : "bg-black/10"}`}>
                    {c.ok !== null && <Icon name={c.ok ? "check" : "x"} size={10} stroke={2.4} />}
                  </span>
                  {c.text}
                </li>
              ))}
            </ul>
          )}

          {current && current.owed > 0n && (
            <StatusNote tone="ok" className="mt-4">
              {NEAR.factory} owes {daoId} {nearFromYocto(current.owed, 2)} NEAR from a vault creation that failed. The DAO gets it back with one proposal.{" "}
              {rights?.propose && !w.preview && (
                <button type="button" className="cursor-pointer underline underline-offset-2" onClick={claim}>
                  Propose claiming it
                </button>
              )}
            </StatusNote>
          )}

          {current?.existing && (
            <StatusNote tone="ok" className="mt-4">
              You already filed proposal {current.existing.id} on {daoId} for this vault.{" "}
              <button type="button" className="cursor-pointer underline underline-offset-2" onClick={() => setProposal(current.existing)}>
                Open it
              </button>
            </StatusNote>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="share" onClick={propose} loading={!!busy} disabled={!ready}>
              {busy ?? (daoId ? `Propose to ${daoId}` : "Propose to the DAO")}
            </Button>
            {daoId && vault && (
              <Button icon="copy" onClick={copy}>
                Copy the proposal
              </Button>
            )}
          </div>
          {w.preview && <p className="mt-2 text-[12px] text-[#6b6b6b]">The preview can&apos;t file DAO proposals. Use a real wallet.</p>}
        </>
      )}

      {proposal && (
        <div className="mt-4 space-y-3">
          <p className="text-[14px] leading-5">
            Proposal {proposal.id} on {daoId} asks the DAO to create <span className="font-mono text-[13px]">{proposed ? factoryVaultId(proposed) : "a vault"}</span>.{" "}
            {proposal.status === "InProgress" ? "Once enough of the council approves it, the DAO pays the deposit and the vault appears." : proposal.status === "Approved" ? "It passed." : "It didn't run. Nothing was created, and the DAO kept its NEAR."}
          </p>
          <div className="flex flex-wrap gap-2">
            {canVote && (
              <Button variant="primary" icon="check" onClick={approve} loading={!!busy}>
                {busy ?? "Approve it"}
              </Button>
            )}
            {ours === true && proposed && (
              <Button variant="primary" icon="arrow-right" onClick={() => onOpen(factoryVaultId(proposed))}>
                Open the vault
              </Button>
            )}
            <Button variant="ghost" onClick={() => (setProposal(null), setOurs(null))}>
              Start again
            </Button>
          </div>
          {ours === false && proposed && (
            <StatusNote tone="err">
              {factoryVaultId(proposed)} exists, but it isn&apos;t {daoId}&apos;s: someone else created it first. The DAO&apos;s proposal failed and kept its NEAR. Start again with another name, and don&apos;t send anything to that vault.
            </StatusNote>
          )}
          {proposal.status === "InProgress" && !canVote && <p className="text-[12px] text-[#6b6b6b]">{voted ? "You've voted. It runs once enough of the council approves, here or in Trezu." : "The council can approve it here or in Trezu."}</p>}
        </div>
      )}

      {err && (
        <StatusNote tone="err" className="mt-3">
          {err}
        </StatusNote>
      )}
    </Card>
  );
}

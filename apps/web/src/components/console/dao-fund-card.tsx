"use client";

import type { Action } from "@near-js/transactions";
import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/console/ui";
import { assetByIntentsId } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import type { DaoProposal } from "@/lib/near/dao";
import { moveIntoVaultProposal, investProposal, quotesUntil, sendUsdcToDaoActions, usdcExact, usdcFromInput, usdcInIntents, usdcInWallet, usdcRegistered } from "@/lib/near/dao-fund";
import { nearFromYocto, openProposalFor, rightsOf, usdcText, type DaoPolicy } from "@/lib/near/dao-view";
import type { ContractTarget } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";

type Balances = { dao: bigint; registered: boolean; vault: bigint; mine: bigint | null } | { error: true };
type Send = (name: string, receiver: string, actions: Action[], ok: string) => Promise<void>;

const field =
  "h-[38px] w-full rounded-full bg-white px-4 text-[15px] tabular-nums ring-1 ring-inset ring-black/[0.09] outline-none placeholder:text-black/30 focus:ring-[#8cc6f6] disabled:opacity-60";

/** Hours a DAO vote can take: its proposal period, capped at the 72 hours a 1Click quote can last. */
const quoteHours = (periodNs: string) => Math.max(1, Math.min(72, Math.ceil(Number(BigInt(periodNs) / 1_000_000_000n) / 3600)));

/**
 * Put money in a DAO's vault, in the order it has to happen: USDC reaches the DAO, the DAO votes it into the
 * vault, the DAO votes to invest it. Every step reads live balances, so the card always shows where the money is.
 */
export function DaoFundCard({
  vault,
  dao,
  policy,
  proposals,
  plan,
  pending,
  rev,
  busy,
  send,
}: {
  vault: string;
  dao: string;
  policy: DaoPolicy;
  proposals: DaoProposal[];
  plan: ContractTarget[];
  /** A swap Kite's key started and hasn't settled: investing now would confuse its settlement. */
  pending: boolean;
  rev: number;
  busy: string | null;
  send: Send;
}) {
  const w = useWallet();
  const [bal, setB] = useState<Balances | null>(null);
  const [give, setGive] = useState("");
  const [move, setMove] = useState("");
  const [moveTouched, setMoveTouched] = useState(false);
  /** When the balances were last read; "now" for deciding whether an invest proposal's quotes have ended. */
  const [readAt, setReadAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const me = w.accountId && !w.preview ? w.accountId : null;

  useEffect(() => {
    let alive = true;
    // Balances that can't be read show as unknown, never as zero: "the DAO has no USDC" would be a guess.
    Promise.all([usdcInWallet(dao), usdcRegistered(dao), usdcInIntents(vault), me ? usdcInWallet(me).catch(() => null) : Promise.resolve(null)])
      .then(([daoUsdc, registered, vaultUsdc, mine]) => {
        if (!alive) return;
        setB({ dao: daoUsdc, registered, vault: vaultUsdc, mine });
        setReadAt(Date.now());
      })
      .catch(() => alive && setB({ error: true }));
    return () => {
      alive = false;
    };
  }, [dao, vault, me, rev]);
  const b = bal && !("error" in bal) ? bal : null;
  // Offer the DAO's whole balance, exactly, until the person types their own amount.
  const moveShown = moveTouched ? move : b && b.dao > 0n ? usdcExact(b.dao) : "";

  const bond = BigInt(policy.proposal_bond);
  const rights = rightsOf(policy, me);
  const hours = quoteHours(policy.proposal_period);
  const openMove = openProposalFor(proposals, "ft_transfer_call", policy.proposal_period);
  // An invest proposal stops mattering when its quotes end, even if the DAO's voting window runs on.
  const openInvestAny = openProposalFor(proposals, "allocate", policy.proposal_period);
  const investEnds = openInvestAny ? quotesUntil(openInvestAny.description) : null;
  const openInvest = openInvestAny && (investEnds === null || investEnds > readAt) ? openInvestAny : null;
  const giveAmt = usdcFromInput(give);
  const moveAmt = usdcFromInput(moveShown);
  const usdcToken = NEAR.usdc;
  // At least one part of the plan must come to $0.25 or more, the smallest swap the quotes route makes.
  const investable = !!b && plan.some((t) => t.token !== usdcToken && (b.vault * BigInt(t.target_bps)) / 10_000n >= 250_000n);
  const periodHours = Number(BigInt(policy.proposal_period) / 1_000_000_000n) / 3600;
  const off = !me || busy !== null;

  const steps = [
    { title: "USDC reaches the DAO", amount: b?.dao ?? null, where: `in ${dao}` },
    { title: "The DAO moves it in", amount: b?.vault ?? null, where: "in the vault, not yet invested" },
    { title: "The DAO invests it", amount: null, where: "swapped into the plan" },
  ];

  const invest = async () => {
    if (!b || off) return;
    setErr(null);
    setQuoting(true);
    try {
      const { action, spent } = await investProposal({ vault, plan, usdc: b.vault, bond, hours, names: (t) => assetByIntentsId(t)?.name ?? t });
      await send("invest", dao, [action], `Proposal sent to ${dao}: invest ${usdcText(spent.toString())} USDC in the plan. Approve it within ${hours} hours, while the quotes are good.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  };

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[22px] leading-7 tracking-[-0.05em]">Put money in</h2>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-5 text-[#6b6b6b]">
          A DAO only moves its money by vote, so this takes two proposals. Anyone can send the DAO USDC; only the DAO can move it into the vault, and only the DAO can take it out again.
        </p>
      </div>
      <Card className="p-2">
        <ol className="grid gap-2 lg:grid-cols-3">
          {/* 1 · to the DAO */}
          <li className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <StepHead n={1} title={steps[0].title} amount={b?.dao ?? null} where={steps[0].where} />
            <p className="mt-3 text-[13px] leading-5 text-[#6b6b6b]">
              Send USDC on NEAR to <span className="text-black">{dao}</span>, from any wallet or exchange. Or send it from your connected wallet here.
            </p>
            <div className="mt-auto pt-4">
              <div className="flex gap-2">
                <input value={give} onChange={(e) => setGive(e.target.value)} inputMode="decimal" placeholder="3.00" aria-label="USDC to send to the DAO" className={field} disabled={off} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={off || !giveAmt || (b?.mine !== null && b?.mine !== undefined && giveAmt > b.mine)}
                  loading={busy === "give"}
                  onClick={() => b && giveAmt && send("give", NEAR.usdcContract, sendUsdcToDaoActions(dao, giveAmt, b.registered), `Sent ${usdcText(giveAmt.toString())} USDC to ${dao}.`)}
                >
                  Send
                </Button>
              </div>
              <p className="mt-2 text-[12px] leading-[18px] text-[#6b6b6b]">
                {!me
                  ? "Connect a real wallet to send from here."
                  : b?.mine === null || b?.mine === undefined
                    ? " "
                    : `You have ${usdcText(b.mine.toString())} USDC.${b.registered ? "" : " The first send also registers the DAO with the USDC contract (0.00125 NEAR)."}`}
              </p>
            </div>
          </li>

          {/* 2 · into the vault */}
          <li className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <StepHead n={2} title={steps[1].title} amount={b?.vault ?? null} where={steps[1].where} />
            <p className="mt-3 text-[13px] leading-5 text-[#6b6b6b]">One proposal moves the DAO&apos;s USDC into the vault&apos;s NEAR Intents balance. Kite&apos;s key can trade it inside the limits, never take it out.</p>
            <div className="mt-auto pt-4">
              {openMove ? (
                <OpenNote p={openMove} />
              ) : (
                <div className="flex gap-2">
                  <input value={moveShown} onChange={(e) => (setMove(e.target.value), setMoveTouched(true))} inputMode="decimal" placeholder="0.00" aria-label="USDC to move into the vault" className={field} disabled={off} />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={off || !moveAmt || !b || moveAmt > b.dao || !rights.propose}
                    loading={busy === "move"}
                    onClick={() => moveAmt && send("move", dao, [moveIntoVaultProposal(vault, moveAmt, bond)], `Proposal sent to ${dao}: move ${usdcText(moveAmt.toString())} USDC into the vault. It runs once the DAO approves it below.`)}
                  >
                    Propose
                  </Button>
                </div>
              )}
              <p className="mt-2 text-[12px] leading-[18px] text-[#6b6b6b]">
                {b && b.dao === 0n ? "The DAO has no USDC yet. Do step 1 first." : me && !rights.propose ? `${me} can't file proposals on ${dao}.` : `Bond ${nearFromYocto(bond)} NEAR, returned when it passes.`}
              </p>
            </div>
          </li>

          {/* 3 · invest */}
          <li className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <StepHead n={3} title={steps[2].title} amount={null} where={steps[2].where} />
            <p className="mt-3 text-[13px] leading-5 text-[#6b6b6b]">
              Kite gets 1Click quotes for each part of the plan and checks every one with NEAR Intents: each swap pays back to this vault. {periodHours > hours ? `They stay good for ${hours} hours, so approve it within that, sooner than the DAO's ${Math.round(periodHours / 24)}-day voting window.` : `They stay good for ${hours} hours, the DAO's voting window.`}
            </p>
            <div className="mt-auto pt-4">
              {openInvest ? (
                <OpenNote p={openInvest} />
              ) : (
                <Button variant="primary" size="sm" className="w-full" disabled={off || !investable || pending || !rights.propose} loading={quoting || busy === "invest"} onClick={invest}>
                  {investable && b ? `Propose investing ${usdcText(b.vault.toString())} USDC` : "Propose investing"}
                </Button>
              )}
              <p className="mt-2 text-[12px] leading-[18px] text-[#6b6b6b]">
                {pending
                  ? "Kite has a swap in progress. Wait until it settles (the next daily check) before investing more."
                  : b && !investable
                    ? "Not enough USDC is waiting in the vault: each part of the plan needs at least $0.25. Do step 2 first."
                    : "If the vote runs late or a price moves past 1%, the USDC comes back to the vault. Nothing is lost; file again."}
              </p>
            </div>
          </li>
        </ol>
        {bal && "error" in bal && <p className="px-4 pt-3 pb-2 text-[13px] leading-5 text-rose-600">Couldn&apos;t read the balances from NEAR. Refresh to try again.</p>}
        {err && <p className="px-4 pt-3 pb-2 text-[13px] leading-5 text-rose-600">{err}</p>}
      </Card>
    </div>
  );
}

function StepHead({ n, title, amount, where }: { n: number; title: string; amount: bigint | null; where: string }) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black text-[12px] text-white tabular-nums">{n}</span>
        <span className="text-[16px] tracking-[-0.02em]">{title}</span>
      </div>
      {amount !== null && (
        <div className="mt-3">
          <span className="text-[26px] tracking-[-0.05em] tabular-nums">${usdcText(amount.toString())}</span>
          <span className="ml-2 text-[13px] text-[#6b6b6b]">{where}</span>
        </div>
      )}
    </div>
  );
}

function OpenNote({ p }: { p: DaoProposal }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-[#f5f5f7] px-3.5 py-2.5 text-[13px]">
      <Badge tone="blue">Open</Badge>
      Proposal {p.id} is waiting for votes. Approve it below.
    </div>
  );
}

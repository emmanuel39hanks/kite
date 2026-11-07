"use client";

import type { Action } from "@near-js/transactions";
import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/console/icons";
import { useMarket } from "@/lib/market/use-market";
import { Badge, Button, Card } from "@/components/console/ui";
import { assetByIntentsId, usd } from "@/lib/assets";
import { NEAR } from "@/lib/near/config";
import type { DaoProposal } from "@/lib/near/dao";
import { moveIntoVaultProposal, investProposal, quotesUntil, sendUsdcToDaoActions, usdcExact, usdcFromInput, usdcInIntents, usdcInWallet, usdcRegistered } from "@/lib/near/dao-fund";
import { openProposalFor, rightsOf, usdcText, type DaoPolicy } from "@/lib/near/dao-view";
import type { ContractTarget } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";

type Balances = { dao: bigint; registered: boolean; vault: bigint; mine: bigint | null } | { error: true };
type Send = (name: string, receiver: string, actions: Action[], ok: string) => Promise<void>;


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
  balances,
  pending,
  rev,
  busy,
  send,
  onVotes,
}: {
  vault: string;
  dao: string;
  policy: DaoPolicy;
  proposals: DaoProposal[];
  plan: ContractTarget[];
  /** The vault's balance of each plan token, for what's already invested. */
  balances: bigint[];
  /** Open the proposals list, where the DAO approves. */
  onVotes?: () => void;
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
  /** A step the person opened themselves; otherwise the next one to do is open. */
  const [shown, setShown] = useState<1 | 2 | 3 | null>(null);
  const { quote } = useMarket();
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
  const off = !me || busy !== null;

  const invest = async () => {
    if (!b || off) return;
    setErr(null);
    setQuoting(true);
    try {
      const { action, spent } = await investProposal({ vault, plan, usdc: b.vault, bond, hours, names: (t) => assetByIntentsId(t)?.name ?? t });
      await send("invest", dao, [action], `Proposal sent to ${dao}: invest ${usdcText(spent.toString())} USDC in the plan. Approve it under Proposals within ${hours} hours.`);
      setShown(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  };

  // Where the money is, left to right, and which step is next.
  const investedUsd = plan.reduce((n, t, i) => {
    const a = assetByIntentsId(t.token);
    return a && t.token !== usdcToken ? n + (Number(balances[i] ?? 0n) / 10 ** t.decimals) * quote(a.id).price : n;
  }, 0);
  const next: 1 | 2 | 3 | 4 = !b ? 1 : openInvest || investable ? 3 : openMove || b.dao > 0n ? 2 : investedUsd > 0 ? 4 : 1;
  const step = shown ?? next;
  const giveTooMuch = !!giveAmt && b?.mine !== null && b?.mine !== undefined && giveAmt > b.mine;
  const lowWallet = b?.mine !== null && b?.mine !== undefined && b.mine < 250_000n;

  const trail = [
    { label: "In the DAO", value: b ? `$${usdcText(b.dao.toString())}` : "–", on: next === 2 && !openInvest },
    { label: "In the vault", value: b ? `$${usdcText(b.vault.toString())}` : "–", on: next === 3 },
    { label: "Invested", value: usd(investedUsd), on: next === 4 },
  ];

  return (
    <Card className="p-2">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 sm:gap-3">
        {trail.map((t, i) => (
          <Fragment key={t.label}>
            {i > 0 && <Icon name="arrow-right" size={16} className="text-black/25" />}
            <div className={`rounded-2xl px-4 py-3 ${t.on ? "bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-black/[0.06]" : ""}`}>
              <div className="text-[12px] text-[#6b6b6b]">{t.label}</div>
              <div className="text-[22px] leading-7 tracking-[-0.04em] tabular-nums">{t.value}</div>
            </div>
          </Fragment>
        ))}
      </div>

      <ol className="mt-2 divide-y divide-black/[0.05] overflow-hidden rounded-2xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
        <Step n={1} done={next > 1} active={step === 1} title="Send USDC to the DAO" hint="From your wallet. Anyone can do this." onOpen={() => setShown(1)}>
          <AmountInput value={give} onChange={setGive} disabled={off} label="USDC to send to the DAO" />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[13px] text-[#6b6b6b]">
            {b?.mine !== null && b?.mine !== undefined ? (
              <button type="button" className="cursor-pointer hover:text-black" onClick={() => setGive(usdcExact(b.mine!))}>
                Wallet: ${usdcText(b.mine.toString())} USDC
              </button>
            ) : (
              <span>{me ? " " : "Connect a wallet to send from here."}</span>
            )}
            {b && !b.registered && <span>First send registers the DAO (0.00125 NEAR)</span>}
          </div>
          {lowWallet && (
            <p className="mt-3 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-[13px] leading-5">
              Not much USDC in your wallet. If you withdrew from a vault, it may be in NEAR Intents:{" "}
              <a href="/console/profile" className="underline underline-offset-2">
                move it to your wallet on Profile
              </a>
              .
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            disabled={off || !giveAmt || giveTooMuch}
            loading={busy === "give"}
            onClick={() => b && giveAmt && send("give", NEAR.usdcContract, sendUsdcToDaoActions(dao, giveAmt, b.registered), `Sent ${usdcText(giveAmt.toString())} USDC to ${dao}.`).then(() => setShown(null))}
          >
            {giveTooMuch ? "More than your wallet has" : `Send ${giveAmt ? `$${usdcText(giveAmt.toString())} ` : ""}USDC to the DAO`}
          </Button>
        </Step>

        <Step n={2} done={next > 2} active={step === 2} title="Vote to move it into the vault" hint="Only the DAO can take it out again." onOpen={() => setShown(2)}>
          {openMove ? (
            <Waiting p={openMove} onVotes={onVotes} />
          ) : (
            <>
              <AmountInput value={moveShown} onChange={(v) => (setMove(v), setMoveTouched(true))} disabled={off} label="USDC to move into the vault" />
              <p className="mt-2 text-[13px] text-[#6b6b6b]">The DAO holds ${b ? usdcText(b.dao.toString()) : "–"} USDC.</p>
              <Button
                variant="primary"
                size="lg"
                className="mt-4 w-full"
                disabled={off || !moveAmt || !b || moveAmt > b.dao || !rights.propose}
                loading={busy === "move"}
                onClick={() => moveAmt && send("move", dao, [moveIntoVaultProposal(vault, moveAmt, bond)], `Proposal sent to ${dao}: move ${usdcText(moveAmt.toString())} USDC into the vault. Approve it under Proposals.`).then(() => setShown(null))}
              >
                {`Propose moving ${moveAmt ? `$${usdcText(moveAmt.toString())} ` : ""}into the vault`}
              </Button>
              {me && !rights.propose && <p className="mt-2 text-[13px] text-rose-600">{me} can&apos;t file proposals on {dao}.</p>}
            </>
          )}
        </Step>

        <Step n={3} done={next > 3} active={step === 3} title="Vote to invest it" hint="Buys the plan. Every swap pays back to the vault." onOpen={() => setShown(3)}>
          {openInvest ? (
            <Waiting p={openInvest} onVotes={onVotes} note={`Approve within ${hours} hours, while the prices hold.`} />
          ) : (
            <>
              <Button variant="primary" size="lg" className="w-full" disabled={off || !investable || pending || !rights.propose} loading={quoting || busy === "invest"} onClick={invest}>
                {investable && b ? `Propose investing $${usdcText(b.vault.toString())}` : "Propose investing"}
              </Button>
              <p className="mt-2 text-[13px] leading-5 text-[#6b6b6b]">
                {pending
                  ? "Kite has a swap in progress. Invest once it settles."
                  : b && !investable
                    ? "Each part of the plan needs at least $0.25 waiting in the vault."
                    : `Approve within ${hours} hours. If prices move or the vote runs late, the USDC comes back to the vault.`}
              </p>
            </>
          )}
        </Step>
      </ol>

      {next === 4 && step === 4 && (
        <p className="flex items-center gap-2 px-3 pt-3 pb-1.5 text-[14px]">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#05a800] text-white">
            <Icon name="check" size={11} stroke={2.4} />
          </span>
          All invested. Kite keeps it on plan every day.
        </p>
      )}
      {bal && "error" in bal && <p className="px-3 pt-3 pb-1.5 text-[13px] text-rose-600">Couldn&apos;t read the balances from NEAR. Refresh to try again.</p>}
      {err && <p className="px-3 pt-3 pb-1.5 text-[13px] text-rose-600">{err}</p>}
    </Card>
  );
}

function Step({ n, done, active, title, hint, onOpen, children }: { n: number; done: boolean; active: boolean; title: string; hint: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left" aria-expanded={active}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] tabular-nums ${done ? "bg-[#05a800]/10 text-[#05a800]" : active ? "bg-black text-white" : "bg-black/[0.05] text-black/40"}`}>
          {done ? <Icon name="check" size={14} /> : n}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className={`block text-[15px] tracking-[-0.02em] ${active || done ? "" : "text-black/50"}`}>{title}</span>
          <span className="block text-[13px] text-[#6b6b6b]">{hint}</span>
        </span>
      </button>
      {active && <div className="px-5 pb-5 sm:pl-[60px]">{children}</div>}
    </li>
  );
}

function AmountInput({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  return (
    <div className="flex items-center rounded-2xl bg-[#f5f5f7] px-4 ring-[#5aa8f5] focus-within:ring-2">
      <span className="text-[24px] text-black/35">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        aria-label={label}
        disabled={disabled}
        className="w-full bg-transparent px-2 py-3 text-[26px] tracking-[-0.04em] tabular-nums outline-none placeholder:text-black/25 disabled:opacity-60"
      />
    </div>
  );
}

function Waiting({ p, onVotes, note }: { p: DaoProposal; onVotes?: () => void; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3">
      <div className="text-[14px] leading-5">
        <Badge tone="blue">Waiting for votes</Badge> <span className="ml-1">Proposal {p.id}</span>
        {note && <div className="mt-1 text-[13px] text-[#6b6b6b]">{note}</div>}
      </div>
      {onVotes && (
        <Button size="sm" variant="primary" onClick={onVotes}>
          Approve it
        </Button>
      )}
    </div>
  );
}

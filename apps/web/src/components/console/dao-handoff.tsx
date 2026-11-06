"use client";

import { useState } from "react";
import { looksLikeSputnikDao, readDao, type DaoInfo } from "@/lib/near/dao";
import { cleanAccount, foreignOwner, nearFromYocto } from "@/lib/near/dao-view";
import { ownerCall } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import { useKite } from "@/lib/store";
import { DaoOwnedNotice, daoViewHref } from "./dao-owned";
import { Badge, Button, Card, StatusNote } from "./ui";

type Note = { tone: "ok" | "err"; text: string } | null;

/**
 * "Give this vault to a DAO": the owner offers the vault with propose_owner. Nothing changes until the DAO
 * passes a proposal that calls accept_owner; until then the offer can be withdrawn.
 */
export function DaoHandoff({ account, vault, owner, pendingOwner }: { account: string; vault: string; owner?: string; pendingOwner?: string | null }) {
  const w = useWallet();
  const k = useKite();
  const [input, setInput] = useState("");
  const [dao, setDao] = useState<DaoInfo | null>(null);
  const [busy, setBusy] = useState<"check" | "offer" | "withdraw" | null>(null);
  const [note, setNote] = useState<Note>(null);
  // What this page just sent, until the next chain read catches up. undefined = nothing sent yet.
  const [sent, setSent] = useState<string | null | undefined>(undefined);

  if (w.preview)
    return (
      <Card className="p-5">
        <p className="text-[14px] leading-5 text-[#6b6b6b]">Handing a vault to a DAO needs a real wallet and a real DAO. The preview doesn&apos;t simulate it.</p>
      </Card>
    );

  const ownedBy = foreignOwner(owner, account);
  if (ownedBy) return <DaoOwnedNotice owner={ownedBy} vault={vault} />;

  const offer = sent !== undefined ? sent : (pendingOwner ?? null);
  const typed = cleanAccount(input);

  const check = async () => {
    if (!typed) return setNote({ tone: "err", text: "That isn't a NEAR account name." });
    if (typed === account) return setNote({ tone: "err", text: "That's this wallet. Enter the DAO's account." });
    setBusy("check");
    setNote(null);
    setDao(null);
    try {
      setDao(await readDao(typed));
    } catch {
      setNote({ tone: "err", text: `${typed} has no DAO policy to read, so it isn't a SputnikDAO this console can work with.` });
    } finally {
      setBusy(null);
    }
  };

  const send = async (to: string | null) => {
    setBusy(to ? "offer" : "withdraw");
    setNote(null);
    try {
      const tx = await w.send(vault, [ownerCall("propose_owner", { new_owner: to })]);
      setSent(to);
      k.addEvent({ kind: "key", title: to ? `Vault offered to ${to}` : "Vault offer withdrawn", detail: to ? "It changes hands only when the DAO passes a proposal that accepts it." : undefined, tx });
      setNote({ tone: "ok", text: to ? `Offered to ${to}. This wallet still owns the vault until the DAO accepts.` : "Offer withdrawn. Nobody else can take the vault now." });
      if (to) setDao(null);
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <p className="max-w-[64ch] text-[14px] leading-5 text-[#6b6b6b]">
        A DAO can own this vault. Its members vote once on the plan and guardrails, Kite keeps the mix on target inside them, and the vault still refuses anything outside its rules. Handing it over
        takes two steps: you offer it here, then the DAO passes a proposal that accepts it.
      </p>

      {offer ? (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px]">Offered to {offer}</span>
            <Badge tone="amber">Waiting for the DAO</Badge>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-[#6b6b6b]">
            Next: a council member of {offer} opens the DAO view and creates the proposal to accept the vault. When it passes, this wallet loses control and every change becomes a DAO vote. Until
            then you can withdraw the offer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" href={daoViewHref(vault)} iconRight="arrow-right">
              Open the DAO view
            </Button>
            <Button size="sm" variant="danger" onClick={() => send(null)} loading={busy === "withdraw"} disabled={busy !== null}>
              Withdraw offer
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
          >
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setDao(null);
              }}
              placeholder="treasury.sputnik-dao.near"
              aria-label="DAO account"
              spellCheck={false}
              autoCapitalize="off"
              className="h-[42px] min-w-0 flex-1 rounded-full bg-white px-4 text-[15px] ring-1 ring-inset ring-black/[0.09] outline-none placeholder:text-black/30 focus:ring-[#8cc6f6]"
            />
            <Button type="submit" loading={busy === "check"} disabled={!input.trim() || busy !== null}>
              Check DAO
            </Button>
          </form>

          {dao && dao.dao === typed && (
            <div className="mt-3 rounded-2xl bg-white p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px]">{dao.dao}</span>
                <Badge tone="green">DAO policy found</Badge>
                {!looksLikeSputnikDao(dao.dao) && <Badge tone="amber">Not a sputnik-dao.near account</Badge>}
              </div>
              <p className="mt-1 text-[13px] text-[#6b6b6b]">
                Proposal bond {nearFromYocto(dao.bond)} NEAR · {dao.councilSize === null ? "no council role" : `council of ${dao.councilSize}`}
              </p>
              <p className="mt-3 text-[13px] leading-5">
                After {dao.dao} accepts, this wallet can&apos;t change, withdraw from or close the vault. Every change, withdrawals included, becomes a vote of that DAO.
              </p>
              <Button className="mt-3" variant="primary" size="sm" onClick={() => send(dao.dao)} loading={busy === "offer"} disabled={busy !== null}>
                Offer the vault to {dao.dao}
              </Button>
            </div>
          )}
        </div>
      )}

      {note && (
        <StatusNote tone={note.tone} className="mt-3 text-[13px]">
          {note.text}
        </StatusNote>
      )}
    </Card>
  );
}

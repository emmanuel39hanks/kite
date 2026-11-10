"use client";

import { actionCreators } from "@near-js/transactions";
import { useEffect, useState } from "react";
import { Button, StatusNote } from "@/components/console/ui";
import { readDao } from "@/lib/near/dao";
import { nearProvider } from "@/lib/near/rpc";
import { useWallet } from "@/lib/near/wallet";

const provider = nearProvider();
const YOCTO = 10n ** 24n;
/** NEAR locks 1 NEAR per 100 KB an account stores. */
const YOCTO_PER_BYTE = 10n ** 19n;
/** Kept back on top of storage, for the gas of later votes and for storage the DAO grows into. */
const RESERVE = YOCTO / 20n; // 0.05 NEAR

const fmt = (y: bigint) => (Number(y / 10n ** 20n) / 1e4).toString();

/**
 * Ask a DAO to send NEAR from its treasury (for example the 2.6 NEAR a closed vault returned). Files a Transfer
 * request on the DAO; it then shows under "Waiting for your vote". The most that can leave is worked out from the
 * chain: the DAO's balance, minus what NEAR locks for its storage, minus a small reserve. Asking for more would
 * fail on approval with "wouldn't have enough balance to cover storage".
 */
export function DaoPayout({ dao, onFiled }: { dao: string; onFiled: () => void }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [max, setMax] = useState<bigint | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    provider
      .viewAccount({ accountId: dao })
      .then((a) => {
        const spare = BigInt(a.amount) - BigInt(a.storage_usage) * YOCTO_PER_BYTE - RESERVE;
        if (alive) setMax(spare > 0n ? spare : 0n);
      })
      .catch(() => alive && setMax(null));
    return () => {
      alive = false;
    };
  }, [open, dao]);

  if (!open)
    return (
      <button type="button" onClick={() => { setOpen(true); setTo(w.accountId ?? ""); }} className="mt-3 cursor-pointer text-[13px] text-[#6b6b6b] underline underline-offset-2 hover:text-black">
        Send NEAR out of this DAO
      </button>
    );

  const yocto = (() => {
    const m = amount.trim().match(/^(\d+)(?:\.(\d{1,24}))?$/);
    return m ? BigInt(m[1]) * YOCTO + BigInt((m[2] ?? "").padEnd(24, "0")) : null;
  })();
  const receiver = to.trim().toLowerCase();
  const problem = !/^[a-z0-9._-]{2,64}$/.test(receiver)
    ? "Enter the NEAR account to pay."
    : yocto === null || yocto <= 0n
      ? "Enter an amount in NEAR."
      : max !== null && yocto > max
        ? `The most this DAO can send is ${fmt(max)} NEAR. The rest is locked for its storage.`
        : null;

  const file = async () => {
    if (problem || yocto === null) return;
    setBusy(true);
    setNote(null);
    try {
      const { bond } = await readDao(dao);
      await w.send(dao, [
        actionCreators.functionCall(
          "add_proposal",
          { proposal: { description: `Send ${amount.trim()} NEAR from this DAO to ${receiver}.`, kind: { Transfer: { token_id: "", receiver_id: receiver, amount: yocto.toString() } } } },
          100n * 10n ** 12n,
          bond,
        ),
      ]);
      setNote({ tone: "ok", text: "Request filed. Approve it under “Waiting for your vote”." });
      setAmount("");
      setTimeout(onFiled, 2500);
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const field = "h-9 w-full rounded-lg bg-[#f5f5f7] px-3 text-[13px] ring-1 ring-inset ring-black/[0.06] outline-none focus:ring-black/30";
  return (
    <div className="mt-3 rounded-xl bg-[#fafafa] p-3 ring-1 ring-inset ring-black/[0.05]">
      <div className="text-[13px] tracking-[-0.01em]">Send NEAR out of this DAO</div>
      <div className="mt-2 grid gap-2">
        <input className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Pay to (account.near)" aria-label="Pay to" spellCheck={false} />
        <div className="flex gap-2">
          <input className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in NEAR" aria-label="Amount in NEAR" inputMode="decimal" />
          <Button size="sm" onClick={() => max !== null && setAmount(fmt(max))} disabled={max === null || max === 0n}>
            Max
          </Button>
        </div>
      </div>
      <div className="mt-2 text-[12px] text-[#6b6b6b]">
        {max === null ? "Reading the DAO's balance…" : `Up to ${fmt(max)} NEAR can leave. The DAO keeps the rest for its storage.`}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={file} loading={busy} disabled={!w.accountId || busy || !!problem}>
          Ask the DAO
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-[13px] text-[#6b6b6b] hover:text-black">
          Cancel
        </button>
      </div>
      {amount && problem && <div className="mt-2 text-[12px] text-[#b45309]">{problem}</div>}
      {note && (
        <StatusNote tone={note.tone} className="mt-2">
          {note.text}
        </StatusNote>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, StatusNote } from "@/components/console/ui";
import { Logo } from "@/components/logo";
import { assetByIntentsId, units as fmtUnits, usd } from "@/lib/assets";
import { NEAR, txUrl } from "@/lib/near/config";
import { convertQuotes, intentsHoldings, ownerIntentsToWalletActions, type Holding } from "@/lib/near/convert";
import { useWallet } from "@/lib/near/wallet";
import { useMarket } from "@/lib/market/use-market";
import { useKite } from "@/lib/store";

/**
 * Money sitting in the person's own NEAR Intents account (from a withdrawal, or a refunded swap). Wallets don't show
 * it, so it's easy to lose track of. One button swaps it all to USDC and sends it to the NEAR wallet.
 */
export function IntentsBalance({ account }: { account: string }) {
  const w = useWallet();
  const k = useKite();
  const { quote } = useMarket();
  const [held, setHeld] = useState<Holding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string; tx?: string } | null>(null);

  const load = useCallback(() => intentsHoldings(account).then(setHeld).catch(() => setHeld(null)), [account]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  if (!held || !held.length) return null;
  const rows = held.flatMap((h) => {
    const a = assetByIntentsId(h.token);
    if (!a) return [];
    const units = Number(h.amount) / 10 ** a.decimals;
    return [{ h, a, units, value: units * quote(a.id).price }];
  });
  const total = rows.reduce((n, r) => n + r.value, 0);

  const toWallet = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { transfers, skipped } = await convertQuotes(account, held);
      const usdc = held.find((h) => h.token === NEAR.usdc)?.amount ?? 0n;
      if (!transfers.length && usdc === 0n) throw new Error("These amounts are too small for NEAR Intents to swap right now.");
      const hash = await w.send(NEAR.intents, ownerIntentsToWalletActions(account, transfers, usdc));
      k.addEvent({ kind: "deposit", title: "Moved your NEAR Intents balance to your wallet as USDC", detail: skipped.length ? "Some amounts were too small to swap and stay in NEAR Intents." : "Swaps land in about a minute.", tx: hash });
      setNote({ tone: "ok", text: `Sent. About ${usd(transfers.reduce((n, t) => n + t.outUsd, 0) + Number(usdc) / 1e6)} of USDC lands in your wallet in about a minute.${skipped.length ? " Some amounts were too small to swap and stay here." : ""}`, tx: hash });
      setTimeout(load, 15_000);
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
        <div className="max-w-[46ch]">
          <h3 className="text-[16px] tracking-[-0.02em]">In your NEAR Intents account</h3>
          <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">
            About {usd(total)} that your wallet doesn&apos;t show, from a withdrawal or a refunded swap. It&apos;s yours; bring it back as USDC in one signature.
          </p>
        </div>
        <Button size="sm" variant="primary" icon="withdraw" onClick={toWallet} loading={busy} disabled={w.preview}>
          Move to my wallet as USDC
        </Button>
      </div>
      <ul className="divide-y divide-black/[0.05] bg-white">
        {rows.map(({ h, a, units, value }) => (
          <li key={h.token} className="flex items-center gap-3 px-5 py-3">
            <Logo id={a.id} size={28} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[14px]">{a.name}</div>
              <div className="text-[12px] text-[#6b6b6b] tabular-nums">
                {fmtUnits(units)} {a.ticker}
              </div>
            </div>
            <div className="text-right text-[14px] tabular-nums">{usd(value)}</div>
          </li>
        ))}
      </ul>
      {note && (
        <div className="p-3">
          <StatusNote tone={note.tone}>
            {note.text}{" "}
            {note.tx && (
              <a href={txUrl(note.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Transaction
              </a>
            )}
          </StatusNote>
        </div>
      )}
    </Card>
  );
}

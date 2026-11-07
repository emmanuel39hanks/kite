"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, PageTitle, Slider, StatusNote, Switch } from "@/components/console/ui";
import { MixBar } from "@/components/charts";
import { Logo } from "@/components/logo";
import { assetById } from "@/lib/assets";
import { mixValid, rebalance, type Slice } from "@/lib/mix";
import { AiRules } from "@/components/console/ai-rules";
import { DaoOwnedNotice, useForeignOwner } from "@/components/console/dao-owned";
import { GuardSliders } from "@/components/console/guard-sliders";
import { accountUrl, NEAR } from "@/lib/near/config";
import { useLive } from "@/lib/near/live";
import { kiteGasLeft } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import { useKite, type Guardrails } from "@/lib/store";

export default function GuardrailsPage() {
  const k = useKite();
  if (!k.ready) return null;
  // Re-mount when the chain's values arrive so the form starts from them.
  return <Form key={JSON.stringify(k.guardrails) + String(k.vaultFound)} initial={k.guardrails} />;
}

function Form({ initial }: { initial: Guardrails }) {
  const k = useKite();
  const w = useWallet();
  const live = useLive();
  const hasVault = !!k.vaultFound;
  // A DAO owns the vault: this wallet can't sign owner calls any more, so the controls here stay read-only.
  const ownedBy = useForeignOwner();
  const [g, setG] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const dirty = JSON.stringify(g) !== JSON.stringify(k.guardrails);

  const act = async (name: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    setNote(null);
    try {
      await fn();
      setNote({ tone: "ok", text: ok });
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    k.account && !w.preview && k.vaultFound === null
      ? setNote({ tone: "err", text: "Still reading your vault. Try again in a moment." })
      : hasVault
      ? act("save", () => live.saveGuardrails(g), "Saved to your vault.")
      : (k.setGuardrails(g), setNote({ tone: "ok", text: "Saved. These go into your vault when you create it." }));

  return (
    <>
      <PageTitle
        actions={
          <>
            {dirty && (
              <Button variant="ghost" onClick={() => setG(k.guardrails)}>
                Discard
              </Button>
            )}
            <Button variant="primary" onClick={save} disabled={!dirty || !!ownedBy} loading={busy === "save"}>
              {hasVault ? "Save to vault" : "Save"}
            </Button>
          </>
        }
      >
        Guardrails
      </PageTitle>

      {ownedBy && k.portfolio && <DaoOwnedNotice owner={ownedBy} vault={k.portfolio.vault} className="mb-4" />}

      {note && (
        <StatusNote tone={note.tone} className="mb-4">
          {note.text}
        </StatusNote>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
        {hasVault && k.portfolio && !ownedBy && <TargetMix key={JSON.stringify(k.portfolio.target)} />}
        <Card className="scroll-mt-28 p-2" id="rules">
          <div className="px-4 pt-3 pb-4">
            <p className="max-w-[60ch] text-[15px] leading-6 text-[#6b6b6b]">
              The rules Kite has to follow. They live in your vault contract, so Kite can&apos;t change them. Changing them takes your signature.
            </p>
          </div>
          <AiRules current={g} onApply={setG} />
          <GuardSliders value={g} onChange={setG} vaultUsd={hasVault && k.portfolio ? k.portfolio.value - k.portfolio.cash : undefined} assets={k.portfolio?.target.length} />
        </Card>
        </div>

        <div className="space-y-3 xl:sticky xl:top-[100px] xl:self-start">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] tracking-[-0.03em]">Kite&apos;s key</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">
                  A key on your vault that can only call rebalance and settle. Turn it off and Kite can&apos;t trade at all.
                </p>
              </div>
              <Switch
                checked={hasVault ? k.keyActive : true}
                disabled={!hasVault || busy !== null || !!ownedBy}
                label="Kite's key"
                onChange={(on) =>
                  on
                    ? act("key", live.restoreKey, "Kite's key restored. It can rebalance again.")
                    : act("key", live.revoke, "Kite's key deleted from your vault. Kite can't trade.")
                }
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {hasVault ? (
                k.keyActive ? <Badge tone="green">On: rebalance and settle only</Badge> : <Badge>Off: nothing can trade</Badge>
              ) : (
                <Badge>Added when you create your vault</Badge>
              )}
              {busy === "key" && !w.preview && <Badge tone="blue">Waiting for your wallet…</Badge>}
            </div>
            {hasVault && k.keyActive && !w.preview && k.portfolio && <KiteGas vault={k.portfolio.vault} />}
          </Card>

          <Card className="p-5">
            <h2 className="text-[18px] tracking-[-0.03em]">What Kite can never do</h2>
            <ul className="mt-3 space-y-2.5 text-[14px]">
              {["Withdraw or send your money anywhere", "Buy anything outside your plan", "Change these guardrails", "Keep trading after a swap fails; the vault pauses itself"].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-600">
                    <Icon name="x" size={12} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            {hasVault && k.portfolio && !w.preview && (
              <Button size="sm" href={accountUrl(k.portfolio.vault)} external icon="external" className="mt-5">
                Check the vault on NearBlocks
              </Button>
            )}
          </Card>

          {hasVault && !ownedBy && <CloseVault />}

          {!w.accountId && <p className="px-2 text-[13px] text-[#6b6b6b]">Connect a wallet to save these to a vault.</p>}
        </div>
      </div>
    </>
  );
}

/** The vault's target shares, changed in place: same assets, one signature (`set_plan`). Kite trades toward the new
 *  mix at its next check, inside the guardrails. */
function TargetMix() {
  const k = useKite();
  const live = useLive();
  const p = k.portfolio!;
  const [mix, setMix] = useState<Slice[]>(p.target);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const dirty = JSON.stringify(mix.map((s) => s.weight)) !== JSON.stringify(p.target.map((s) => s.weight));
  // Arriving from Home's "Change mix": this card renders after the vault loads, so scroll to it then.
  useEffect(() => {
    if (window.location.hash === "#mix") document.getElementById("mix")?.scrollIntoView({ block: "start" });
  }, []);
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await live.savePlan(mix);
      setNote({ tone: "ok", text: "Saved to your vault. Kite trades toward the new mix at its next check, inside your guardrails." });
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="scroll-mt-28 p-5" id="mix">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] tracking-[-0.03em]">Target mix</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">What Kite keeps your vault at. Change a share and the others move so it stays 100%.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setMix(p.target)}>
              Undo
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={save} disabled={!dirty || !mixValid(mix) || !!p.pending} loading={busy}>
            Save mix
          </Button>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {mix.map((s) => {
          const a = assetById(s.id);
          const now = p.current[s.id] ?? 0;
          return (
            <li key={s.id} className="flex items-center gap-3">
              <Logo id={s.id} size={26} />
              <div className="w-[84px] shrink-0 leading-tight sm:w-[110px]">
                <div className="truncate text-[14px] tracking-[-0.02em]">{a.name}</div>
                <div className="text-[12px] text-[#6b6b6b] tabular-nums">now {now.toFixed(1)}%</div>
              </div>
              <div className="min-w-0 flex-1">
                <Slider value={s.weight} min={1} max={100 - (mix.length - 1)} onChange={(v) => setMix(rebalance(mix, s.id, v))} color={s.color} label={`${a.name} target share`} />
              </div>
              <span className="w-11 text-right text-[17px] tracking-[-0.03em] tabular-nums">{s.weight}%</span>
            </li>
          );
        })}
      </ul>
      <MixBar slices={mix} className="mt-4 h-1.5" />
      {p.pending && <p className="mt-3 text-[13px] text-[#6b6b6b]">A swap is in flight. You can change the mix once it settles.</p>}
      {note && (
        <StatusNote tone={note.tone} className="mt-3">
          {note.text}
        </StatusNote>
      )}
    </Card>
  );
}

/** Withdraw everything, then close the vault and get its NEAR deposit back. */
function CloseVault() {
  const k = useKite();
  const live = useLive();
  const [busy, setBusy] = useState<"withdraw" | "close" | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const empty = !!k.portfolio && k.portfolio.value < 0.01 && k.portfolio.cash < 0.01;

  const run = async (name: "withdraw" | "close", fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    setNote(null);
    try {
      await fn();
      setNote({ tone: "ok", text: ok });
    } catch (e) {
      setNote({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-[18px] tracking-[-0.03em]">Withdraw and close</h2>
      <p className="mt-1 text-[13px] leading-5 text-[#6b6b6b]">
        Take everything out, then close the vault to get its {NEAR.vaultStorageNear} NEAR deposit back. The vault refuses to close while it still holds anything, so nothing can get stuck.
      </p>
      <ol className="mt-4 space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="min-w-0">
            <div className="text-[14px]">1. Withdraw everything</div>
            <p className="text-[12px] leading-4 text-[#6b6b6b]">To your own NEAR Intents account, in one signature.</p>
          </div>
          <Button size="sm" onClick={() => run("withdraw", live.withdrawAll, "Withdrawn. It shows in your NEAR Intents account in a few seconds.")} loading={busy === "withdraw"} disabled={empty || busy !== null}>
            Withdraw
          </Button>
        </li>
        <li className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="min-w-0">
            <div className="text-[14px]">2. Close the vault</div>
            <p className="text-[12px] leading-4 text-[#6b6b6b]">Deletes {k.portfolio?.vault} and returns its NEAR to you.</p>
          </div>
          <Button size="sm" variant="danger" onClick={() => run("close", live.closeVault, "Vault closed. Its NEAR is back in your wallet.")} loading={busy === "close"} disabled={!empty || busy !== null}>
            Close
          </Button>
        </li>
      </ol>
      {note && (
        <StatusNote tone={note.tone} className="mt-3 text-[13px]">
          {note.text}
        </StatusNote>
      )}
    </Card>
  );
}

/** Kite's key pays gas from the vault. Show what is left, and how to top it up before it runs out. */
function KiteGas({ vault }: { vault: string }) {
  const [left, setLeft] = useState<{ vault: string; near: number | null } | null>(null);
  useEffect(() => {
    let off = false;
    const load = () => kiteGasLeft(vault).then((near) => !off && setLeft({ vault, near }));
    load();
    // Refresh after a top-up without a page reload.
    const t = setInterval(load, 60_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [vault]);
  const near = left?.vault === vault ? left.near : null;
  if (near == null) return null;
  const low = near < 0.05;
  return (
    <p className={`mt-3 text-[13px] leading-5 ${low ? "text-rose-600" : "text-[#6b6b6b]"}`}>
      Gas left for Kite: {near.toFixed(3)} NEAR.{" "}
      {low ? "Kite stops trading below 0.05. Send your vault some NEAR, then turn the key off and on to renew it." : "A rebalance costs about 0.002."}
    </p>
  );
}

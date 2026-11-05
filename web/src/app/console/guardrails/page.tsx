"use client";

import { useState } from "react";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, PageTitle, Slider, StatusNote, Switch } from "@/components/console/ui";
import { GUARD_BOUNDS } from "@/lib/guard-bounds";
import { AiRules } from "@/components/console/ai-rules";
import { accountUrl, NEAR } from "@/lib/near/config";
import { useLive } from "@/lib/near/live";
import { useWallet } from "@/lib/near/wallet";
import { DEFAULT_GUARDRAILS, useKite, type Guardrails } from "@/lib/store";

type Field = {
  key: keyof Guardrails;
  label: string;
  help: (v: number) => string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
};

type FieldDef = Omit<Field, "min" | "max" | "step">;
const DEFS: FieldDef[] = [
  { key: "driftBand", label: "When Kite steps in", help: (v) => `Kite only trades when a holding is ${v} points or more away from its share.`, show: (v) => `${v} pts` },
  { key: "maxTradePct", label: "Biggest single trade", help: (v) => `No one swap can move more than ${v}% of your money.`, show: (v) => `${v}%` },
  { key: "slippageBps", label: "Worst price accepted", help: (v) => `If a swap would hand back less than ${(100 - v / 100).toFixed(2)}% of what goes in, fees included, the vault refuses it.`, show: (v) => `${(v / 100).toFixed(2)}%` },
  { key: "tradesPerDay", label: "Trades per day", help: (v) => `Kite can make at most ${v} trade${v === 1 ? "" : "s"} a day, however much prices move.`, show: (v) => `${v}` },
];
const FIELDS: Field[] = DEFS.map((f) => ({ ...f, ...GUARD_BOUNDS[f.key] }));

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
    hasVault
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
            <Button variant="primary" onClick={save} disabled={!dirty} loading={busy === "save"}>
              {hasVault ? "Save to vault" : "Save"}
            </Button>
          </>
        }
      >
        Guardrails
      </PageTitle>

      {note && (
        <StatusNote tone={note.tone} className="mb-4">
          {note.text}
        </StatusNote>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-2">
          <div className="px-4 pt-3 pb-4">
            <p className="max-w-[60ch] text-[15px] leading-6 text-[#909090]">
              The rules Kite has to follow. They live in your vault contract, so Kite can&apos;t change them. Changing them takes your signature.
            </p>
          </div>
          <AiRules current={g} onApply={setG} />
          <ul className="space-y-2">
            {FIELDS.map((f) => {
              const v = g[f.key];
              return (
                <li key={f.key} className="rounded-2xl bg-white px-5 py-5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[16px] tracking-[-0.02em]">{f.label}</span>
                    <span className="text-[22px] tracking-[-0.04em] tabular-nums">{f.show(v)}</span>
                  </div>
                  <div className="mt-3">
                    <Slider value={v} min={f.min} max={f.max} step={f.step} onChange={(n) => setG({ ...g, [f.key]: n })} label={f.label} color="#8cc6f6" />
                  </div>
                  <div className="mt-2 flex justify-between gap-4 text-[13px] text-[#909090]">
                    <span>{f.help(v)}</span>
                    {v !== DEFAULT_GUARDRAILS[f.key] && (
                      <button type="button" onClick={() => setG({ ...g, [f.key]: DEFAULT_GUARDRAILS[f.key] })} className="shrink-0 cursor-pointer hover:text-black">
                        Reset
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-3 xl:sticky xl:top-[100px] xl:self-start">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] tracking-[-0.03em]">Kite&apos;s key</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#909090]">
                  A key on your vault that can only call rebalance and settle. Turn it off and Kite can&apos;t trade at all.
                </p>
              </div>
              <Switch
                checked={hasVault ? k.keyActive : true}
                disabled={!hasVault || busy !== null}
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

          {hasVault && <CloseVault />}

          {!w.accountId && <p className="px-2 text-[13px] text-[#909090]">Connect a wallet to save these to a vault.</p>}
        </div>
      </div>
    </>
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
      <p className="mt-1 text-[13px] leading-5 text-[#909090]">
        Take everything out, then close the vault to get its {NEAR.vaultStorageNear} NEAR deposit back. The vault refuses to close while it still holds anything, so nothing can get stuck.
      </p>
      <ol className="mt-4 space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="min-w-0">
            <div className="text-[14px]">1. Withdraw everything</div>
            <p className="text-[12px] leading-4 text-[#909090]">To your own NEAR Intents account, in one signature.</p>
          </div>
          <Button size="sm" onClick={() => run("withdraw", live.withdrawAll, "Withdrawn. It shows in your NEAR Intents account in a few seconds.")} loading={busy === "withdraw"} disabled={empty || busy !== null}>
            Withdraw
          </Button>
        </li>
        <li className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <div className="min-w-0">
            <div className="text-[14px]">2. Close the vault</div>
            <p className="text-[12px] leading-4 text-[#909090]">Deletes {k.portfolio?.vault} and returns its NEAR to you.</p>
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

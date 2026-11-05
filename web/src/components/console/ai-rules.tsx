"use client";

import { useEffect, useState } from "react";
import { Button, StatusNote } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { cleanProposal, GUARD_BOUNDS, GUARD_KEYS, GUARD_SCHEMA, guardPrompt, type GuardProposal } from "@/lib/ai/guard-bounds";
import { askPrivately, warmUp, type Receipt } from "@/lib/ai/private-ai";
import type { Guardrails } from "@/lib/store";

const LABEL: Record<keyof Guardrails, string> = { driftBand: "When Kite steps in", maxTradePct: "Biggest single trade", slippageBps: "Worst price accepted", tradesPerDay: "Trades per day" };
const SHOW: Record<keyof Guardrails, (v: number) => string> = {
  driftBand: (v) => `${v} pts`,
  maxTradePct: (v) => `${v}%`,
  slippageBps: (v) => `${(v / 100).toFixed(2)}%`,
  tradesPerDay: (v) => `${v}`,
};
const EXAMPLES = ["Be more careful", "Trade less often", "Let it act more freely"];

/** Type a change in plain words; a private model proposes slider values. Nothing is saved until you press Save. */
export function AiRules({ current, onApply }: { current: Guardrails; onApply: (g: Guardrails) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<(GuardProposal & { receipt: Receipt }) | null>(null);
  useEffect(() => warmUp(), []);

  const run = async () => {
    if (busy) return;
    setBusy("Starting…");
    setErr(null);
    setRes(null);
    try {
      // Only the four rule values and your sentence are sent. No holdings, no wallet.
      const { data, receipt } = await askPrivately({
        system: guardPrompt,
        user: JSON.stringify({ current, request: text.trim().slice(0, 300) }),
        schema: GUARD_SCHEMA,
        maxTokens: 600,
        onStage: (st) => setBusy(st === "verify" ? "Checking NEAR AI's attestation…" : st === "ask" ? "Working it out privately…" : "Checking the signature…"),
      });
      setRes({ ...cleanProposal(data, current), receipt });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const changes = res ? GUARD_KEYS.filter((k) => res.rules[k] !== current[k]) : [];
  // Computed here, whatever the model said it was doing: these three rules let the vault do more when raised.
  const loosened = changes.filter((k) => k !== "driftBand" && res!.rules[k] > current[k]);

  return (
    <div className="mb-3 rounded-2xl bg-[#f5f5f7] p-4">
      <div className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
        <Icon name="lock" size={16} /> Change your rules in plain words
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text.trim().length >= 3 && !busy && run()}
          maxLength={300}
          disabled={!!busy}
          placeholder="e.g. I'm nervous about fees, keep trades small"
          aria-label="Describe the change"
          className="min-w-0 flex-1 rounded-xl bg-white px-4 py-2.5 text-[15px] ring-1 ring-inset ring-black/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-[#5aa8f5] disabled:opacity-60"
        />
        <Button onClick={run} loading={!!busy} disabled={text.trim().length < 3 || !!busy}>
          {busy ?? "Suggest"}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" disabled={!!busy} onClick={() => setText(x)} className="cursor-pointer rounded-full bg-white px-3 py-1 text-[12px] text-black/60 ring-1 ring-inset ring-black/[0.06] hover:text-black">
            {x}
          </button>
        ))}
      </div>
      {err && (
        <StatusNote tone="err" className="mt-3">
          {err}
        </StatusNote>
      )}
      {res && (
        <div className="mt-3 rounded-xl bg-white p-3.5">
          {changes.length ? (
            <ul className="space-y-1 text-[14px]">
              {changes.map((k) => (
                <li key={k} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>{LABEL[k]}</span>
                  <span className="tabular-nums">
                    <span className="text-[#909090] line-through">{SHOW[k](current[k])}</span> → {SHOW[k](res.rules[k])}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px]">No change needed: your rules already match that.</p>
          )}
          {res.explain && <p className="mt-2 text-[13px] leading-5 text-black/70">{res.explain}</p>}
          {loosened.length > 0 && <p className="mt-2 text-[13px] leading-5 text-[#8a5a00]">This loosens: {loosened.map((k) => LABEL[k].toLowerCase()).join(", ")}. Check it is what you want before saving.</p>}
          <p className="mt-2 text-[12px] leading-5 text-[#909090]">
            Kept inside the app&apos;s limits ({GUARD_BOUNDS.slippageBps.max / 100}% price limit at most, {GUARD_BOUNDS.tradesPerDay.max} trades a day at most){res.intent === "more_careful" ? "; a request to be more careful can never loosen a rule" : ""}. This only moves the sliders. Nothing is saved until you press Save.
            {res.receipt.signatureKind === "provider_tee" ? " Answered privately and signed by the model's hardware." : " Signed by NEAR AI's gateway."}
          </p>
          {changes.length > 0 && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => (onApply(res.rules), setRes(null), setText(""))}>
                Move the sliders
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRes(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

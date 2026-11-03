"use client";

/**
 * "Describe your goal": a private plan draft from NEAR AI.
 *
 * In the browser, NEAR AI's SDK verifies the gateway and the model's hardware
 * (Intel TDX + NVIDIA confidential GPU), encrypts the message to the attested
 * model key, and checks the model's signature on the reply. Kite's server only
 * relays encrypted bytes (/api/nearai/v1) and adds the API key.
 */
import { useState } from "react";
import { Logo } from "@/components/logo";
import { assetById, earnVersionOf } from "@/lib/assets";
import type { Slice } from "@/lib/mix";
import { DRAFT_SCHEMA, normalise, PLANNER_MODEL, systemPrompt, type Draft } from "@/lib/planner";
import type { Guardrails } from "@/lib/store";
import { useYields } from "@/lib/use-market";
import { Icon } from "./icons";
import { Button, StatusNote } from "./ui";

type Stage = "idle" | "verify" | "draft" | "sign" | "done";
const STAGES: { id: Exclude<Stage, "idle" | "done">; label: string }[] = [
  { id: "verify", label: "Checking NEAR AI's hardware: Intel TDX and NVIDIA confidential GPU" },
  { id: "draft", label: "Encrypting your words to the model and drafting" },
  { id: "sign", label: "Checking the model's signature on the answer" },
];

export type Receipt = { model: string; completionId: string; signatureKind: string; modelReports: number; verifiedAt: number };

const EXAMPLES = [
  "I'm 30, saving for a house in about 3 years. I don't want big swings.",
  "Long term, 10+ years. I believe in Bitcoin but want something to cushion crashes.",
  "Mostly safe, but I'd like a little upside and some gold.",
];

export function AiPlanner({ onUse }: { onUse: (r: { name: string; mix: Slice[]; rules: Guardrails }) => void }) {
  const yields = useYields();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ draft: Draft; mix: Slice[]; receipt: Receipt } | null>(null);
  const busy = stage !== "idle" && stage !== "done";

  const run = async () => {
    setError(null);
    setResult(null);
    try {
      const { InferenceClient } = await import("@nearai/inference-sdk");
      const client = new InferenceClient({ baseUrl: `${window.location.origin}/api/nearai/v1`, e2ee: true });
      setStage("verify");
      const att = await client.verify(PLANNER_MODEL);
      setStage("draft");
      const completion = await client.chat.completions.create({
        model: PLANNER_MODEL,
        messages: [
          { role: "system", content: systemPrompt(yields) },
          { role: "user", content: text.trim().slice(0, 1500) },
        ],
        max_tokens: 2500,
        response_format: { type: "json_schema", json_schema: DRAFT_SCHEMA },
      });
      setStage("sign");
      const verified = await client.verifyResponse(completion.id);
      const content = String(completion.choices[0]?.message?.content ?? "")
        .replace(/^```(?:json)?\s*|\s*```$/g, "")
        .trim();
      const { draft, mix } = normalise(JSON.parse(content));
      setResult({
        draft,
        mix,
        receipt: {
          model: PLANNER_MODEL,
          completionId: completion.id,
          signatureKind: String((verified as { signatureKind?: string }).signatureKind ?? "verified"),
          modelReports: att.models?.length ?? 0,
          verifiedAt: att.verifiedAt ?? Date.now(),
        },
      });
      setStage("done");
    } catch (e) {
      setStage("idle");
      const m = e instanceof Error ? e.message : String(e);
      setError(/JSON|Unexpected token/.test(m) ? "The model's answer wasn't a usable plan. Try again." : m);
    }
  };

  return (
    <div className="rounded-2xl bg-[#f5f5f7] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
          <Icon name="lock" size={19} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] tracking-[-0.03em]">Describe your goal instead</h3>
          <p className="mt-0.5 text-[13px] leading-5 text-[#909090]">
            A model on NEAR AI drafts a plan for you. Your words are encrypted in this browser to the model&apos;s verified hardware, so neither Kite nor NEAR AI can read
            them. It only drafts: you review every number next.
          </p>
        </div>
      </div>

      {!result && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={1500}
            disabled={busy}
            placeholder="What are you saving for, how long can you leave it, and how do you feel about big drops?"
            className="mt-4 w-full resize-none rounded-2xl bg-white px-4 py-3 text-[15px] leading-6 ring-1 ring-inset ring-black/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-[#5aa8f5] disabled:opacity-60"
            aria-label="Describe your goal"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                disabled={busy}
                onClick={() => setText(x)}
                className="cursor-pointer rounded-full bg-white px-3 py-1.5 text-left text-[12px] text-black/60 ring-1 ring-inset ring-black/[0.06] hover:text-black disabled:cursor-default"
              >
                {x}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="lock" onClick={run} loading={busy} disabled={text.trim().length < 10 || busy}>
              Draft my plan privately
            </Button>
            <span className="text-[12px] text-[#909090]">Takes about 20 seconds; most of it is checking the hardware.</span>
          </div>
          {busy && (
            <ol className="mt-4 space-y-1.5" aria-live="polite">
              {STAGES.map((s, i) => {
                const at = STAGES.findIndex((x) => x.id === stage);
                const state = i < at ? "done" : i === at ? "now" : "wait";
                return (
                  <li key={s.id} className={`flex items-center gap-2.5 text-[13px] ${state === "wait" ? "text-black/35" : "text-black"}`}>
                    <span
                      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${state === "done" ? "bg-[#05a800] text-white" : state === "now" ? "animate-pulse bg-[#8cc6f6]" : "bg-black/[0.08]"}`}
                    >
                      {state === "done" && <Icon name="check" size={11} stroke={2.4} />}
                    </span>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          )}
          {error && (
            <StatusNote tone="err" className="mt-4">
              {error}
            </StatusNote>
          )}
        </>
      )}

      {result && <DraftView result={result} onUse={onUse} onRedo={() => (setResult(null), setStage("idle"))} />}
    </div>
  );
}

function DraftView({
  result: { draft, mix, receipt },
  onUse,
  onRedo,
}: {
  result: { draft: Draft; mix: Slice[]; receipt: Receipt };
  onUse: (r: { name: string; mix: Slice[]; rules: Guardrails }) => void;
  onRedo: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_2px_2px_rgba(0,0,0,0.04)] sm:p-5">
      <div className="text-[13px] text-[#909090]">Draft</div>
      <h4 className="text-[22px] tracking-[-0.04em]">{draft.name}</h4>
      {draft.summary && <p className="mt-1 text-[14px] leading-5 text-black/70">{draft.summary}</p>}
      <ul className="mt-4 space-y-2.5">
        {draft.assets.map((a, i) => {
          const id = mix[i].id;
          const earn = a.earn ? earnVersionOf(a.id) : undefined;
          return (
            <li key={a.id} className="flex gap-3">
              <Logo id={id} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span>
                    {assetById(id).name}
                    {earn && <span className="text-[13px] text-[#05a800]"> · earning</span>}
                  </span>
                  <span className="tabular-nums">{a.weight}%</span>
                </div>
                {a.why && <p className="text-[13px] leading-5 text-[#909090]">{a.why}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[13px] text-[#909090]">
        Rules: steps in at {draft.rules.driftBand} pts off, biggest trade {draft.rules.maxTradePct}%, swaps may cost up to {(draft.rules.slippageBps / 100).toFixed(2)}%,{" "}
        {draft.rules.tradesPerDay} trades a day.
      </p>
      {draft.caution && <p className="mt-2 text-[13px] leading-5 text-black/70">Worth knowing: {draft.caution}</p>}

      <div className="mt-4 rounded-xl bg-[#f5f5f7] p-3 text-[12px] leading-5">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#05a800] text-white">
            <Icon name="check" size={11} stroke={2.4} />
          </span>
          Private and verified
        </div>
        <ul className="mt-1.5 space-y-0.5 text-black/60">
          <li>Encrypted end to end from this browser to the model&apos;s attested key ({receipt.model})</li>
          <li>Model hardware verified: Intel TDX and NVIDIA confidential GPU ({receipt.modelReports} report{receipt.modelReports === 1 ? "" : "s"})</li>
          <li>Answer signed inside that hardware ({receipt.signatureKind}), checked here</li>
        </ul>
        <a href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-black/70 hover:text-black">
          Check it yourself: {receipt.completionId.slice(0, 12)}… <Icon name="external" size={11} />
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button variant="primary" iconRight="arrow-right" onClick={() => onUse({ name: draft.name, mix, rules: draft.rules })}>
          Use this draft
        </Button>
        <Button variant="ghost" onClick={onRedo}>
          Describe it again
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-black/35">A draft from an AI model, not financial advice. You&apos;ll see a backtest and can change everything next.</p>
    </div>
  );
}

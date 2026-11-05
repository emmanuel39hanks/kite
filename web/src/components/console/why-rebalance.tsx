"use client";

import { useState } from "react";
import type { WhyFacts } from "@/app/api/vault/why/route";
import { askPrivately, type Receipt } from "@/lib/ai/private-ai";
import { cleanWhy, whyInput, whyPrompt, WHY_SCHEMA, whyTemplate, type WhyInput } from "@/lib/ai/why";

type Saved = { text: string; fromModel: boolean; input: WhyInput; receipt: Receipt | null; at: number };
const KEY = (hash: string) => `kite-why:${hash}`;
const load = (hash: string): Saved | null => {
  try {
    const raw = localStorage.getItem(KEY(hash));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Saved>;
    const okInput = !!s.input && typeof s.input.sell === "string" && typeof s.input.buy === "string" && typeof s.input.overByPts === "number";
    return typeof s.text === "string" && typeof s.fromModel === "boolean" && okInput ? (s as Saved) : null;
  } catch {
    return null;
  }
};

/** "Why?" on one rebalance. Facts come from the vault's own log on the chain; the signed explanation is saved on this device. */
export function WhyRebalance({ vault, hash }: { vault: string; hash: string }) {
  const [saved, setSaved] = useState<Saved | null>(() => (typeof window === "undefined" ? null : load(hash)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/vault/why?vault=${encodeURIComponent(vault)}&hash=${encodeURIComponent(hash)}`);
      const d = (await r.json()) as { facts?: WhyFacts; error?: string };
      if (!r.ok || !d.facts) throw new Error(d.error ?? "Couldn't read this trade from the chain.");
      const input = whyInput(d.facts);
      if (!input) throw new Error("This trade involves an asset Kite doesn't list.");
      let out: Saved;
      try {
        const { data, receipt } = await askPrivately({ system: whyPrompt, user: JSON.stringify(input), schema: WHY_SCHEMA, maxTokens: 400 });
        out = { ...cleanWhy(data, input), input, receipt, at: Date.now() };
      } catch {
        // The facts are real even when the model isn't reachable.
        out = { text: whyTemplate(input), fromModel: false, input, receipt: null, at: Date.now() };
      }
      setSaved(out);
      try {
        localStorage.setItem(KEY(hash), JSON.stringify(out));
      } catch {}
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!saved)
    return (
      <div className="mt-1.5">
        <button type="button" onClick={run} disabled={busy} className="cursor-pointer text-[13px] underline underline-offset-4 hover:text-black/70 disabled:cursor-default disabled:opacity-60">
          {busy ? "Reading the chain…" : "Why?"}
        </button>
        {err && <span className="ml-2 text-[12px] text-rose-600">{err}</span>}
      </div>
    );
  return (
    <div className="mt-1.5 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[13px] leading-5">
      <p>{saved.text}</p>
      <p className="mt-1 text-[12px] text-[#909090]">
        Facts read from the vault&apos;s own log: {saved.input.sell} {saved.input.overByPts} pts over target.{" "}
        {saved.fromModel && saved.receipt
          ? `Worded by a private model on NEAR AI (${saved.receipt.signatureKind === "provider_tee" ? "signed by its hardware" : "signed by NEAR AI's gateway"}), checked in this browser. Signature id ${saved.receipt.completionId.slice(0, 12)}…, saved on this device. NEAR AI hasn't promised how long it can be re-checked.`
          : "Standard wording; no model involved."}
      </p>
    </div>
  );
}

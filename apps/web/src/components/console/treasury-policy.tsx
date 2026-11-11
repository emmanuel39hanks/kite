"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, StatusNote } from "@/components/console/ui";
import { Icon } from "@/components/console/icons";
import { PolicyChecklist } from "@/components/console/policy-checklist";
import { sdkChecks } from "@/lib/ai/evidence-sdk";
import { POLICY_MODEL } from "@/lib/ai/planner";
import { buildProposal, fitRequest, policyFacts, rationaleFrom, type BuiltProposal } from "@/lib/ai/policy";
import { askPublicly } from "@/lib/ai/private-ai";
import { reviewStats } from "@/lib/ai/review";
import { verifyPolicy, type Check } from "@/lib/ai/verify-policy";
import { useHistory, useYields } from "@/lib/market/use-market";
import type { Slice } from "@/lib/mix";
import { proposeActions, readDao, vaultProposalKind } from "@/lib/near/dao";
import { toContractLimits, toContractPlan, type Timing } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import type { Guardrails } from "@/lib/store";

export type PolicyProposal = BuiltProposal & { txHash?: string };

const yoctoToNear = (y: bigint) => Number(y / 10n ** 18n) / 1e6;

/**
 * Propose a treasury policy for a vault. Code computes every number and the exact vault calls; NEAR AI writes
 * the reasons. The answer is signed by NEAR AI and packed into the proposal, so any voter can check it on /verify.
 * The analysis is public: it is sent without end-to-end encryption, so its signed bytes can be re-checked by anyone.
 */
export function TreasuryPolicy({
  vault,
  dao,
  plan,
  limits,
  planLocked,
  timing,
  onProposal,
}: {
  vault: string;
  /** The SputnikDAO that owns the vault. With a connected wallet, the proposal can be sent from here. */
  dao?: string;
  plan: Slice[];
  limits: Guardrails;
  /** Why the target mix can't be part of this proposal, if it can't (e.g. the plan holds a token Kite doesn't know). */
  planLocked?: string;
  /** The vault's current trade gap and settle window, kept as they are (the sliders don't set them). */
  timing?: Timing;
  /** Called once a proposal is drafted (no txHash), and again after it is sent to the DAO (with txHash). */
  onProposal?: (p: PolicyProposal) => void;
}) {
  const w = useWallet();
  const h = useHistory(365);
  const yields = useYields();
  const [mandate, setMandate] = useState("");
  // Off by default: most policy votes only change guardrails, and a plan change fails if the vote lands mid-swap.
  const [setPlanWanted, setSetPlan] = useState(false);
  const setPlan = setPlanWanted && !planLocked;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ p: BuiltProposal; checks: Check[] } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy("Starting…");
    setErr(null);
    setRes(null);
    setSent(null);
    try {
      const targets = toContractPlan(plan);
      // The plan's own weights stand in for "current": a policy is about rules, not today's balances.
      const stats = h ? reviewStats(h, plan, Object.fromEntries(plan.map((s) => [s.id, s.weight])), limits, yields) : null;
      const facts = policyFacts({ vault, limits: toContractLimits(limits, timing), rules: limits, targets, setPlan, stats, mandate });
      const { request, facts: sent } = await fitRequest(POLICY_MODEL, facts);
      // The model sometimes slips in a number of its own; that answer is kept out. Up to three tries, each signed;
      // the proposal carries the evidence for the answer it uses (or for the last one, with Kite's template).
      let bundle = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        bundle = await askPublicly({
          request,
          onStage: (st) => setBusy(st === "verify" ? "Checking NEAR AI's attestation…" : st === "ask" ? (attempt === 1 ? "Writing the rationale…" : `Rewriting the rationale (try ${attempt} of 3)…`) : "Getting the signature…"),
        });
        if (rationaleFrom(bundle.response, sent).fromModel) break;
      }
      const p = await buildProposal(bundle!);
      setBusy("Checking it as a voter would…");
      const v = await verifyPolicy({ description: p.description, kind: vaultProposalKind(vault, p.calls) }, sdkChecks(`${window.location.origin}/api/nearai/v1`));
      setRes({ p, checks: v.checks });
      onProposal?.(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!res) return;
    // The exact `add_proposal` arguments, so it can be submitted from any DAO tool.
    const args = { proposal: { description: res.p.description, kind: vaultProposalKind(vault, res.p.calls) } };
    try {
      await navigator.clipboard.writeText(JSON.stringify(args, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Couldn't copy. Your browser blocked the clipboard.");
    }
  };

  const propose = async () => {
    if (!res || !dao || busy) return;
    setBusy("Reading the DAO's bond…");
    setErr(null);
    try {
      const info = await readDao(dao);
      const { actions, topUp } = await proposeActions(dao, vault, res.p.description, res.p.calls, info.bond);
      // A long proposal can need more storage than a small DAO has spare; the difference goes along as a transfer.
      setBusy(topUp > 0n ? `Sending, with ${yoctoToNear(topUp).toFixed(3)} NEAR added for the DAO's storage…` : `Sending, with a ${yoctoToNear(info.bond)} NEAR bond…`);
      const hash = await w.send(dao, actions);
      setSent(hash);
      onProposal?.({ ...res.p, txHash: hash });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const canPropose = !!dao && !!w.accountId && !w.preview;
  const failed = res?.checks.some((c) => c.state === "fail");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[16px] tracking-[-0.02em]">Treasury policy</div>
          <p className="mt-0.5 max-w-[60ch] text-[13px] leading-5 text-[#6b6b6b]">
            Kite works out the limits, the worst case and the exact calls on {vault}. A model on NEAR AI writes the reasons, and its signed answer goes into the proposal so every voter can check it. This analysis is public: it is not encrypted.
          </p>
        </div>
        {res && <Badge tone={failed ? "red" : "green"}>{failed ? "A check failed" : "Ready to propose"}</Badge>}
      </div>

      {!res && (
        <div className="mt-4 space-y-3">
          <input
            value={mandate}
            onChange={(e) => setMandate(e.target.value)}
            maxLength={300}
            disabled={!!busy}
            placeholder="Optional: the DAO's goal, e.g. keep runway safe, take little risk"
            aria-label="The DAO's goal in plain words"
            className="w-full rounded-xl bg-white px-4 py-2.5 text-[15px] ring-1 ring-inset ring-black/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-[#5aa8f5] disabled:opacity-60"
          />
          <label className={`flex items-start gap-2 text-[13px] text-black/70 ${planLocked ? "opacity-60" : "cursor-pointer"}`}>
            <input type="checkbox" className="mt-1" checked={setPlan} onChange={(e) => setSetPlan(e.target.checked)} disabled={!!busy || !!planLocked} />
            <span>
              Also set the target mix.{" "}
              {planLocked ?? "If the vote passes while Kite has a swap in flight, the vault refuses a plan change and the whole proposal fails, so the DAO would vote again."}
            </span>
          </label>
          <Button icon="shield" onClick={run} loading={!!busy}>
            {busy ?? "Draft the policy"}
          </Button>
        </div>
      )}

      {err && (
        <StatusNote tone="err" className="mt-3">
          {err}
        </StatusNote>
      )}

      {res && (
        <>
          <pre className="mt-4 max-h-[360px] overflow-auto rounded-xl bg-white p-3.5 font-[inherit] text-[13px] leading-5 whitespace-pre-wrap text-black/80 ring-1 ring-inset ring-black/[0.06]">
            {res.p.description.split("\n").slice(0, -1).join("\n")}
          </pre>
          <p className="mt-1.5 text-[12px] text-[#6b6b6b]">The last line of the proposal, not shown here, carries the signed evidence ({res.p.description.length.toLocaleString("en-US")} characters in all).</p>

          <div className="mt-4 text-[14px]">What a voter will see on the check page</div>
          <div className="mt-2 rounded-xl bg-white p-3.5 ring-1 ring-inset ring-black/[0.06]">
            <PolicyChecklist checks={res.checks} />
          </div>

          {sent && (
            <StatusNote tone="ok" className="mt-3">
              Proposal sent to {dao}. Transaction {sent.slice(0, 10)}…
            </StatusNote>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {canPropose && !sent && (
              <Button variant="primary" icon="share" onClick={propose} loading={!!busy} disabled={failed}>
                {busy ?? "Propose to the DAO"}
              </Button>
            )}
            <Button icon={copied ? "check" : "copy"} onClick={copy}>
              {copied ? "Copied" : "Copy proposal"}
            </Button>
            <Button variant="ghost" onClick={() => (setRes(null), setSent(null))}>
              Start again
            </Button>
          </div>
          {dao && !canPropose && <p className="mt-2 text-[12px] text-[#6b6b6b]">Connect a wallet that can propose to {dao} to send it from here, or copy it into your DAO tool.</p>}
        </>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[12px] text-[#6b6b6b]">
        <Icon name="check" size={12} />
        Anyone can check a Kite policy proposal, with no wallet, at{" "}
        <Link href="/verify" className="underline underline-offset-2 hover:text-black">
          the check page
        </Link>
        .
      </p>
    </Card>
  );
}

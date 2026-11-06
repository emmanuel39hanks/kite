"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Segmented, StatusNote } from "@/components/console/ui";
import { PolicyChecklist } from "@/components/console/policy-checklist";
import { sdkChecks } from "@/lib/ai/evidence-sdk";
import { verdict, verifyPolicy, type VerifyResult } from "@/lib/ai/verify-policy";
import { decodeEvidenceLine, splitDescription } from "@/lib/ai/evidence";
import { factsFromRequest } from "@/lib/ai/policy";
import { accountUrl } from "@/lib/near/config";
import type { DaoProposal } from "@/lib/near/dao";
import { readProposal, readVaultOwner } from "@/lib/near/proposal";

const MODES = ["From a DAO", "Paste a description"] as const;
type Mode = (typeof MODES)[number];
const isAccount = (s: string) => s.length >= 2 && s.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s);

const field =
  "w-full rounded-xl bg-white px-4 py-2.5 text-[15px] ring-1 ring-inset ring-black/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-[#5aa8f5] disabled:opacity-60";

export function Verifier() {
  const sp = useSearchParams();
  const [mode, setMode] = useState<Mode>("From a DAO");
  const [dao, setDao] = useState(sp.get("dao") ?? "");
  const [id, setId] = useState(sp.get("id") ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<(VerifyResult & { proposal: DaoProposal | null }) | null>(null);

  const run = async (m: Mode = mode, d = dao.trim(), i = id.trim()) => {
    setErr(null);
    setRes(null);
    try {
      let description = text;
      let proposal: DaoProposal | null = null;
      if (m === "From a DAO") {
        if (!isAccount(d)) throw new Error("Enter the DAO's NEAR account, for example treasury.sputnik-dao.near.");
        if (!/^\d{1,9}$/.test(i)) throw new Error("Enter the proposal number.");
        setBusy("Reading the proposal from NEAR…");
        proposal = await readProposal(d, Number(i));
        description = proposal.description;
      } else if (!text.trim()) throw new Error("Paste the proposal's description, including its last line.");
      setBusy("Checking…");
      // For a proposal read from a DAO, also read who owns the vault the analysis is about, right now.
      let vaultOwner: string | null | undefined;
      if (proposal) {
        const line = splitDescription(description).line;
        const vault = line ? await decodeEvidenceLine(line).then((b) => factsFromRequest(b.request).vault).catch(() => null) : null;
        vaultOwner = vault ? await readVaultOwner(vault) : undefined;
      }
      const r = await verifyPolicy({ description, kind: proposal ? proposal.kind : undefined, dao: proposal ? d : undefined, vaultOwner }, sdkChecks(`${window.location.origin}/api/nearai/v1`));
      setRes({ ...r, proposal });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/does not exist|ProposalNotFound|ERR_NO_PROPOSAL|Server error/i.test(m) ? "That DAO or proposal wasn't found on NEAR." : m);
    } finally {
      setBusy(null);
    }
  };

  // A link with ?dao=…&id=… checks straight away.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    const d = sp.get("dao");
    const i = sp.get("id");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one check on arrival from a shared link
    if (d && i) void run("From a DAO", d, i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fails = res?.checks.filter((c) => c.state === "fail").length ?? 0;
  const unknowns = res?.checks.filter((c) => c.state === "unknown" && c.key !== "stats").length ?? 0;

  return (
    <div className="mt-6 space-y-4">
      <Card className="p-5">
        <Segmented options={MODES} value={mode} onChange={setMode} label="What to check" size="md" />
        {mode === "From a DAO" ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={dao} onChange={(e) => setDao(e.target.value.trim().toLowerCase())} placeholder="treasury.sputnik-dao.near" aria-label="DAO account" className={`${field} sm:flex-[3]`} disabled={!!busy} />
            <input value={id} onChange={(e) => setId(e.target.value.trim())} inputMode="numeric" placeholder="Proposal number" aria-label="Proposal number" className={`${field} sm:flex-1`} disabled={!!busy} />
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste the whole description, including the kite-evidence line at the end"
            aria-label="Proposal description"
            className={`${field} mt-4 font-mono text-[12px] leading-5`}
            disabled={!!busy}
          />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon="shield" onClick={() => void run()} loading={!!busy}>
            {busy ?? "Check"}
          </Button>
          {mode === "Paste a description" && <span className="text-[12px] text-[#6b6b6b]">A pasted description can&apos;t show which calls the DAO would make. Load it from the DAO for that.</span>}
        </div>
      </Card>

      {err && <StatusNote tone="err">{err}</StatusNote>}

      {res && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[16px] tracking-[-0.02em]">
              {res.proposal ? (
                <>
                  Proposal {id} on{" "}
                  <a href={accountUrl(dao)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {dao}
                  </a>
                </>
              ) : (
                "Pasted description"
              )}
            </div>
            <Badge tone={verdict(res.checks) === "verified" ? "green" : verdict(res.checks) === "failed" ? "red" : "amber"}>
              {verdict(res.checks) === "verified"
                ? "Verified"
                : fails
                  ? `Not verified: ${fails} check${fails === 1 ? "" : "s"} failed`
                  : `Not verified: ${unknowns} check${unknowns === 1 ? "" : "s"} couldn't be done`}
            </Badge>
          </div>
          {res.proposal && (
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              Proposed by {res.proposal.proposer}. Status: {res.proposal.status}.
            </p>
          )}
          <div className="mt-4">
            <PolicyChecklist checks={res.checks} />
          </div>
          {res.bundle && (
            <details className="mt-4 rounded-xl bg-white px-3.5 py-2.5 text-[12px] leading-5 text-black/70 ring-1 ring-inset ring-black/[0.06]">
              <summary className="cursor-pointer text-[13px] text-black">The evidence, as signed</summary>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 break-all">
                <dt className="text-[#6b6b6b]">Model</dt>
                <dd>{res.bundle.model}</dd>
                <dt className="text-[#6b6b6b]">Signed by</dt>
                <dd>{res.bundle.kind === "provider_tee" ? "the model's hardware" : "NEAR AI's gateway"}</dd>
                <dt className="text-[#6b6b6b]">Key</dt>
                <dd>
                  {res.bundle.signingAlgo} {res.bundle.signingAddress}
                </dd>
                <dt className="text-[#6b6b6b]">Completion</dt>
                <dd>{res.bundle.completionId}</dd>
                <dt className="text-[#6b6b6b]">Signed text</dt>
                <dd>{res.bundle.signedText}</dd>
                <dt className="text-[#6b6b6b]">policy_ref</dt>
                <dd>{res.policyRef}</dd>
              </dl>
              <div className="mt-3 text-[#6b6b6b]">What the model was given (exact bytes)</div>
              <pre className="mt-1 max-h-[240px] overflow-auto rounded-lg bg-[#f5f5f7] p-2.5 font-mono text-[11px] whitespace-pre-wrap">{res.bundle.request}</pre>
              <div className="mt-3 text-[#6b6b6b]">What it answered (exact bytes)</div>
              <pre className="mt-1 max-h-[240px] overflow-auto rounded-lg bg-[#f5f5f7] p-2.5 font-mono text-[11px] whitespace-pre-wrap">{res.bundle.response}</pre>
            </details>
          )}
          {res.body && (
            <details className="mt-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-inset ring-black/[0.06]">
              <summary className="cursor-pointer text-[13px]">The proposal text</summary>
              <pre className="mt-2 font-[inherit] text-[13px] leading-5 whitespace-pre-wrap text-black/80">{res.body}</pre>
            </details>
          )}
        </Card>
      )}

      <p className="text-[12px] leading-5 text-[#6b6b6b]">
        What this does not prove: that the analysis is right, or that the price statistics are correct. A signature from a key in NEAR AI&apos;s current TEE report shows the words came from that
        model and weren&apos;t changed; a signature from any other key shows nothing, so &ldquo;Verified&rdquo; needs that check too. The worst case is recomputed here from the call arguments. NEAR AI&apos;s current report is fetched through Kite&apos;s relay, which only adds the API key; the report is verified here, not on Kite&apos;s server.
      </p>
    </div>
  );
}

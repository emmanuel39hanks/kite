"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Donut, MixBar } from "@/components/charts";
import { ConnectGate } from "@/components/console/connect-gate";
import { Icon } from "@/components/console/icons";
import { Badge, Button, Card, StatusNote } from "@/components/console/ui";
import { Wordmark } from "@/components/kite-mark";
import { Logo } from "@/components/logo";
import type { LogoId } from "@/lib/assets";
import { assetById, usd } from "@/lib/assets";
import type { Slice } from "@/lib/mix";
import { planBySlug } from "@/lib/plans";
import { liveAvailable, NEAR, txUrl } from "@/lib/near/config";
import { useLive } from "@/lib/near/live";
import { verifyDeposit } from "@/lib/near/allocate-check";
import { SOURCES as CHAIN_SOURCES } from "@/lib/near/sources";
import { usdcBalance } from "@/lib/near/vault";
import { useWallet } from "@/lib/near/wallet";
import { useKite } from "@/lib/store";
import { useMarket } from "@/lib/market/use-market";
import { PreviewBar } from "@/components/console/preview-bar";
import { dryQuote, usePreview, type DryQuote } from "@/lib/preview/engine";

type Step = "vault" | "money" | "live";
const STEPS: { id: Step; label: string }[] = [
  { id: "vault", label: "Create your vault" },
  { id: "money", label: "Add money" },
  { id: "live", label: "Live" },
];

export function StartFlow({ slug }: { slug: string }) {
  const k = useKite();
  const w = useWallet();
  const topUp = slug === "add-money";
  const plan = planBySlug(slug);

  // What we're setting up: a ready-made plan, the builder's draft, or the existing vault.
  const setup = useMemo(() => {
    if (topUp) return k.portfolio ? { name: k.portfolio.name, mix: k.portfolio.target, slug: k.portfolio.planSlug } : null;
    if (slug === "custom") return k.draft ? { name: k.draft.name, mix: k.draft.mix, slug: "custom" } : null;
    return plan && !plan.comingSoon ? { name: plan.name, mix: plan.mix, slug: plan.slug } : null;
  }, [topUp, slug, plan, k.draft, k.portfolio]);

  const [step, setStep] = useState<Step>(topUp ? "money" : "vault");
  // Set once this visit creates the vault, so the "already have a vault" screen doesn't replace the success panel.
  const [created, setCreated] = useState(false);

  if (!k.ready || !w.ready) return <Frame step={step} topUp={topUp} />;

  if (!w.accountId) {
    return (
      <Frame step={step} topUp={topUp}>
        <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-8">
          <ConnectGate text={setup ? `Connect to set up “${setup.name}”. Your vault is created on your own NEAR account.` : undefined} />
        </div>
      </Frame>
    );
  }

  // Waiting for the first chain read.
  if (k.vaultFound === null) return <Frame step={step} topUp={topUp} />;

  // One vault per account: kite.<you>. Setting up again would fail at CreateAccount.
  if (!topUp && k.vaultFound && step === "vault" && !created) {
    return (
      <Frame step={step} topUp={topUp}>
        <Message title="You already have a vault" text={`${k.portfolio?.vault ?? "Your vault"} is set up with “${k.portfolio?.name}”. Add money to it, or go back home.`}>
          <Button href="/console">Home</Button>
          <Button variant="primary" href="/console/start/add-money" icon="deposit">
            Add money
          </Button>
        </Message>
      </Frame>
    );
  }

  if (!setup) {
    return (
      <Frame step={step} topUp={topUp}>
        <Message
          title={topUp ? "Create your vault first" : "Nothing to set up yet"}
          text={topUp ? "Pick a plan to create your vault, then add money to it." : "Pick a plan or build one first."}
        >
          <Button variant="primary" href="/console/explore">
            Explore plans
          </Button>
        </Message>
      </Frame>
    );
  }

  return (
    <Frame step={step} topUp={topUp}>
      <div className="mx-auto grid max-w-[1160px] gap-3 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:py-12">
        <Summary name={setup.name} mix={setup.mix} />
        <div>
          {step === "vault" && <VaultStep name={setup.name} mix={setup.mix} slug={setup.slug} onCreated={() => setCreated(true)} onDone={() => setStep("money")} />}
          {step === "money" && <MoneyStep onDone={() => setStep("live")} />}
          {step === "live" && <LiveStep mix={setup.mix} />}
        </div>
      </div>
    </Frame>
  );
}

function Frame({ step, topUp, children }: { step: Step; topUp: boolean; children?: React.ReactNode }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  const shown = topUp ? STEPS.slice(1) : STEPS;
  return (
    <div className="min-h-dvh bg-[#fcfcfd] text-black">
      <header className="sticky top-0 z-30 flex h-[80px] items-center gap-4 border-b border-black/[0.06] bg-[#fcfcfd]/90 px-5 backdrop-blur-xl sm:px-7">
        <Link href="/console" aria-label="Back home">
          <Wordmark className="text-[28px]" />
        </Link>
        <ol className="mx-auto flex items-center gap-2 sm:gap-3" aria-label="Progress">
          {shown.map((s, n) => {
            const i = STEPS.findIndex((x) => x.id === s.id);
            const done = i < idx;
            const current = i === idx;
            return (
              <li key={s.id} className="flex items-center gap-2 sm:gap-3" aria-current={current ? "step" : undefined}>
                {n > 0 && <span className={`h-px w-4 sm:w-8 ${done || current ? "bg-black/30" : "bg-black/10"}`} />}
                <span
                  className={`grid h-8 w-8 place-items-center rounded-full text-[14px] tabular-nums ${
                    current ? "bg-black text-white" : done ? "bg-[#05a800]/10 text-[#05a800]" : "bg-black/[0.05] text-black/40"
                  }`}
                >
                  {done ? <Icon name="check" size={15} /> : n + 1}
                </span>
                <span className={`hidden text-[15px] tracking-[-0.02em] md:inline ${current ? "" : "text-black/45"}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>
        <Link href="/console" aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-black/50 hover:bg-black/[0.04] hover:text-black">
          <Icon name="x" size={18} />
        </Link>
      </header>
      <PreviewBar />
      {children}
    </div>
  );
}

function Message({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[520px] px-4 py-24 text-center">
      <h1 className="text-[30px] tracking-[-0.05em]">{title}</h1>
      <p className="mt-2 text-[16px] text-[#909090]">{text}</p>
      <div className="mt-7 flex justify-center gap-2.5">{children}</div>
    </div>
  );
}

function Summary({ name, mix }: { name: string; mix: Slice[] }) {
  const k = useKite();
  return (
    <Card className="self-start p-6">
      <div className="text-[14px] text-[#909090]">Your plan</div>
      <h1 className="mt-1 text-[40px] leading-[44px] tracking-[-0.05em]">{name}</h1>
      <div className="mt-6 flex items-center gap-6">
        <Donut slices={mix} size={112} thickness={8} />
        <ul className="flex-1 space-y-2.5">
          {mix.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-[15px] tracking-[-0.02em]">
              <Logo id={s.id} size={26} />
              {assetById(s.id).name}
              <span className="ml-auto text-[#909090] tabular-nums">{s.weight}%</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2">
        {[
          ["Checked", "Daily"],
          ["Steps in at", `${k.guardrails.driftBand} pts off`],
          ["Withdraw", "Only you"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-white p-3.5 shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <div className="text-[12px] text-[#909090]">{l}</div>
            <div className="mt-0.5 text-[15px] tracking-[-0.02em]">{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[20px] bg-white p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_60px_-30px_rgba(20,40,70,0.25)] sm:p-8">{children}</div>;
}

function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <StatusNote tone="err" className="mt-4">
      {text}
    </StatusNote>
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ─────────────── Step 1: the signature ─────────────── */

function VaultStep({ name, mix, slug, onCreated, onDone }: { name: string; mix: Slice[]; slug: string; onCreated: () => void; onDone: () => void }) {
  const k = useKite();
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const ready = liveAvailable() || live.preview;

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated();
      try {
        setHash(await live.createVault(name, slug, mix, k.guardrails));
      } catch (e) {
        throw e;
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (hash !== null) {
    return (
      <Panel>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#05a800]/10 text-[#05a800]">
          <Icon name="check" size={22} />
        </span>
        <h2 className="mt-4 text-[28px] tracking-[-0.05em]">Vault created</h2>
        <p className="mt-2 text-[15px] leading-6 text-[#909090]">
          {live.preview
            ? `${live.vault} is set up in this browser with your plan inside it and Kite's rebalance-only key attached. On a real account this is one signature.`
            : `${live.vault} is live on NEAR with your plan inside it and Kite's rebalance-only key attached.`}
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button variant="primary" size="lg" onClick={onDone} iconRight="arrow-right">
            Add money
          </Button>
          {hash && (
            <Button size="lg" href={txUrl(hash)} external icon="external">
              Transaction
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="text-[28px] tracking-[-0.05em]">Create your vault</h2>
      <p className="mt-2 text-[15px] leading-6 text-[#909090]">One signature sets everything up. This is exactly what it does, before your wallet asks.</p>

      <ul className="mt-6 space-y-2">
        <Grant ok title={`Creates ${live.vault}`} text="A vault contract on your own account that holds your money. Only you can withdraw." />
        <Grant ok title="Saves your plan inside it" text={`${mix.map((s) => `${assetById(s.id).ticker} ${s.weight}%`).join(", ")}. Kite can't trade anything else.`} />
        <Grant
          ok
          title="Gives Kite one key"
          text={`It can call two things: rebalance and settle, with ${NEAR.agentAllowanceNear} NEAR for gas. Your guardrails cap every trade.`}
        />
        <Grant title="Kite's key can't" text="Withdraw, send to anyone, add new assets or change your limits. Those need your own signature." />
      </ul>

      <div className="mt-6 rounded-2xl bg-[#f5f5f7] px-4 py-3.5 text-[14px]">
        <div className="flex justify-between gap-4">
          <span className="text-[#909090]">Vault deposit, returned when you close it</span>
          <span>{NEAR.vaultStorageNear} NEAR</span>
        </div>
        <div className="mt-1.5 flex justify-between gap-4">
          <span className="text-[#909090]">Network fee</span>
          <span>about 0.01 NEAR</span>
        </div>
      </div>

      <Button variant="primary" size="lg" onClick={sign} disabled={!ready} loading={busy} className="mt-6 w-full">
        {busy ? (live.preview ? "Creating…" : "Waiting for your wallet…") : live.preview ? "Create vault (preview)" : "Create vault"}
      </Button>
      {live.preview && <p className="mt-3 text-[13px] leading-5 text-[#909090]">Preview: nothing is signed. The simulated wallet pays the deposit and fee, and gets the deposit back if you close the vault.</p>}
      {!ready && !live.preview && <p className="mt-3 text-[13px] text-[#8a5a00]">This deployment has no agent key configured (NEXT_PUBLIC_KITE_AGENT_PK), so vaults can&apos;t be created yet.</p>}
      <ErrorNote text={error} />
    </Panel>
  );
}

function Grant({ ok = false, title, text }: { ok?: boolean; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-[#f5f5f7] p-4">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${ok ? "bg-[#05a800] text-white" : "bg-rose-500/15 text-rose-600"}`}>
        <Icon name={ok ? "check" : "x"} size={13} />
      </span>
      <div>
        <div className="text-[15px] tracking-[-0.02em]">{title}</div>
        <p className="text-[14px] leading-5 text-[#909090]">{text}</p>
      </div>
    </li>
  );
}

/* ─────────────── Step 2: add money ─────────────── */

const SOURCES: { id: string; label: string; token: LogoId; chain: LogoId; asset: LogoId }[] = [
  { id: "near", label: "USDC in my NEAR wallet", token: "usdc", chain: "near", asset: "usdc" },
  { id: "usdc-base", label: "USDC on Base", token: "usdc", chain: "base", asset: "usdc" },
  { id: "usdc-arb", label: "USDC on Arbitrum", token: "usdc", chain: "arbitrum", asset: "usdc" },
  { id: "eth", label: "ETH on Ethereum", token: "eth", chain: "eth", asset: "eth" },
  { id: "btc", label: "Bitcoin", token: "btc", chain: "btc", asset: "btc" },
  { id: "sol", label: "SOL on Solana", token: "sol", chain: "sol", asset: "sol" },
];

type Quote = { depositAddress: string; amountInFormatted: string; amountOutFormatted: string; timeEstimate: number };
const MIN = 2;

function MoneyStep({ onDone }: { onDone: () => void }) {
  const k = useKite();
  const live = useLive();
  const { price } = useMarket();
  const [src, setSrc] = useState(SOURCES[0]);
  const [amount, setAmount] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [swap, setSwap] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [dry, setDry] = useState<DryQuote | null>(null);
  const pv = usePreview(live.preview);
  const n = Number(amount.replace(/,/g, ""));
  const valid = Number.isFinite(n) && n >= MIN;

  useEffect(() => {
    if (!k.account || live.preview) return;
    usdcBalance(k.account)
      .then((b) => setWalletUsdc(Number(b) / 1e6))
      .catch(() => setWalletUsdc(null));
  }, [k.account, live.preview]);
  const walletShown = live.preview ? (pv?.wallet.usdc ?? null) : walletUsdc;

  // Watch the 1Click deposit address until the money lands in the vault.
  useEffect(() => {
    if (!quote) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/deposit/status?address=${encodeURIComponent(quote.depositAddress)}`)
        .then((x) => x.json())
        .catch(() => null);
      if (!r?.status) return;
      setSwap(r.status);
      if (r.status === "SUCCESS") {
        setArrived(true);
        k.addEvent({ kind: "deposit", title: `Deposit arrived: ${quote.amountOutFormatted} USDC`, detail: `Swapped from ${src.label} through NEAR Intents.` });
        clearInterval(t);
      }
      if (r.status === "REFUNDED" || r.status === "FAILED") clearInterval(t);
    }, 5000);
    return () => clearInterval(t);
  }, [quote, k, src.label]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const getAddress = () =>
    run(async () => {
      const c = CHAIN_SOURCES[src.id];
      if (live.preview) {
        setDry(await dryQuote(c.asset, NEAR.usdc, n / price(src.asset), c.decimals, true));
        return;
      }
      const base = BigInt(Math.floor((n / price(src.asset)) * 10 ** Math.min(c.decimals, 12))) * 10n ** BigInt(Math.max(0, c.decimals - 12));
      const r = await fetch("/api/deposit/quote", { method: "POST", body: JSON.stringify({ source: src.id, amount: base.toString(), vault: live.vault, owner: k.account }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn't get a deposit address. Try a larger amount.");
      // This send can't be undone, so check the address with NEAR Intents itself before showing it.
      await verifyDeposit({ address: String(d.depositAddress), vault: live.vault, owner: k.account!, sourceAsset: c.asset, usdcToken: NEAR.usdc, amount: base.toString() });
      setQuote(d);
    });

  const fromWallet = () =>
    run(async () => {
      if (walletShown !== null && n > walletShown) throw new Error(`Your wallet has ${usd(walletShown)} USDC.`);
      await live.depositFromWallet(BigInt(Math.floor(n * 1e6)));
      setArrived(true);
    });

  const invest = () =>
    run(async () => {
      await live.allocate();
      onDone();
    });
  const investAsOf = (days: 30 | 90 | 365) =>
    run(async () => {
      if (!live.preview) return;
      await live.investAsOf(days);
      onDone();
    });
  const arrive = () =>
    run(async () => {
      if (!live.preview || !dry) return;
      await live.depositArrived(src.label, dry);
      setArrived(true);
    });

  if (arrived) {
    return (
      <Panel>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#05a800]/10 text-[#05a800]">
          <Icon name="check" size={22} />
        </span>
        <h2 className="mt-4 text-[28px] tracking-[-0.05em]">Put it to work</h2>
        <p className="mt-2 text-[15px] leading-6 text-[#909090]">Your money is in the vault as USDC. One signature splits it across your plan through NEAR Intents.</p>
        <Button variant="primary" size="lg" onClick={invest} loading={busy} className="mt-6 w-full">
          {busy ? (live.preview ? "Getting quotes…" : "Waiting for your wallet…") : live.preview ? "Invest at today's real quotes" : "Invest into my plan"}
        </Button>
        {live.preview && (
          <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4">
            <div className="text-[14px] tracking-[-0.02em]">Or see how it would have gone</div>
            <p className="mt-0.5 text-[13px] leading-5 text-[#909090]">
              Start as if you&apos;d invested earlier. Kite&apos;s daily check is replayed on real closing prices with your guardrails, so you see real rebalances and real profit and loss.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  [30, "1 month ago"],
                  [90, "3 months ago"],
                  [365, "1 year ago"],
                ] as const
              ).map(([d, l]) => (
                <Button key={d} size="sm" onClick={() => investAsOf(d)} disabled={busy}>
                  {l}
                </Button>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={onDone} className="mt-3 w-full cursor-pointer text-[14px] text-[#909090] hover:text-black">
          Later
        </button>
        <ErrorNote text={error} />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[28px] tracking-[-0.05em]">Add money</h2>
          <p className="mt-2 text-[15px] leading-6 text-[#909090]">Send from the chain you already use. It lands in your vault as USDC, then one signature puts it into your plan.</p>
        </div>
        <button type="button" onClick={onDone} className="shrink-0 cursor-pointer text-[14px] text-[#909090] hover:text-black">
          Skip
        </button>
      </div>

      <div role="radiogroup" aria-label="Send from" className="mt-6 grid gap-2 sm:grid-cols-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={src.id === s.id}
            onClick={() => {
              setSrc(s);
              setQuote(null);
              setSwap(null);
              setDry(null);
            }}
            className={`flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 text-left text-[14px] tracking-[-0.02em] transition-colors ${
              src.id === s.id ? "bg-white ring-2 ring-black" : "bg-[#f5f5f7] hover:bg-[#efeff2]"
            }`}
          >
            <span className="relative">
              <Logo id={s.token} size={30} />
              {s.chain !== s.token && (
                <span className="absolute -right-1 -bottom-1">
                  <Logo id={s.chain} size={15} className="ring-2 ring-white" />
                </span>
              )}
            </span>
            {s.label}
          </button>
        ))}
      </div>

      <label className="mt-6 block">
        <span className="flex justify-between text-[14px] text-[#909090]">
          Amount in dollars
          {src.id === "near" && walletShown !== null && (
            <button type="button" className="cursor-pointer hover:text-black" onClick={() => setAmount(walletShown.toFixed(2))}>
              Wallet: {usd(walletShown)} USDC
            </button>
          )}
        </span>
        <div className="mt-1.5 flex items-center rounded-2xl bg-[#f5f5f7] px-4 ring-[#5aa8f5] focus-within:ring-2">
          <span className="text-[24px] text-black/35">$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuote(null);
              setDry(null);
            }}
            className="w-full bg-transparent px-2 py-3.5 text-[28px] tracking-[-0.04em] tabular-nums outline-none"
            aria-describedby="amount-hint"
          />
        </div>
        <span id="amount-hint" className={`mt-1.5 block text-[13px] ${valid ? "text-[#909090]" : "text-rose-600"}`}>
          {valid ? (src.id === "near" ? "Goes straight into your vault. Network fee only." : "Swap cost about 0.3–0.7%, quoted before you send.") : `Enter at least $${MIN}.`}
        </span>
      </label>

      {quote && (
        <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4 text-[14px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#909090]">
              Send exactly {quote.amountInFormatted} {src.label.replace(/ in my NEAR wallet| on .*/, "")} to
            </span>
            {swap && <Badge tone={swap === "SUCCESS" ? "green" : swap === "REFUNDED" || swap === "FAILED" ? "red" : "blue"}>{swap.replace(/_/g, " ").toLowerCase()}</Badge>}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 font-mono text-[13px] break-all">{quote.depositAddress}</code>
            <Button
              size="sm"
              icon={copied ? "check" : "copy"}
              onClick={() => {
                navigator.clipboard.writeText(quote.depositAddress).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2.5 text-[12px] leading-5 text-[#909090]">
            A one-time address from NEAR Intents. About {quote.amountOutFormatted} USDC lands in your vault roughly {quote.timeEstimate}s after your transfer confirms. If the swap can&apos;t complete, it&apos;s refunded to your NEAR account.
          </p>
        </div>
      )}

      {dry && (
        <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4 text-[14px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[#909090]">Real NEAR Intents quote (dry run, no address issued)</span>
            <Badge>Preview</Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span>
              Send {dry.amountInFormatted} {src.label.replace(/ on .*/, "")}
            </span>
            <span className="text-[18px] tracking-[-0.03em] tabular-nums">≈ {Number(dry.amountOutFormatted).toFixed(2)} USDC</span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#909090]">
            Swap cost {usd(dry.amountInUsd - dry.amountOutUsd)}, about {Math.max(1, Math.round(dry.timeEstimate / 60))} min once your transfer confirms. A real account gets a one-time deposit address here.
          </p>
          <Button variant="primary" size="lg" onClick={arrive} loading={busy} className="mt-4 w-full">
            Simulate the deposit arriving
          </Button>
        </div>
      )}

      {src.id === "near" ? (
        <Button variant="primary" size="lg" onClick={fromWallet} disabled={!valid} loading={busy} className="mt-6 w-full">
          {busy && !live.preview ? "Waiting for your wallet…" : `Send ${valid ? usd(n) : ""} USDC to my vault`}
        </Button>
      ) : (
        !quote &&
        !dry && (
          <Button variant="primary" size="lg" onClick={getAddress} disabled={!valid} loading={busy} className="mt-6 w-full">
            {busy ? (live.preview ? "Getting a quote…" : "Getting an address…") : live.preview ? "Get a real quote" : "Get my deposit address"}
          </Button>
        )
      )}
      <ErrorNote text={error} />
    </Panel>
  );
}

/* ─────────────── Step 3: live ─────────────── */

function LiveStep({ mix }: { mix: Slice[] }) {
  const k = useKite();
  const live = useLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const left = Math.max(0, next.getTime() - now);
  const hms = [3_600_000, 60_000, 1000].map((d, i) => String(Math.floor((left / d) % (i === 0 ? 100 : 60))).padStart(2, "0")).join(":");

  return (
    <Panel>
      <div className="text-center">
        <span className="relative mx-auto grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#05a800]/20 motion-reduce:animate-none" />
          <span className="h-6 w-6 rounded-full bg-[#05a800]" />
        </span>
        <h2 className="mt-5 text-[44px] leading-none tracking-[-0.05em]">You&apos;re live</h2>
        <p className="mx-auto mt-3 max-w-[40ch] text-[15px] leading-6 text-[#909090]">
          {k.portfolio && k.portfolio.value >= 1
            ? `${usd(k.portfolio.value)} is in your vault. Kite checks it every day and only trades when something drifts too far.`
            : "Your vault is ready. Swaps settle in about a minute; Home updates as they land."}
          {live.preview && " In preview there's no daily job: press Check now on Home to run Kite's check against live prices."}
        </p>
        <div className="mx-auto mt-7 max-w-[300px] rounded-2xl bg-[#f5f5f7] px-5 py-4">
          <div className="text-[13px] text-[#909090]">Next check in</div>
          <div className="mt-1 text-[30px] tracking-[-0.04em] tabular-nums">{hms}</div>
        </div>
        <MixBar slices={mix} className="mx-auto mt-6 h-1.5 max-w-[300px]" />
        <div className="mt-8 flex justify-center gap-2.5">
          <Button href="/console/guardrails" icon="shield">
            Guardrails
          </Button>
          <Button variant="primary" href="/console" iconRight="arrow-right">
            Home
          </Button>
        </div>
      </div>
    </Panel>
  );
}

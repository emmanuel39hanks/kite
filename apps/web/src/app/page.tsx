import { Donut, MixBar } from "@/components/charts";
import { Logo, logoName } from "@/components/logo";
import type { LogoId } from "@/lib/assets";
import { SiteNav } from "@/components/landing/site-nav";
import { Wordmark } from "@/components/kite-mark";
import { SkyVideo } from "@/components/landing/sky-video";
import { slice } from "@/lib/mix";
import { Plans } from "@/components/landing/plans";
import { Safety } from "@/components/landing/safety";
import { Daos } from "@/components/landing/daos";
import { ASSETS, type EarnId } from "@/lib/assets";
import { getYields } from "@/lib/market/yields";

export default function Home() {
  return (
    <main className="overflow-x-clip">
      <SiteNav />
      <Hero />
      <HowItWorks />
      <Balancing />
      <Plans />
      <Assets />
      <Earn />
      <PrivatePlanner />
      <Safety />
      <Daos />
      <Faq />
      <Closing />
      <Footer />
    </main>
  );
}

/* ─────────────── Shared pieces ─────────────── */

function SectionTitle({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="max-w-[640px]">
      <h2 className="text-[38px] leading-[1] font-medium tracking-[var(--tracking-display)] sm:text-[56px]">
        {title}
      </h2>
      {intro && <p className="mt-4 text-[18px] leading-[1.45] text-black/60 sm:text-[20px]">{intro}</p>}
    </div>
  );
}

/* ─────────────── Hero ─────────────── */

const HERO_MIX = [slice("btc", 40), slice("eth", 20), slice("sol", 15), slice("xaut", 25)];

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-24 sm:pb-32">
      <SkyVideo />
      <div className="absolute inset-0 bg-gradient-to-b from-white/35 via-white/5 to-paper" />

      <div className="relative z-10 mx-auto grid max-w-[1320px] items-center gap-16 px-5 pt-32 sm:px-10 sm:pt-40 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
        <div>
          <span className="glass inline-flex items-center gap-2 rounded-lg py-1.5 pr-3 pl-1.5 text-[14px] font-medium">
            <Logo id="near" size={22} />
            Built on NEAR
          </span>
          <h1 className="mt-6 text-[46px] leading-[0.95] font-medium tracking-[var(--tracking-display)] sm:text-[68px] lg:text-[80px]">
            Crypto and gold in one vault, kept on target for you.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[18px] leading-[1.45] text-black/70 sm:text-[20px]">
            You choose what to own. Kite buys it for you, checks it every day,
            and trades it back to your plan when prices move. It sits in a vault
            that only you can take money out of.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/console" className="rounded-lg bg-black px-5 py-3 text-[16px] font-medium text-white hover:bg-black/80">
              Get started
            </a>
            <a href="/console?preview=1" className="glass rounded-lg px-5 py-3 text-[16px] font-medium hover:bg-white">
              Try it without a wallet
            </a>
          </div>
        </div>

        <HeroCard />
      </div>
    </section>
  );
}

function HeroCard() {
  return (
    <div className="relative mx-auto w-full max-w-[440px]">
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] text-black/55">My plan</div>
            <div className="mt-1 text-[36px] leading-none font-medium tracking-[var(--tracking-tight)] tabular-nums">
              $12,480
            </div>
          </div>
          <Donut slices={HERO_MIX} size={92} />
        </div>
        <ul className="mt-6 space-y-3">
          {HERO_MIX.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <Logo id={s.id} size={30} />
              <span className="text-[15px] font-medium">{logoName(s.id)}</span>
              <span className="ml-auto text-[15px] text-black/55 tabular-nums">{s.weight}%</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-center gap-3 border-t border-black/10 pt-5">
          <div className="flex -space-x-2">
            <Logo id="btc" size={30} />
            <Logo id="xaut" size={30} />
          </div>
          <p className="text-[14px] leading-[1.3]">
            <span className="font-medium">Kite rebalanced.</span> Sold a little Bitcoin, bought gold.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── How it works (a real sequence, so it's numbered) ─────────────── */

function HowItWorks() {
  const plan = [slice("btc", 60), slice("eth", 20), slice("xaut", 20)];
  const steps = [
    {
      n: 1,
      title: "Pick a plan",
      text: "Start from a ready-made mix, build your own, or just describe your goal and get a private draft.",
      visual: (
        <>
          <div className="text-[12px] text-black/45">Your plan</div>
          <div className="text-[18px] font-medium tracking-[var(--tracking-snug)]">Bitcoin Plus</div>
          <MixBar slices={plan} className="mt-3 h-1.5" />
          <ul className="mt-3 space-y-2">
            {plan.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[14px]">
                <Logo id={s.id} size={22} />
                {logoName(s.id)}
                <span className="ml-auto text-black/50 tabular-nums">{s.weight}%</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      n: 2,
      title: "Add money",
      text: "Send digital dollars (USDC) or any coin from the wallet or exchange you already use.",
      visual: (
        <>
          <div className="flex items-center gap-2.5">
            <Logo id="usdc" size={30} />
            <div className="leading-tight">
              <div className="text-[18px] font-medium tabular-nums">$1,000 received</div>
              <div className="text-[12px] text-black/45">from Base, in about a minute</div>
            </div>
          </div>
          <ul className="mt-4 space-y-2 border-t border-line pt-3">
            {plan.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[14px]">
                <span className="text-black/45">Bought</span>
                <Logo id={s.id} size={20} />
                <span className="ml-auto tabular-nums">${(s.weight * 10).toLocaleString("en-US")}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      n: 3,
      title: "Kite keeps it balanced",
      text: "When one thing grows too big, Kite sells a little of it and buys what fell behind. You don't lift a finger.",
      visual: (
        <>
          <div className="text-[12px] text-black/45">Today, 00:00 UTC</div>
          <div className="mt-2 flex items-center gap-2 text-[14px]">
            <Logo id="btc" size={22} />
            Bitcoin
            <span className="ml-auto tabular-nums">
              <span className="text-black/40 line-through">68%</span> <span className="font-medium">60%</span>
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[14px]">
            <Logo id="xaut" size={22} />
            Gold
            <span className="ml-auto tabular-nums">
              <span className="text-black/40 line-through">14%</span> <span className="font-medium">20%</span>
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[14px] font-medium">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#05a800] text-[11px] text-white">✓</span>
            Back on plan
          </div>
        </>
      ),
    },
  ];
  return (
    <section id="how" className="scroll-mt-24 px-5 py-20 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-[1320px]">
        <SectionTitle title="How Kite works" intro="Three steps. The last one repeats on its own, for as long as you like." />
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="overflow-hidden rounded-2xl bg-cloud">
              <div className="relative grid aspect-[4/3] place-items-center p-6 pt-14">
                <div className="absolute top-4 left-4 grid h-8 w-8 place-items-center rounded-lg bg-white text-[15px] font-semibold">{s.n}</div>
                <div className="w-full max-w-[290px] rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_12px_30px_-18px_rgba(0,0,0,0.3)]">{s.visual}</div>
              </div>
              <div className="p-6 pt-2">
                <h3 className="text-[22px] font-medium tracking-[var(--tracking-snug)]">{s.title}</h3>
                <p className="mt-2 text-[16px] leading-[1.45] text-black/60">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─────────────── "Balanced" explained with a picture ─────────────── */

function Balancing() {
  const stages = [
    { label: "Your plan", note: "Half Bitcoin, half gold.", btc: 50 },
    { label: "Bitcoin jumps", note: "Now it's 70% of your money. More risk than you wanted.", btc: 70 },
    { label: "Kite steps in", note: "Sells some Bitcoin, buys gold. Back to half and half.", btc: 50 },
  ];
  return (
    <section className="px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px] rounded-2xl bg-cloud p-6 sm:p-10 lg:p-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
          <SectionTitle
            title="What does “balanced” mean?"
            intro="Prices move every day, so your mix drifts. Kite nudges it back, so you keep the risk you signed up for."
          />
          <ol className="grid gap-4 sm:grid-cols-3">
            {stages.map((s, i) => (
              <li key={s.label} className="flex flex-col rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
                <div className="flex h-44 items-end gap-3">
                  <Bar pct={s.btc} color="#F7931A" logo="btc" />
                  <Bar pct={100 - s.btc} color="#D4A537" logo="xaut" />
                </div>
                <div className="mt-5 text-[13px] text-black/45">Step {i + 1}</div>
                <h3 className="text-[18px] font-medium">{s.label}</h3>
                <p className="mt-1 text-[15px] leading-[1.4] text-black/60">{s.note}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Bar({ pct, color, logo }: { pct: number; color: string; logo: LogoId }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-end gap-2">
      <span className="text-[14px] font-medium tabular-nums">{pct}%</span>
      <div className="w-full rounded-lg" style={{ height: `${pct}%`, background: color }} />
      <Logo id={logo} size={26} />
    </div>
  );
}

/* ─────────────── What you can own ─────────────── */

function Assets() {
  const groups: { title: string; ids: LogoId[] }[] = [
    { title: `Crypto: ${ASSETS.filter((a) => a.live && a.kind === "Crypto" && !a.earn).length} coins, including`, ids: ["btc", "eth", "sol", "near", "xrp", "doge", "link", "zec"] },
    { title: "Stocks (coming soon)", ids: ["nvidia", "apple", "tesla"] },
    { title: "Gold and digital dollars", ids: ["xaut", "usdc", "usdt"] },
  ];
  return (
    <section className="px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px]">
        <SectionTitle
          title="Everything in one place"
          intro="Coins, gold and dollars sit side by side in one NEAR account, so moving between them is a single swap, at any hour."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title} className="rounded-2xl bg-cloud p-5">
              <h3 className="mb-4 text-[15px] font-medium text-black/50">{g.title}</h3>
              <ul className="grid grid-cols-2 gap-2">
                {g.ids.map((id) => (
                  <li key={id} className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-3 text-[15px] font-medium">
                    <Logo id={id} size={30} />
                    {logoName(id)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[14px] text-black/50">
          Stocks are coming soon, through Ondo, wherever Ondo serves your region.
        </p>
      </div>
    </section>
  );
}

/* ─────────────── Earn ─────────────── */

async function Earn() {
  const yields = await getYields().catch(() => ({}) as Awaited<ReturnType<typeof getYields>>);
  const earn = ASSETS.filter((a) => a.earn);
  const usdcApy = yields.gtusdc?.apy ?? 5;
  const after = 1000 * (1 + usdcApy / 100);
  return (
    <section id="earn" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px] rounded-2xl bg-cloud p-6 sm:p-10 lg:p-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
          <div>
            <SectionTitle
              title="Let it earn while it waits"
              intro="Dollars, NEAR, Ethereum and Solana can each be held in a version that earns. Same ups and downs, plus a little every day."
            />
            <div className="mt-8 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-2 text-[14px] text-black/55">
                  <Logo id="usdc" size={22} /> $1,000 in USDC
                </div>
                <div className="mt-3 text-[28px] font-medium tracking-[var(--tracking-snug)] tabular-nums">$1,000</div>
                <div className="text-[13px] text-black/45">after a year</div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-2 text-[14px] text-black/55">
                  <Logo id="gtusdc" size={22} /> Earning USDC
                </div>
                <div className="mt-3 text-[28px] font-medium tracking-[var(--tracking-snug)] tabular-nums text-[#05a800]">
                  ${after.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[13px] text-black/45">at today&apos;s {usdcApy.toFixed(1)}%</div>
              </div>
            </div>
          </div>
          <div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {earn.map((a) => {
                const y = yields[a.id as EarnId];
                return (
                  <li key={a.id} className="flex flex-col rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <Logo id={a.id} size={40} />
                      <div className="text-right">
                        <div className="text-[26px] leading-none font-medium tracking-[var(--tracking-snug)] tabular-nums text-[#05a800]">{y ? `${y.apy.toFixed(1)}%` : "–"}</div>
                        <div className="mt-1 text-[12px] text-black/45">a year, today</div>
                      </div>
                    </div>
                    <h3 className="mt-4 text-[18px] font-medium">{a.name}</h3>
                    <p className="mt-1 text-[15px] leading-[1.4] text-black/60">
                      Instead of {logoName(a.earn!.base)}. Earns from {a.earn!.how}, through {a.earn!.issuer}.
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 text-[14px] leading-[1.5] text-black/50">
              Rates come live from each protocol and change daily. Switching in and back out costs about 1–2%, so earning pays off over months, not days. You turn it on per
              holding when you build a plan.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Private planner (NEAR AI Cloud) ─────────────── */

function PrivatePlanner() {
  const draft = [
    { id: "gtusdc" as LogoId, name: "Earning USDC", pct: 70 },
    { id: "xaut" as LogoId, name: "Tether Gold", pct: 20 },
    { id: "btc" as LogoId, name: "Bitcoin", pct: 10 },
  ];
  const checks = [
    { title: "Locked on your device", text: "Your words are encrypted before they leave your browser." },
    { title: "Opened only in sealed hardware", text: "Only a model inside NEAR AI Cloud's secure chips can open them. Kite's server only passes the locked message along." },
    { title: "Signed and checked", text: "The answer comes back signed by that hardware, and your browser checks the signature." },
  ];
  return (
    <section id="ai" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px]">
        <SectionTitle
          title="Not sure what to pick? Just say it."
          intro="Describe your goal in your own words and get a draft plan back, privately. You check every number before anything happens."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-2xl bg-cloud p-5 sm:p-8">
            <div className="max-w-[460px] rounded-2xl rounded-br-md bg-white px-5 py-4 text-[17px] leading-[1.45] shadow-[0_0_0_1px_rgba(0,0,0,0.05)] sm:ml-auto">
              &ldquo;I&apos;m 30, saving for a house in about 3 years. I don&apos;t want big swings, but a little Bitcoin is fine.&rdquo;
            </div>
            <div className="mt-4 max-w-[460px] rounded-2xl rounded-bl-md bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
              <div className="text-[13px] text-black/45">Draft</div>
              <div className="text-[22px] font-medium tracking-[var(--tracking-snug)]">House fund, steady</div>
              <ul className="mt-4 space-y-2.5">
                {draft.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-[15px]">
                    <Logo id={d.id} size={28} />
                    <span className="flex-1">{d.name}</span>
                    <span className="font-medium tabular-nums">{d.pct}%</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-cloud px-3 py-2.5 text-[13px] font-medium">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#05a800] text-[11px] text-white">✓</span>
                Private and verified
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {checks.map((c) => (
              <div key={c.title} className="rounded-2xl bg-cloud p-6">
                <h3 className="text-[19px] font-medium tracking-[var(--tracking-snug)]">{c.title}</h3>
                <p className="mt-1.5 text-[16px] leading-[1.45] text-black/60">{c.text}</p>
              </div>
            ))}
            <p className="px-1 text-[14px] leading-[1.5] text-black/50">
              The AI only suggests. It can&apos;t touch your money: your vault&apos;s rules decide every trade, the same as always.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── FAQ ─────────────── */

function Faq() {
  const qs = [
    {
      q: "What is Kite, in one sentence?",
      a: "A vault of your own on NEAR that holds crypto, gold and dollars, and keeps them in the mix you chose.",
    },
    {
      q: "Do you hold my money?",
      a: "No. Your money sits in your own vault on NEAR. Only you can withdraw from it; Kite can only rearrange what's inside.",
    },
    {
      q: "How do I get my money out?",
      a: "You withdraw it yourself, any time, to any wallet. Kite isn't part of that step at all.",
    },
    {
      q: "What does NEAR do here?",
      a: "NEAR Intents lets one account hold Bitcoin, Ethereum, digital dollars and gold together, and swap between them at the best price it can find. The rules Kite has to follow are written into a contract on NEAR that anyone can read. NEAR AI Cloud runs the private plan drafts.",
    },
    {
      q: "Can a DAO use Kite?",
      a: "Yes. A SputnikDAO on NEAR creates its own vault with one vote, and owns it from the start. Moving money in, changing the mix and taking money out are all votes; Kite only rebalances inside the limits the DAO set. Before members approve an invest vote, Kite's page checks every swap with NEAR Intents.",
    },
    {
      q: "Does my money earn anything?",
      a: "It can. Dollars, NEAR, Ethereum and Solana each have a version that earns, from lending or staking, while keeping the same ups and downs. You choose which ones, and Kite shows today's rate and what it costs to switch.",
    },
    {
      q: "Who sees what I tell the AI?",
      a: "They are encrypted in your browser and can only be opened inside NEAR AI Cloud's sealed hardware. Kite's server just passes the locked message along, though it does see that a request was made and how big it was. The AI only drafts a plan; you decide.",
    },
    {
      q: "Can I use it where I live?",
      a: "Crypto and gold, almost anywhere. Stocks are coming soon through Ondo, which doesn't serve the US and limits some other countries; Kite will show what's available to you.",
    },
  ];
  return (
    <section id="faq" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto grid max-w-[1320px] gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
        <SectionTitle title="Questions, answered simply" />
        <div className="divide-y divide-line border-y border-line">
          {qs.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[19px] font-medium tracking-[var(--tracking-snug)] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cloud text-[18px] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[60ch] text-[17px] leading-[1.5] text-black/60">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Close ─────────────── */

function Closing() {
  return (
    <section id="start" className="scroll-mt-24 px-5 pb-16 sm:px-10">
      <div className="relative mx-auto max-w-[1320px] overflow-hidden rounded-2xl bg-cloud">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(https://images.unsplash.com/photo-1753114767610-75bc913c8423?auto=format&fit=crop&q=80&w=1600)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-white/85 via-white/50 to-transparent" />
        <div className="relative flex min-h-[380px] flex-col justify-center p-8 sm:p-14">
          <h2 className="max-w-[16ch] text-[40px] leading-[1] font-medium tracking-[var(--tracking-display)] sm:text-[60px]">
            Set it up once. Kite handles the rest.
          </h2>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href="/console" className="rounded-lg bg-black px-6 py-3 text-[16px] font-medium text-white hover:bg-black/80">
              Get started
            </a>
            <a href="/console?preview=1" className="text-[15px] font-medium underline underline-offset-4 hover:text-black/70">
              Try the preview
            </a>
            <span className="text-[15px] text-black/70">Connect a NEAR wallet. Start with about $25 (smaller vaults can&apos;t make the $1 minimum trade), plus a 2.6 NEAR vault deposit you get back when you close it.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-5 pb-12 sm:px-10">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4 border-t border-line pt-8 text-[14px] text-haze sm:flex-row sm:items-start sm:justify-between">
        <Wordmark className="text-[24px] text-black" />
        <p className="max-w-[62ch] sm:text-right">
          Built at NEAR HACKATHON 2026.
        </p>
      </div>
    </footer>
  );
}

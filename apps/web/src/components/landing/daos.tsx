import { Donut, MixBar } from "@/components/charts";
import { Logo, logoName } from "@/components/logo";
import { slice } from "@/lib/mix";

const OK = "#12A150";

const TREASURY = [slice("usdc", 40), slice("btc", 25), slice("eth", 20), slice("xaut", 15)];
/** The invest vote spends USDC on the rest of the plan, in proportion: 3,000 USDC split 25:20:15. */
const INVEST = [
  { s: slice("btc", 42), usdc: 1250 },
  { s: slice("eth", 33), usdc: 1000 },
  { s: slice("xaut", 25), usdc: 750 },
];

/** Kite for DAOs: the vault is owned by the DAO, every owner action is a vote, Kite only rebalances. */
export function Daos() {
  const steps = [
    {
      title: "One vote creates the vault",
      text: "Pick the mix and Kite's limits, then file one proposal. When it passes, the DAO owns a new vault from its first block. Nobody else ever holds a key to it.",
    },
    {
      title: "Votes move money in",
      text: "One proposal moves USDC from the treasury into the vault, another invests it. Before anyone can approve, the page checks every swap with NEAR Intents: it must pay back to the vault, buy only what's in the plan, and stay under 2% slippage.",
    },
    {
      title: "Kite keeps it balanced",
      text: "Every hour Kite checks the vault and trades it back to its mix, inside the limits the DAO voted for. Changing the mix, pausing Kite or taking money out is always another vote.",
    },
  ];
  return (
    <section id="daos" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto max-w-[1320px]">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            <h2 className="text-[38px] leading-[1] font-medium tracking-[var(--tracking-display)] sm:text-[56px]">
              A treasury that stays on plan, and still answers to the vote.
            </h2>
            <p className="mt-4 max-w-[46ch] text-[18px] leading-[1.45] text-black/60 sm:text-[20px]">
              A DAO on NEAR can own a Kite vault the same way a person does. The members decide what it holds; Kite does the routine trading they&apos;d
              otherwise argue about.
            </p>

            <ol className="mt-10 space-y-6">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cloud text-[15px] font-semibold">{i + 1}</span>
                  <div>
                    <h3 className="text-[20px] font-medium tracking-[var(--tracking-snug)]">{s.title}</h3>
                    <p className="mt-1 max-w-[52ch] text-[16px] leading-[1.45] text-black/60">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a href="/console/dao" className="rounded-lg bg-black px-5 py-3 text-[16px] font-medium text-white hover:bg-black/80">
                Set one up for your DAO
              </a>
              <span className="max-w-[40ch] text-[14px] leading-[1.4] text-black/50">
                Works with SputnikDAO, the contract behind most DAOs on NEAR. The vault costs 2.6 NEAR from the treasury, returned when it closes.
              </span>
            </div>
          </div>

          <ProposalPreview />
        </div>
      </div>
    </section>
  );
}

/** Two proposals as a DAO member would see them: the vote that created the vault, and an invest vote with its swaps checked. */
function ProposalPreview() {
  return (
    <div className="flex flex-col justify-center rounded-2xl bg-cloud p-4 sm:p-8">
      <div className="rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] sm:p-6">
        <div className="flex items-center justify-between gap-3 text-[13px] text-black/45">
          <span className="truncate">Proposal 14, yourdao.sputnik-dao.near</span>
          <Status label="Vault created" />
        </div>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[22px] leading-tight font-medium tracking-[var(--tracking-snug)]">Create a Kite vault</h3>
            <p className="mt-1 text-[14px] text-black/55">Rebalance when anything drifts 5% from its share.</p>
          </div>
          <Donut slices={TREASURY} size={72} />
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {TREASURY.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-[14px]">
              <Logo id={s.id} size={20} />
              {logoName(s.id)}
              <span className="ml-auto text-black/50 tabular-nums">{s.weight}%</span>
            </li>
          ))}
        </ul>
        <Votes yes={4} no={1} of={5} />
      </div>

      <div className="mt-3 rounded-xl bg-white p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] sm:p-6">
        <div className="flex items-center justify-between gap-3 text-[13px] text-black/45">
          <span>Proposal 15</span>
          <span>Voting, 2 days left</span>
        </div>
        <h3 className="mt-3 text-[20px] leading-tight font-medium tracking-[var(--tracking-snug)]">Invest 3,000 USDC in the plan</h3>
        <MixBar slices={INVEST.map((i) => i.s)} className="mt-3 h-1.5" />
        <ul className="mt-4 space-y-2">
          {INVEST.map(({ s, usdc }) => (
            <li key={s.id} className="flex items-center gap-2 text-[14px]">
              <Check />
              <span className="tabular-nums">{usdc.toLocaleString("en-US")} USDC</span>
              <span className="text-black/40">to</span>
              <Logo id={s.id} size={18} />
              {logoName(s.id)}
              <span className="ml-auto hidden text-[13px] text-black/45 sm:inline">pays back to the vault</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-lg bg-cloud px-3 py-2.5 text-[13px] leading-[1.4]">
          <span className="font-medium">All 3 swaps checked with NEAR Intents.</span> <span className="text-black/55">Approve is offered only after this check passes.</span>
        </p>
      </div>
    </div>
  );
}

function Status({ label }: { label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-medium text-black">
      <span className="h-2 w-2 rounded-full" style={{ background: OK }} />
      {label}
    </span>
  );
}

function Check() {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: `${OK}1A` }} aria-label="Checked">
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
        <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke={OK} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Votes({ yes, no, of }: { yes: number; no: number; of: number }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex justify-between text-[13px]">
        <span>
          <span className="font-medium">{yes} approved</span> <span className="text-black/45">and {no} rejected</span>
        </span>
        <span className="text-black/45">{of} members</span>
      </div>
      <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div style={{ width: `${(yes / of) * 100}%`, background: OK }} />
        <div style={{ width: `${(no / of) * 100}%` }} className="bg-black/20" />
      </div>
    </div>
  );
}

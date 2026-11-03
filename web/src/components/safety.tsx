import { Logo, type LogoId } from "./logo";

const INK = "#0B0B0F";
const NO = "#E5484D";
const OK = "#12A150";

// Diagram is drawn in a 560×440 box; logos sit on top as HTML, placed in the same units.
const W = 560;
const H = 440;
const TOKENS: { id: LogoId; x: number; y: number }[] = [
  { id: "btc", x: 120, y: 160 },
  { id: "xaut", x: 300, y: 160 },
  { id: "eth", x: 210, y: 300 },
];

export function Safety() {
  const rules = [
    { ok: true, title: "Swap inside your plan", text: "Trade one thing you picked for another, at the sizes you set." },
    { ok: false, title: "Move money out", text: "Not to anyone, and not to us. Only you can withdraw." },
    { ok: false, title: "Buy something new", text: "Anything outside your plan is refused by the contract." },
    { ok: false, title: "Trade past your limits", text: "How often and how much are capped, and you set the caps." },
  ];
  return (
    <section id="safety" className="scroll-mt-24 px-5 pb-20 sm:px-10 sm:pb-28">
      <div className="mx-auto grid max-w-[1320px] gap-10 rounded-2xl bg-cloud p-6 sm:p-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:p-14">
        <div className="flex flex-col">
          <h2 className="text-[38px] leading-[1] font-medium tracking-[var(--tracking-display)] sm:text-[52px]">
            Your money never leaves your account.
          </h2>
          <p className="mt-5 max-w-[46ch] text-[18px] leading-[1.45] text-black/60">
            Kite gets a key that opens one door: swapping inside your plan. It can&apos;t take
            anything out, and you can switch it off any time.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {rules.map((r) => (
              <li key={r.title} className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-2.5">
                  <RuleMark ok={r.ok} />
                  <span className="text-[13px] font-medium text-black/45">{r.ok ? "Kite can" : "Kite can't"}</span>
                </div>
                <h3 className="mt-3 text-[17px] font-medium tracking-[var(--tracking-snug)]">{r.title}</h3>
                <p className="mt-1 text-[14px] leading-[1.4] text-black/55">{r.text}</p>
              </li>
            ))}
          </ul>

          <p className="mt-6 flex items-start gap-2.5 text-[14px] leading-[1.45] text-black/50">
            <Logo id="near" size={20} className="mt-px" />
            These limits live in a public contract on NEAR, not on our servers, so anyone can check them.
          </p>
        </div>

        <AccountDiagram />
      </div>
    </section>
  );
}

function RuleMark({ ok }: { ok: boolean }) {
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-full"
      style={{ background: ok ? `${OK}1A` : `${NO}14` }}
      aria-label={ok ? "Allowed" : "Not allowed"}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        {ok ? (
          <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke={OK} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M3 3l6 6M9 3l-6 6" stroke={NO} strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}

/** Your account as a walled box: swaps loop inside, every path out is blocked except yours. */
function AccountDiagram() {
  return (
    <div className="relative self-center rounded-2xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] sm:p-5">
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img"
          aria-label="Inside your account Kite can swap Bitcoin, Ethereum and gold. Paths to anyone else, including Kite, are blocked. Only you can withdraw.">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1L9 5L0 9z" fill={INK} />
            </marker>
            <marker id="arr-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 1L9 5L0 9z" fill={OK} />
            </marker>
          </defs>

          {/* the account */}
          <rect x="24" y="48" width="380" height="320" rx="26" fill="#F5F7FA" stroke={INK} strokeWidth="2" />
          <g transform="translate(46 70)">
            <rect x="0" y="6" width="14" height="11" rx="2.5" fill={INK} />
            <path d="M3 6.5V4a4 4 0 0 1 8 0v2.5" fill="none" stroke={INK} strokeWidth="1.8" />
            <text x="22" y="16" fontSize="15" fontWeight="600" fill={INK}>Your account</text>
          </g>

          {/* swaps between the three holdings */}
          <path d="M150 140 C 190 112, 230 112, 270 140" fill="none" stroke={INK} strokeWidth="1.6" markerStart="url(#arr)" markerEnd="url(#arr)" />
          <path d="M108 194 C 118 240, 150 276, 180 290" fill="none" stroke={INK} strokeWidth="1.6" markerStart="url(#arr)" markerEnd="url(#arr)" />
          <path d="M312 194 C 302 240, 270 276, 240 290" fill="none" stroke={INK} strokeWidth="1.6" markerStart="url(#arr)" markerEnd="url(#arr)" />

          {/* Kite's key, in the middle */}
          <g transform="translate(210 218)">
            <rect x="-76" y="-17" width="152" height="34" rx="17" fill={INK} />
            <circle cx="-56" cy="0" r="6" fill="none" stroke="#FFB020" strokeWidth="2" />
            <path d="M-50 0 h14 M-40 0 v5 M-36 0 v4" stroke="#FFB020" strokeWidth="2" strokeLinecap="round" />
            <text x="14" y="5" fontSize="13" fontWeight="600" fill="#fff" textAnchor="middle">Kite: swap only</text>
          </g>

          {/* blocked paths out */}
          {[
            { y: 150, label: "Someone else" },
            { y: 270, label: "Kite itself" },
          ].map((d) => (
            <g key={d.label}>
              <path d={`M350 ${d.y} H392`} stroke={INK} strokeWidth="1.6" strokeDasharray="4 4" />
              <path d={`M416 ${d.y} H468`} stroke={INK} strokeOpacity="0.25" strokeWidth="1.6" strokeDasharray="4 4" markerEnd="url(#arr)" />
              <circle cx="404" cy={d.y} r="13" fill="#fff" stroke={NO} strokeWidth="2" />
              <path d={`M398 ${d.y - 6}l12 12M410 ${d.y - 6}l-12 12`} stroke={NO} strokeWidth="2" strokeLinecap="round" />
              <circle cx="500" cy={d.y - 6} r="9" fill="none" stroke="#9AA0A8" strokeWidth="1.8" />
              <path d={`M484 ${d.y + 18} a16 13 0 0 1 32 0`} fill="none" stroke="#9AA0A8" strokeWidth="1.8" />
              <text x="500" y={d.y + 40} fontSize="12" fill="#6B7078" textAnchor="middle">{d.label}</text>
            </g>
          ))}

          {/* the only way out is yours */}
          <path d="M214 368 V404" stroke={OK} strokeWidth="2" markerEnd="url(#arr-ok)" />
          <g transform="translate(232 414)">
            <circle cx="0" cy="-6" r="9" fill={OK} />
            <path d="M-4 -6l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text x="16" y="-1" fontSize="13" fontWeight="600" fill={INK}>Withdraw: only you</text>
          </g>
        </svg>

        {TOKENS.map((t) => (
          <div
            key={t.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.25)]"
            style={{ left: `${(t.x / W) * 100}%`, top: `${(t.y / H) * 100}%`, width: "13%" }}
          >
            <Logo id={t.id} size={64} className="!h-auto !w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

import Image from "next/image";

import type { LogoId } from "@/lib/assets";


const NAMES: Record<LogoId, string> = {
  btc: "Bitcoin",
  eth: "Ethereum",
  sol: "Solana",
  near: "NEAR",
  usdc: "USDC",
  xaut: "Tether Gold",
  base: "Base",
  arbitrum: "Arbitrum",
  stnear: "Staked NEAR",
  wsteth: "Staked ETH",
  gtusdc: "Earning USDC",
  ksol: "Earning SOL",
  xrp: "XRP",
  doge: "Dogecoin",
  ada: "Cardano",
  trx: "TRON",
  link: "Chainlink",
  ltc: "Litecoin",
  sui: "Sui",
  zec: "Zcash",
  bch: "Bitcoin Cash",
  aave: "Aave",
  uni: "Uniswap",
  usdt: "Tether USD",
};

/** Earning versions wear their base asset's mark with a small badge. */
const EARN_BASE: Partial<Record<LogoId, LogoId>> = { stnear: "near", wsteth: "eth", gtusdc: "usdc", ksol: "sol" };

/** Brand logo as a disc. Token and network marks ship as full-bleed squares. */
export function Logo({
  id,
  size = 28,
  className = "",
}: {
  id: LogoId;
  size?: number;
  className?: string;
}) {
  const base = EARN_BASE[id];
  if (base) {
    const b = Math.max(10, Math.round(size * 0.42));
    return (
      <span className={`relative inline-block shrink-0 rounded-full ${className}`} style={{ width: size, height: size }} title={NAMES[id]}>
        <Image src={`/logos/${base}.svg`} alt={NAMES[id]} width={size} height={size} unoptimized className="rounded-full" style={{ width: size, height: size }} />
        <span
          className="absolute -right-[2px] -bottom-[2px] grid place-items-center rounded-full bg-[#05a800] text-white ring-2 ring-white"
          style={{ width: b, height: b }}
          aria-hidden
        >
          <svg viewBox="0 0 12 12" width={b * 0.62} height={b * 0.62} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.5 6 4.5l3 3" />
          </svg>
        </span>
      </span>
    );
  }
  return (
    <Image
      src={`/logos/${id}.svg`}
      alt={NAMES[id]}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export const logoName = (id: LogoId) => NAMES[id];

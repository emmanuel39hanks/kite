import type { LogoId } from "@/lib/assets";

export type Slice = { id: LogoId; weight: number; color: string };

const COLORS: Partial<Record<LogoId, string>> = {
  btc: "#F7931A",
  eth: "#627EEA",
  sol: "#9945FF",
  near: "#00C08B",
  xaut: "#D4A537",
  usdc: "#2775CA",
  nvidia: "#76B900",
  apple: "#8E8E93",
  tesla: "#CC0000",
  stnear: "#00C08B",
  wsteth: "#627EEA",
  gtusdc: "#2775CA",
  ksol: "#9945FF",
  xrp: "#23292F",
  doge: "#C2A633",
  ada: "#246DD3",
  trx: "#C4342B",
  link: "#2E61DE",
  ltc: "#345D9D",
  sui: "#4BA2FF",
  zec: "#ECB244",
  bch: "#58BE92",
  aave: "#9391F7",
  uni: "#FF0A6F",
  usdt: "#009393",
};

export const slice = (id: LogoId, weight: number): Slice => ({ id, weight, color: COLORS[id] ?? "#999" });

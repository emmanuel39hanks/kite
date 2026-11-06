export type LogoId =
  | "btc"
  | "eth"
  | "sol"
  | "near"
  | "usdc"
  | "xaut"
  | "base"
  | "arbitrum"
  | "nvidia"
  | "apple"
  | "tesla"
  | "stnear"
  | "wsteth"
  | "gtusdc"
  | "ksol"
  | "xrp"
  | "doge"
  | "ada"
  | "trx"
  | "link"
  | "ltc"
  | "sui"
  | "zec"
  | "bch"
  | "aave"
  | "uni"
  | "usdt";

type AssetKind = "Crypto" | "Stock" | "Gold" | "Digital dollar";

export type Asset = {
  id: LogoId;
  name: string;
  ticker: string;
  kind: AssetKind;
  color: string;
  /** NEAR Intents token id, as listed by 1Click /v0/tokens. Null while not routable. */
  intentsId: string | null;
  decimals: number;
  /** Routable through NEAR Intents today (checked against /v0/tokens on 2026-11-02). */
  live: boolean;
  /** Fallback price in USD, used until the live feed loads. */
  price: number;
  /** Fallback 24h change, percent. */
  change: number;
  /** Daily volatility used by the simulated charts. */
  vol: number;
  /** Stocks come from Ondo, so country limits will apply. */
  ondo?: boolean;
  blurb: string;
  /** A yield-earning version of another asset: same exposure, plus a yield. */
  earn?: { base: LogoId; issuer: string; how: string; url: string };
  /** A looser price limit for this asset (bps), because it costs more to trade. Stored per asset in the vault. */
  slippageBps?: number;
};

export type EarnId = "stnear" | "wsteth" | "gtusdc" | "ksol";

export const ASSETS: Asset[] = [
  { id: "btc", name: "Bitcoin", ticker: "BTC", kind: "Crypto", color: "#F7931A", intentsId: "nep141:nbtc.bridge.near", decimals: 8, live: true, price: 76917, change: 0, vol: 0.03, blurb: "The largest coin. Held as nBTC on NEAR, withdrawable to real Bitcoin." },
  { id: "eth", name: "Ethereum", ticker: "ETH", kind: "Crypto", color: "#627EEA", intentsId: "nep141:eth.omft.near", decimals: 18, live: true, price: 2249.4, change: 0, vol: 0.038, blurb: "The network most apps run on." },
  { id: "sol", name: "Solana", ticker: "SOL", kind: "Crypto", color: "#9945FF", intentsId: "nep141:sol.omft.near", decimals: 9, live: true, price: 91.78, change: 0, vol: 0.05, blurb: "Fast, cheap, popular for trading." },
  { id: "near", name: "NEAR", ticker: "NEAR", kind: "Crypto", color: "#00C08B", intentsId: "nep141:wrap.near", decimals: 24, live: true, price: 3.9, change: 0, vol: 0.05, blurb: "The network Kite runs on." },
  { id: "xaut", name: "Tether Gold", ticker: "XAUt", kind: "Gold", color: "#D4A537", intentsId: "nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near", decimals: 6, live: true, price: 3939.95, change: 0, vol: 0.008, blurb: "Each token is backed by one ounce of gold." },
  { id: "usdc", name: "USDC", ticker: "USDC", kind: "Digital dollar", color: "#2775CA", intentsId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6, live: true, price: 1, change: 0, vol: 0, blurb: "Always worth one dollar." },
  // Yield-earning versions. Same price exposure as the base asset, plus a yield; all routable through NEAR Intents 1Click.
  { id: "xrp", name: "XRP", ticker: "XRP", kind: "Crypto", color: "#23292F", intentsId: "nep141:xrp.omft.near", decimals: 6, live: true, price: 1.19, change: 0, vol: 0.045, blurb: "Built for fast payments across borders." },
  { id: "doge", name: "Dogecoin", ticker: "DOGE", kind: "Crypto", color: "#C2A633", intentsId: "nep141:doge.omft.near", decimals: 8, live: true, price: 0.0722, change: 0, vol: 0.05, blurb: "The original meme coin. Swings hard both ways." },
  { id: "ada", name: "Cardano", ticker: "ADA", kind: "Crypto", color: "#246DD3", intentsId: "nep141:cardano.omft.near", decimals: 6, live: true, price: 0.1857, change: 0, vol: 0.045, blurb: "A network built step by step from academic research." },
  { id: "trx", name: "TRON", ticker: "TRX", kind: "Crypto", color: "#C4342B", intentsId: "nep141:tron.omft.near", decimals: 6, live: true, price: 0.3179, change: 0, vol: 0.03, blurb: "Carries a large share of the world's digital-dollar payments." },
  { id: "link", name: "Chainlink", ticker: "LINK", kind: "Crypto", color: "#2E61DE", intentsId: "nep141:eth-0x514910771af9ca656af840dff83e8264ecf986ca.omft.near", decimals: 18, live: true, price: 10.89, change: 0, vol: 0.045, blurb: "Feeds real-world prices and data into blockchains." },
  { id: "ltc", name: "Litecoin", ticker: "LTC", kind: "Crypto", color: "#345D9D", intentsId: "nep141:ltc.omft.near", decimals: 8, live: true, price: 52.67, change: 0, vol: 0.04, blurb: "One of the oldest coins, a lighter cousin of Bitcoin." },
  { id: "sui", name: "Sui", ticker: "SUI", kind: "Crypto", color: "#4BA2FF", intentsId: "nep141:sui.omft.near", decimals: 9, live: true, price: 0.8653, change: 0, vol: 0.055, blurb: "A newer, fast network for apps and games." },
  { id: "zec", name: "Zcash", ticker: "ZEC", kind: "Crypto", color: "#ECB244", intentsId: "nep141:zec.omft.near", decimals: 8, live: true, price: 1310.1, change: 0, vol: 0.06, blurb: "A coin with optional private payments." },
  { id: "bch", name: "Bitcoin Cash", ticker: "BCH", kind: "Crypto", color: "#58BE92", intentsId: "nep141:bch.omft.near", decimals: 8, live: true, price: 266.52, change: 0, vol: 0.04, blurb: "A Bitcoin offshoot built for cheaper payments." },
  { id: "aave", name: "Aave", ticker: "AAVE", kind: "Crypto", color: "#9391F7", intentsId: "nep141:eth-0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9.omft.near", decimals: 18, live: true, price: 130.79, change: 0, vol: 0.05, blurb: "The token behind Aave, the largest crypto lending app." },
  { id: "uni", name: "Uniswap", ticker: "UNI", kind: "Crypto", color: "#FF0A6F", intentsId: "nep141:eth-0x1f9840a85d5af5bf1d1762f925bdaddc4201f984.omft.near", decimals: 18, live: true, price: 6.94, change: 0, vol: 0.05, blurb: "The token behind Uniswap, the largest trading app on Ethereum." },
  { id: "usdt", name: "Tether USD", ticker: "USDT", kind: "Digital dollar", color: "#009393", intentsId: "nep141:usdt.tether-token.near", decimals: 6, live: true, price: 1, change: 0, vol: 0, blurb: "The most widely used digital dollar." },
  { id: "stnear", name: "Staked NEAR", ticker: "stNEAR", kind: "Crypto", color: "#00C08B", intentsId: "nep141:meta-pool.near", decimals: 24, live: true, price: 5.81, change: 0, vol: 0.05, blurb: "NEAR staked with Meta Pool. Earns staking rewards, sells back any time.", earn: { base: "near", issuer: "Meta Pool", how: "staking rewards from NEAR validators", url: "https://metapool.app" }, slippageBps: 200 },
  { id: "wsteth", name: "Staked ETH", ticker: "wstETH", kind: "Crypto", color: "#627EEA", intentsId: "nep141:eth-0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0.omft.near", decimals: 18, live: true, price: 2804, change: 0, vol: 0.038, blurb: "ETH staked with Lido. Earns Ethereum staking rewards.", earn: { base: "eth", issuer: "Lido", how: "Ethereum staking rewards", url: "https://lido.fi" }, slippageBps: 200 },
  { id: "gtusdc", name: "Earning USDC", ticker: "gtUSDCp", kind: "Digital dollar", color: "#2775CA", intentsId: "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near", decimals: 18, live: true, price: 0.0000011162, change: 0, vol: 0, blurb: "USDC lent out through Gauntlet USDC Prime on Morpho. Earns interest from borrowers.", earn: { base: "usdc", issuer: "Gauntlet on Morpho", how: "interest from Morpho borrowers", url: "https://app.morpho.org/base/vault/0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61" }, slippageBps: 200 },
  { id: "ksol", name: "Earning SOL", ticker: "kV-gtSOLb", kind: "Crypto", color: "#9945FF", intentsId: "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near", decimals: 9, live: true, price: 96.96, change: 0, vol: 0.05, blurb: "SOL lent out through a Kamino vault curated by Gauntlet. Earns interest.", earn: { base: "sol", issuer: "Kamino (Gauntlet)", how: "interest from Kamino borrowers", url: "https://app.kamino.finance" }, slippageBps: 200 },
  { id: "nvidia", name: "Nvidia", ticker: "NVDAon", kind: "Stock", color: "#76B900", intentsId: null, decimals: 18, live: false, price: 206.74, change: 0, vol: 0.025, ondo: true, blurb: "Makes the chips AI runs on." },
  { id: "apple", name: "Apple", ticker: "AAPLon", kind: "Stock", color: "#8E8E93", intentsId: null, decimals: 18, live: false, price: 338.16, change: 0, vol: 0.015, ondo: true, blurb: "Phones, laptops, steady earnings." },
  { id: "tesla", name: "Tesla", ticker: "TSLAon", kind: "Stock", color: "#CC0000", intentsId: null, decimals: 18, live: false, price: 441.3, change: 0, vol: 0.035, ondo: true, blurb: "Electric cars and batteries." },
];

export const assetById = (id: LogoId) => {
  const a = ASSETS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown asset ${id}`);
  return a;
};

export const assetByIntentsId = (intentsId: string) => ASSETS.find((x) => x.intentsId === intentsId);

/** The earning version of an asset, if there is one. */
export const earnVersionOf = (id: LogoId) => ASSETS.find((a) => a.earn?.base === id);
/** What an asset tracks: itself, or the base of an earning version. */
export const baseOf = (id: LogoId): LogoId => ASSETS.find((a) => a.id === id)?.earn?.base ?? id;

export const usd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Token amounts for people: compact when huge (gtUSDCp has tiny units), more decimals when small. */
export const units = (n: number) =>
  n >= 1e6 ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 });

/** A unit price for people. Tokens worth fractions of a cent (gtUSDCp) are shown per million. */
export const price = (p: number, digits?: number) => (p > 0 && p < 0.01 ? `${usd(p * 1e6)} per 1M` : usd(p, digits ?? (p < 10 ? 3 : 2)));


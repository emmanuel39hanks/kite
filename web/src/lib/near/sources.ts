/** Where a deposit can come from, and the 1Click asset id for it. */
export const SOURCES: Record<string, { asset: string; decimals: number }> = {
  "usdc-base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6 },
  "usdc-arb": { asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6 },
  "usdc-sol": { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6 },
  eth: { asset: "nep141:eth.omft.near", decimals: 18 },
  btc: { asset: "nep141:btc.omft.near", decimals: 8 },
  sol: { asset: "nep141:sol.omft.near", decimals: 9 },
};

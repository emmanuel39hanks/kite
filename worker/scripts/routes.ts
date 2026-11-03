/** Re-checks plan/tasks/00: every MVP asset is listed and quotes against USDC. */
import { quote, tokens } from "../src/oneclick.js";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ASSETS: Record<string, string> = {
  Bitcoin: "nep141:nbtc.bridge.near",
  Ethereum: "nep141:eth.omft.near",
  Solana: "nep141:sol.omft.near",
  NEAR: "nep141:wrap.near",
  "Tether Gold": "nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near",
};

const list = await tokens();
console.log(`1Click lists ${list.length} tokens.`);
for (const [name, id] of Object.entries(ASSETS)) {
  const t = list.find((x) => x.assetId === id);
  let line = `${name.padEnd(12)} ${t ? `listed  $${t.price}` : "NOT LISTED"}`;
  try {
    const q = await quote({ dry: true, originAsset: USDC, destinationAsset: id, amount: "100000000", account: "kite-routes-check.near", slippageBps: 100, deadlineSecs: 1800 });
    const cost = (1 - Number(q.amountOutUsd) / Number(q.amountInUsd)) * 100;
    line += `   $100 USDC → ${q.amountOutUsd} USD (${cost.toFixed(2)}% cost, ~${q.timeEstimate}s)`;
  } catch (e) {
    line += `   quote failed: ${e instanceof Error ? e.message : e}`;
  }
  console.log(line);
}

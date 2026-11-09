import { runOnce } from "./run.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const vault = opt("vault") ?? process.env.KITE_VAULT;
if (!vault) {
  console.error("Usage: npm run keeper -- --vault <name>.kitevaults.near [--dry]");
  process.exit(1);
}

// Without the keeper key nothing can be sent, so run dry rather than fetch a live quote and then fail.
const dry = flag("dry") || !process.env.KITE_AGENT_KEY;
if (dry && !flag("dry")) console.log("KITE_AGENT_KEY is not set: running dry (reads and a dry 1Click quote only; nothing is sent).");

runOnce({ vault, dry })
  .then((r) => console.log(JSON.stringify({ result: r.action }, null, 0)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

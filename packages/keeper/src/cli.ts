import { runOnce } from "./run.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const vault = opt("vault") ?? process.env.KITE_VAULT;
if (!vault) {
  console.error("Usage: npm run keeper -- --vault kite.<you>.near [--dry]");
  process.exit(1);
}

runOnce({ vault, dry: flag("dry") })
  .then((r) => console.log(JSON.stringify({ result: r.action }, null, 0)))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

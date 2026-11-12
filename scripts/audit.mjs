#!/usr/bin/env node
// Dependency advisories, production dependencies only. Fails on any critical advisory, and on any high one
// that is not listed below with its reason. Run from the repo root after `npm ci`: node scripts/audit.mjs
import { spawnSync } from "node:child_process";

// One chain, all inside the Meteor wallet adapter: @near-wallet-selector/meteor-wallet -> @meteorwallet/sdk,
// which pins nanoid 5.1.5 and query-string 7 (decode-uri-component 0.2). The fix npm offers is the adapter's
// 9.3.0, a major version back. The patched decode-uri-component is ESM-only and query-string 7 loads it with
// require, so forcing it would break the adapter. This code runs in the browser, in the wallet's own pop-up flow.
const KNOWN = new Set(["@near-wallet-selector/meteor-wallet", "@meteorwallet/sdk", "nanoid", "query-string", "decode-uri-component"]);

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("npm audit gave no JSON:", (run.stderr || run.stdout).slice(0, 400));
  process.exit(1);
}
if (!report.vulnerabilities) {
  console.error("npm audit failed:", JSON.stringify(report.error ?? report).slice(0, 400));
  process.exit(1);
}

const serious = Object.values(report.vulnerabilities).filter((v) => v.severity === "high" || v.severity === "critical");
const fresh = serious.filter((v) => v.severity === "critical" || !KNOWN.has(v.name));
for (const v of serious) console.log(`${fresh.includes(v) ? "FAIL " : "KNOWN"} ${v.severity} ${v.name}  ${v.nodes.join(", ")}`);
const count = report.metadata?.vulnerabilities ?? {};
console.log(`\nAll advisories: ${count.critical ?? 0} critical, ${count.high ?? 0} high, ${count.moderate ?? 0} moderate, ${count.low ?? 0} low.`);
if (fresh.length > 0) {
  console.error(`${fresh.length} high or critical advisory outside the known list.`);
  process.exit(1);
}
console.log(`PASS: no critical advisory, and every high one (${serious.length}) is in the Meteor wallet adapter's SDK.`);

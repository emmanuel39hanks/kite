#!/usr/bin/env node
/**
 * Checks Kite's main claims against the files in this repository and against NEAR mainnet.
 *
 *   node scripts/verify.mjs             # everything it can reach
 *   node scripts/verify.mjs --offline   # only the checks that need no network
 *   node scripts/verify.mjs --strict    # a check that couldn't reach the network counts as a failure
 *
 * Read-only: no keys, no wallet, no funds, no transactions, no files written. It needs only Node (built-ins
 * only, so it runs before `npm ci`). Network checks are JSON-RPC reads against public NEAR servers.
 *
 * Each line is PASS, FAIL or SKIP. SKIP means the network could not be reached, never that an answer was
 * wrong: a wrong answer is always FAIL. The exit code is 1 only if something failed.
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const offline = process.argv.includes("--offline");
const strict = process.argv.includes("--strict");

const FACTORY = "kitevaults.near";
const RPCS = ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org", "https://near.drpc.org"];
// Ordinary servers forget transactions after a few days; archival ones keep them all.
const ARCHIVAL = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];

/** Mainnet transactions the README cites: who signed, and how it must have ended. */
const TXS = [
  { what: "factory deployed", hash: "4WX2i7p4oAx86AmkrEX5QNX8xJ89nY2y2MqWYgsFn4hJ", signer: "kitevaults.near", ok: true },
  { what: "factory's only key deleted", hash: "JrAZuKDyaTppVTjjG3eVBCUJw1yFmPDS6g9MfGASTAm", signer: "kitevaults.near", ok: true },
  { what: "personal vault created", hash: "AV6EWVgcgg4bnRVkaUE5Z3od7a7eKPUWruoFaV7xAV8N", signer: "emmanuelhaanks.near", ok: true },
  { what: "Kite's key rebalanced (signed 1Click quote checked by the vault)", hash: "EWkADR59cwwnYLspLUAmrjbqQaWKFvWSV79oHJfCc8f7", signer: "emmanuelhaanks.kitevaults.near", ok: true },
  { what: "Kite's key settled the swap", hash: "4RbnhSFQSBwueYMagQGfKyxvPNg1dgbMm9EeSYtzGP2n", signer: "emmanuelhaanks.kitevaults.near", ok: true },
  { what: "the hourly keeper rebalanced the live DAO vault, unattended", hash: "Ck1NVbN6R12bpr4r4sppsE2MFXb7fMJ6rvNGUPpkukC", signer: "kite-dao-2.kitevaults.near", ok: true },
  { what: "the same run settled that swap", hash: "7BGF6rfhjbdW9BQmttAqKM3BQjeiuYJaduRxaRDArQBt", signer: "kite-dao-2.kitevaults.near", ok: true },
  { what: "personal vault closed", hash: "7cPBbUvrhn1RA9UF1VQdw5BpPRtHThjdGNRMDnnEgzJM", signer: "emmanuelhaanks.near", ok: true },
  { what: "DAO vault created by vote", hash: "Af3Wqkj4djSeD63wt98MJod3QsyfkqFYNtAZqpy41Wdj", signer: "emmanuelhaanks.near", ok: true },
  { what: "DAO vault closed by vote", hash: "GRoLMGDxAL46PdzUGb4Dk4v7J5L5ZC2W9QTqMcrncDiT", signer: "emmanuelhaanks.near", ok: true },
  { what: "stolen-key attack: quote paying attacker.near", hash: "9vR2bufkfotztJpuP8Rzdm935YkkPBjzPNBL3a6Ri2vR", signer: "emmanuelhaanks-2.kitevaults.near", ok: false, error: "ERR_QUOTE_RECIPIENT" },
  { what: "stolen-key attack: edited quote", hash: "5Q1dQEXK58Jbn3hjteko2sgaMqcrzvJjuSEnDeH5pdcp", signer: "emmanuelhaanks-2.kitevaults.near", ok: false, error: "ERR_QUOTE_SIG" },
];

const tally = { PASS: 0, FAIL: 0, SKIP: 0 };
const say = (state, text, detail = "") => {
  tally[state]++;
  console.log(`${state}  ${text}${detail ? `\n      ${detail}` : ""}`);
};

/* ───────────── helpers ───────────── */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
function b58decode(str) {
  let n = 0n;
  for (const c of str) n = n * 58n + BigInt(B58.indexOf(c));
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0;
  for (const c of str) {
    if (c !== "1") break;
    zeros++;
  }
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

/** Couldn't reach a server (as opposed to: the chain answered, and the answer is an error). */
class Unreachable extends Error {}

async function rpc(method, params, urls = RPCS) {
  let last = "";
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
      if (!r.ok) {
        last = `${new URL(url).host} answered HTTP ${r.status}`;
        continue;
      }
      return await r.json(); // { result } or { error }: both are the chain's answer
    } catch (e) {
      last = `${new URL(url).host}: ${e?.cause?.code ?? e?.name ?? "error"}`;
    }
  }
  throw new Unreachable(last);
}
const query = (params) => rpc("query", { finality: "final", ...params });
async function view(account, method, args = {}) {
  const d = await query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (!d.result?.result) return { error: JSON.stringify(d.error ?? d.result ?? d).slice(0, 400) };
  return { value: JSON.parse(Buffer.from(d.result.result).toString()) };
}

/** Runs one network check. Unreachable → SKIP with the command to re-run; anything thrown otherwise → FAIL. */
async function online(text, fn) {
  if (offline) return;
  try {
    const r = await fn();
    say(r.ok ? "PASS" : "FAIL", text, r.detail);
  } catch (e) {
    if (e instanceof Unreachable) say(strict ? "FAIL" : "SKIP", text, `no route to NEAR RPC (${e.message}). Re-run with network access to ${RPCS.map((u) => new URL(u).host).join(", ")}.`);
    else say("FAIL", text, String(e?.message ?? e).slice(0, 300));
  }
}

/* ───────────── offline checks ───────────── */

console.log("Kite: checking claims. Read-only; no keys, funds or transactions.\n");
console.log("From the files in this repository");

const wasm = (name) => readFileSync(join(root, "apps/web/public/vault", name));
const vaultHash = createHash("sha256").update(wasm("kite_vault.wasm")).digest();
const factoryHash = createHash("sha256").update(wasm("kite_factory.wasm")).digest();
say("PASS", `vault wasm     sha256 ${vaultHash.toString("hex")}`, `as NEAR shows it: ${b58encode(vaultHash)}  (${wasm("kite_vault.wasm").length} bytes)`);
say("PASS", `factory wasm   sha256 ${factoryHash.toString("hex")}`, `as NEAR shows it: ${b58encode(factoryHash)}`);

// The signature scheme the vault checks on chain (contracts/vault/src/lib.rs, verify_quote): ed25519 over
// base58(sha256(the quote JSON)), by 1Click's key. Here it is run on a real 1Click answer, with Node's own crypto.
{
  const f = JSON.parse(readFileSync(join(root, "packages/keeper/test/fixtures/oneclick-signed-quote.json"), "utf8"));
  const pinned = readFileSync(join(root, "contracts/vault/src/lib.rs"), "utf8").match(/ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}/)?.[0];
  const check = (payload) => {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), b58decode(f.signer.replace("ed25519:", ""))]), format: "der", type: "spki" });
    return edVerify(null, Buffer.from(b58encode(createHash("sha256").update(payload).digest())), key, b58decode(f.signature.replace("ed25519:", "")));
  };
  say(pinned === f.signer ? "PASS" : "FAIL", "the key pinned in the vault's source is 1Click's signing key", `${pinned}`);
  say(check(f.payload) ? "PASS" : "FAIL", "a real 1Click quote verifies under that key (the scheme the vault checks on chain)");
  say(!check(f.payload.replace("kite.preview.near", "attacker.near")) ? "PASS" : "FAIL", "the same quote with the payee changed does not verify");
}

/* ───────────── mainnet checks ───────────── */

if (!offline) console.log("\nFrom NEAR mainnet (public RPC reads)");

await online(`${FACTORY} has no access keys (nobody can change or upgrade it)`, async () => {
  const d = await query({ request_type: "view_access_key_list", account_id: FACTORY });
  const keys = d.result?.keys;
  return { ok: Array.isArray(keys) && keys.length === 0, detail: keys ? `keys: ${JSON.stringify(keys)}` : JSON.stringify(d.error).slice(0, 300) };
});

await online(`${FACTORY} runs the factory wasm in this repository`, async () => {
  const d = await query({ request_type: "view_account", account_id: FACTORY });
  return { ok: d.result?.code_hash === b58encode(factoryHash), detail: `on chain ${d.result?.code_hash}, repository ${b58encode(factoryHash)}` };
});

await online("the factory can only create vaults that run the vault wasm in this repository", async () => {
  const c = await view(FACTORY, "get_config");
  return { ok: c.value?.vault_code_hash === b58encode(vaultHash), detail: `get_config.vault_code_hash ${c.value?.vault_code_hash ?? c.error}, repository ${b58encode(vaultHash)}` };
});

let openVaults = [];
await online("every open vault runs that wasm, and no vault has a full-access key", async () => {
  const list = await view(FACTORY, "get_vaults", { from_index: 0, limit: 100 });
  if (!list.value) return { ok: false, detail: list.error };
  const lines = [];
  let ok = true;
  for (const { vault } of list.value) {
    const acct = await query({ request_type: "view_account", account_id: vault });
    if (!acct.result) {
      lines.push(`${vault}: closed (the account no longer exists)`);
      continue;
    }
    const keys = (await query({ request_type: "view_access_key_list", account_id: vault })).result?.keys ?? [];
    const limited = keys.every((k) => {
      const fc = k.access_key?.permission?.FunctionCall;
      return fc && fc.receiver_id === vault && [...fc.method_names].sort().join(",") === "rebalance,settle";
    });
    const status = await view(vault, "get_status");
    const good = acct.result.code_hash === b58encode(vaultHash) && limited;
    ok &&= good;
    openVaults.push(vault);
    lines.push(`${vault}: open, owner ${status.value?.owner}, code ${good ? "matches" : acct.result.code_hash}, keys: ${keys.length ? keys.map(() => "function-call [rebalance, settle] on itself").join("; ") : "none"}${limited ? "" : " ← NOT LIMITED"}`);
  }
  return { ok, detail: `${list.value.length} vaults ever made, ${openVaults.length} open\n      ${lines.join("\n      ")}` };
});

if (!offline && openVaults.length) {
  const f = JSON.parse(readFileSync(join(root, "packages/keeper/test/fixtures/oneclick-signed-quote.json"), "utf8"));
  const target = openVaults[0];
  await online(`${target} refuses a genuine 1Click-signed quote that pays another account`, async () => {
    const r = await view(target, "check_quote", { quote: f.payload, signature: f.signature });
    const refused = r.error?.match(/ERR_[A-Z_]+/)?.[0];
    return { ok: !!refused, detail: refused ? `refused with ${refused}` : `not refused: ${JSON.stringify(r.value ?? r.error).slice(0, 200)}` };
  });
}

for (const t of TXS) {
  await online(`tx ${t.hash.slice(0, 8)}… ${t.what}: ${t.ok ? "succeeded" : `refused with ${t.error}`}`, async () => {
    const d = await rpc("EXPERIMENTAL_tx_status", { tx_hash: t.hash, sender_account_id: t.signer, wait_until: "FINAL" }, ARCHIVAL);
    if (!d.result) return { ok: false, detail: `not found: ${JSON.stringify(d.error).slice(0, 200)}` };
    const all = JSON.stringify([d.result.status, ...(d.result.receipts_outcome ?? []).map((r) => r.outcome?.status)]);
    const failed = all.includes('"Failure"');
    const ok = t.ok ? !failed : failed && all.includes(t.error);
    return { ok, detail: `signer ${t.signer}; full hash ${t.hash}${ok ? "" : `; status ${all.slice(0, 300)}`}` };
  });
}

console.log(`\nPASS ${tally.PASS} · FAIL ${tally.FAIL} · SKIP ${tally.SKIP}${offline ? "  (offline mode: mainnet checks not run)" : ""}`);
process.exit(tally.FAIL ? 1 : 0);

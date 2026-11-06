//! Sandbox tests: the shipped vault wasm (`apps/web/public/vault/kite_vault.wasm`, the exact file the app
//! deploys) running on a local NEAR node, with real access keys, real receipts and real gas. NEAR Intents is
//! replaced by `mock-intents`, a small multi-token ledger with the same `mt_transfer` and
//! `mt_batch_balance_of` methods.
//!
//! Run from the repo root: `npm run test:integration`.

use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, AccessKeyPermission, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, ContractState, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const BTC: &str = "nep141:nbtc.bridge.near";
const XAUT: &str = "nep141:xaut.omft.near";
const USDC: &str = "nep141:usdc.near";
/// What the keeper attaches (packages/keeper/src/near.ts).
const REBALANCE_TGAS: u64 = 200;
const SETTLE_TGAS: u64 = 150;
/// What the app gives Kite's key (apps/web/src/lib/near/config.ts).
const ALLOWANCE: NearToken = NearToken::from_millinear(250);
const DEPOSIT_ADDR: &str = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

fn wasm(path: &str) -> Vec<u8> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}. Run `npm run test:integration` from the repo root.", p.display()))
}

/// Stands in for 1Click's quote-signing key.
fn oneclick() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn pk_string(k: &SigningKey) -> String {
    format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string())
}

struct Env {
    worker: Worker<Sandbox>,
    owner: Account,
    vault: AccountId,
    intents: Contract,
    agent: Account,
    agent_pk: near_workspaces::types::PublicKey,
    wasm: Vec<u8>,
}

/// Same shape as the app's create flow: account, 2.6 NEAR, code, `new`, Kite's function-call key,
/// and then no full-access key at all.
async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let intents_acc = root.create_subaccount("intents").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let intents = intents_acc.deploy(&wasm("../target/near/mock_intents/mock_intents.wasm")).await?.into_result()?;
    intents.call("new").transact().await?.into_result()?;

    let owner = root.create_subaccount("alex").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let vault_acc = owner.create_subaccount("kite").initial_balance(NearToken::from_millinear(2_600)).transact().await?.into_result()?;
    let code = wasm("../../apps/web/public/vault/kite_vault.wasm");
    vault_acc.deploy(&code).await?.into_result()?;

    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    let agent_pk = agent_sk.public_key();
    owner
        .call(vault_acc.id(), "new")
        .args_json(json!({
            "owner": owner.id(),
            "plan": [
                { "token": BTC, "target_bps": 6000, "decimals": 8 },
                { "token": XAUT, "target_bps": 2000, "decimals": 6 },
                { "token": USDC, "target_bps": 2000, "decimals": 6 },
            ],
            "limits": { "band_bps": 500, "max_trade_bps": 1000, "max_slippage_bps": 100, "max_trades_per_day": 4, "min_interval_secs": 14400, "settle_window_secs": 1800 },
            "agent": agent_pk.to_string(),
            "intents": intents.id(),
            "quote_signer": pk_string(&oneclick()),
        }))
        .transact()
        .await?
        .into_result()?;
    vault_acc
        .batch(vault_acc.id())
        .add_key(agent_pk.clone(), AccessKey::function_call_access(vault_acc.id(), &["rebalance", "settle"], Some(ALLOWANCE)))
        .delete_key(vault_acc.secret_key().public_key())
        .transact()
        .await?
        .into_result()?;

    // $10,000 with BTC drifted to 70% (target 60%), as in the unit tests.
    for (token, amount) in [(BTC, "8750000"), (XAUT, "375000"), (USDC, "1500000000")] {
        intents.call("set_balance").args_json(json!({ "account_id": vault_acc.id(), "token_id": token, "amount": amount })).transact().await?.into_result()?;
    }
    let agent = Account::from_secret_key(vault_acc.id().clone(), agent_sk, &worker);
    Ok(Env { worker, owner, vault: vault_acc.id().clone(), intents, agent, agent_pk, wasm: code })
}

fn iso(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z", rem / 3_600, rem / 60 % 60, rem % 60)
}

/// A 1Click-style signed quote: sell $500 of BTC for XAUt at a fair price, paying `recipient`.
async fn quote(e: &Env, recipient: &str) -> anyhow::Result<(String, String)> {
    let now = e.worker.view_block().await?.timestamp() / 1_000_000_000;
    let v = e.vault.as_str();
    let mut m: BTreeMap<&str, Value> = BTreeMap::new();
    for (k, val) in [
        ("amount", json!("625000")), ("amountIn", json!("625000")), ("amountInFormatted", json!("x")),
        ("amountInUsd", json!("500.000000000000")), ("amountOut", json!("124750")), ("amountOutFormatted", json!("x")),
        ("amountOutUsd", json!("499.000000000000")), ("deadline", json!(iso(now + 3_600))), ("depositAddress", json!(DEPOSIT_ADDR)),
        ("depositType", json!("INTENTS")), ("destinationAsset", json!(XAUT)), ("dry", json!(false)),
        ("minAmountIn", json!("625000")), ("minAmountOut", json!("124126")), ("originAsset", json!(BTC)),
        ("recipient", json!(recipient)), ("recipientType", json!("INTENTS")), ("refundTo", json!(v)),
        ("refundType", json!("INTENTS")), ("slippageTolerance", json!(50)), ("swapType", json!("EXACT_INPUT")),
        ("timestamp", json!(iso(now))),
    ] {
        m.insert(k, val);
    }
    let body = serde_json::to_string(&m)?;
    let msg = bs58::encode(Sha256::digest(body.as_bytes())).into_string();
    let sig = oneclick().sign(msg.as_bytes());
    Ok((body, format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string())))
}

fn prices() -> Value {
    json!([
        { "token": BTC, "usd_e6": "80000000000" },
        { "token": XAUT, "usd_e6": "4000000000" },
        { "token": USDC, "usd_e6": "1000000" },
    ])
}

async fn rebalance(e: &Env, body: String, sig: String) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(e.agent
        .call(&e.vault, "rebalance")
        .args_json(json!({ "quote": body, "signature": sig, "prices": prices() }))
        .gas(Gas::from_tgas(REBALANCE_TGAS))
        .transact()
        .await?)
}

async fn status(e: &Env) -> anyhow::Result<Value> {
    Ok(e.worker.view(&e.vault, "get_status").await?.json()?)
}
async fn balance(e: &Env, token: &str) -> anyhow::Result<u128> {
    let b: Vec<String> = e.worker.view(e.intents.id(), "mt_batch_balance_of").args_json(json!({ "account_id": e.vault, "token_ids": [token] })).await?.json()?;
    Ok(b[0].parse()?)
}
async fn allowance(e: &Env) -> anyhow::Result<u128> {
    let k = e.worker.view_access_key(&e.vault, &e.agent_pk).await?;
    match k.permission {
        AccessKeyPermission::FunctionCall(f) => Ok(f.allowance.map(|a| a.as_yoctonear()).unwrap_or(u128::MAX)),
        AccessKeyPermission::FullAccess => anyhow::bail!("Kite's key must not be full access"),
    }
}
fn failed_with<E: std::fmt::Debug>(r: &Result<near_workspaces::result::ExecutionFinalResult, E>, needle: &str) -> bool {
    match r {
        Err(e) => format!("{e:?}").contains(needle),
        Ok(r) => !r.is_success() && format!("{:?}", r.failures()).contains(needle),
    }
}
fn near(yocto: u128) -> f64 {
    yocto as f64 / 1e24
}

/// The protocol, not just the contract: Kite's key can't call anything else, and nothing can change the code.
#[tokio::test]
async fn kites_key_is_limited_by_near_itself() -> anyhow::Result<()> {
    let e = setup().await?;

    // The only key on the vault is Kite's function-call key: no one, not even the owner, can redeploy it.
    let keys = e.worker.view_access_keys(&e.vault).await?;
    assert_eq!(keys.len(), 1, "exactly one key on the vault");
    assert!(matches!(keys[0].access_key.permission, AccessKeyPermission::FunctionCall(_)));

    // The deployed code is the file in this repo: its on-chain hash is the sha256 of the wasm.
    let ContractState::LocalHash(on_chain) = e.worker.view_account(&e.vault).await?.contract_state else {
        anyhow::bail!("the vault has no code deployed");
    };
    assert_eq!(on_chain.0, <[u8; 32]>::from(Sha256::digest(&e.wasm)), "code hash = sha256(kite_vault.wasm)");

    // Kite's key can't withdraw, can't move funds in intents directly, can't loosen limits.
    let r = e.agent.call(&e.vault, "withdraw").args_json(json!({ "token": BTC, "amount": "1", "receiver_id": "thief.test.near" })).deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(r.as_ref().map(|x| !x.is_success()).unwrap_or(true), "withdraw with Kite's key must fail");
    let r = e.agent.call(e.intents.id(), "mt_transfer").args_json(json!({ "receiver_id": "thief.test.near", "token_id": BTC, "amount": "1" })).deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(r.as_ref().map(|x| !x.is_success()).unwrap_or(true), "a direct intents transfer with Kite's key must fail");
    let r = e.agent.call(&e.vault, "set_limits").args_json(json!({ "limits": {} })).transact().await;
    assert!(r.as_ref().map(|x| !x.is_success()).unwrap_or(true), "set_limits with Kite's key must fail");
    assert_eq!(balance(&e, BTC).await?, 8_750_000, "nothing moved");

    // Owner methods need a full-access signature (1 yoctoNEAR attached), so a stray function-call key can't use them.
    let r = e.owner.call(&e.vault, "pause").transact().await;
    assert!(failed_with(&r, "ERR_ONE_YOCTO"), "pause without 1 yocto: {r:?}");
    // A stranger can't rebalance even with a valid signed quote.
    let (body, sig) = quote(&e, e.vault.as_str()).await?;
    let r = e.owner.call(&e.vault, "rebalance").args_json(json!({ "quote": body, "signature": sig, "prices": prices() })).gas(Gas::from_tgas(REBALANCE_TGAS)).transact().await;
    assert!(failed_with(&r, "ERR_NOT_AGENT"), "rebalance from another account: {r:?}");
    Ok(())
}

/// A real rebalance end to end, with the gas it burns and what it takes from Kite's allowance.
#[tokio::test]
async fn a_rebalance_runs_end_to_end_and_its_gas_is_measured() -> anyhow::Result<()> {
    let e = setup().await?;
    let a0 = allowance(&e).await?;
    let acct = e.worker.view_account(&e.vault).await?;
    let v0 = acct.balance.as_yoctonear();
    // The 2.6 NEAR deposit must cover the code's storage and still leave the key real gas money.
    let spare = v0 - acct.storage_usage as u128 * 10u128.pow(19);
    println!("fresh vault: {} bytes stored, {:.3} NEAR spare for gas", acct.storage_usage, near(spare));
    assert!(spare >= 10u128.pow(23), "a fresh vault must keep at least 0.1 NEAR for gas, has {:.3}", near(spare));

    let (body, sig) = quote(&e, e.vault.as_str()).await?;
    let r = rebalance(&e, body.clone(), sig.clone()).await?;
    assert!(r.is_success(), "rebalance failed: {:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains("rebalance_started")));
    let s = status(&e).await?;
    assert!(s["pending"].is_object(), "a swap is pending");
    assert_eq!(balance(&e, BTC).await?, 8_750_000 - 625_000, "the sell amount went to the deposit address");
    let a1_now = allowance(&e).await?;
    e.worker.fast_forward(10).await?; // let any gas refund receipts land
    let a1 = allowance(&e).await?;
    let v1 = e.worker.view_account(&e.vault).await?.balance.as_yoctonear();
    println!("\nallowance right after rebalance: -{:.4} NEAR; ten blocks later: -{:.4} NEAR; vault balance: -{:.4} NEAR", near(a0 - a1_now), near(a0 - a1), near(v0 - v1));

    // The same quote again is refused (replay), even with Kite's key.
    let again = rebalance(&e, body, sig).await;
    assert!(failed_with(&again, "ERR_"), "a replayed quote must fail");

    // 1Click fills: the bought XAUt lands in the vault. Anyone may settle; Kite's key does it here.
    e.intents.call("set_balance").args_json(json!({ "account_id": e.vault, "token_id": XAUT, "amount": (375_000u128 + 124_750).to_string() })).transact().await?.into_result()?;
    let st = e.agent.call(&e.vault, "settle").gas(Gas::from_tgas(SETTLE_TGAS)).transact().await?;
    assert!(st.is_success(), "settle failed: {:?}", st.failures());
    let settle_gas = st.total_gas_burnt;
    assert_eq!(st.json::<String>()?, "settled");
    assert!(status(&e).await?["pending"].is_null());
    e.worker.fast_forward(10).await?;
    let a2 = allowance(&e).await?;
    let v2 = e.worker.view_account(&e.vault).await?.balance.as_yoctonear();

    println!("\n── measured on the sandbox ──");
    println!("rebalance: {:.1} Tgas burnt in total, {:.4} NEAR taken from the allowance", r.total_gas_burnt.as_gas() as f64 / 1e12, near(a0 - a1));
    println!("settle:    {:.1} Tgas burnt in total, {:.4} NEAR taken from the allowance", settle_gas.as_gas() as f64 / 1e12, near(a1 - a2));
    println!("one whole rebalance: {:.4} NEAR of allowance, {:.4} NEAR of vault balance", near(a0 - a2), near(v0 - v2));
    println!("allowance left: {:.4} of {:.2} NEAR, enough for about {} more rebalances\n", near(a2), near(ALLOWANCE.as_yoctonear()), a2 / (a0 - a2).max(1));
    assert!(a0 - a2 < ALLOWANCE.as_yoctonear() / 4, "one rebalance must not use a quarter of the allowance");
    Ok(())
}

/// The vault survives its own transfer failing: the callback cleans up and nothing is left pending.
#[tokio::test]
async fn a_failed_transfer_leaves_nothing_pending() -> anyhow::Result<()> {
    let e = setup().await?;
    e.intents.call("set_fail_transfers").args_json(json!({ "fail": true })).transact().await?.into_result()?;
    let (body, sig) = quote(&e, e.vault.as_str()).await?;
    let r = rebalance(&e, body, sig).await?;
    assert!(r.logs().iter().any(|l| l.contains("rebalance_failed")), "the callback saw the failure: {:?}", r.logs());
    assert!(status(&e).await?["pending"].is_null(), "pending was cleared");
    assert_eq!(balance(&e, BTC).await?, 8_750_000, "nothing left the vault");
    Ok(())
}

/// A real signed quote that pays the attacker is refused on chain, with Kite's own key.
#[tokio::test]
async fn a_signed_quote_that_pays_someone_else_is_refused() -> anyhow::Result<()> {
    let e = setup().await?;
    let (body, sig) = quote(&e, "thief.test.near").await?;
    let r = rebalance(&e, body, sig).await;
    assert!(failed_with(&r, "ERR_QUOTE_RECIPIENT"), "{r:?}");
    assert!(status(&e).await?["pending"].is_null());
    assert_eq!(balance(&e, BTC).await?, 8_750_000);
    Ok(())
}

/* ───────────── a DAO takes over the vault (real SputnikDAO v3.2) ───────────── */

/// sha256 of the SputnikDAO v3.2 wasm the mainnet factory `sputnik-dao.near` deploys by default
/// (its code hash DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF in base58).
const SPUTNIK_V3_2_SHA256: &str = "bf6f951ee5e45968e3367fa857bebf8bc80badec183998c2239c487237e0d7f6";

fn b64(v: &Value) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(v).unwrap())
}

/// A council member proposes calls on the vault, then approves; returns the approving transaction.
async fn dao_does(e: &Env, dao: &Contract, council: &Account, calls: &[(&str, Value)]) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let bond: Value = dao.view("get_policy").await?.json()?;
    let bond: u128 = bond["proposal_bond"].as_str().unwrap().parse()?;
    let actions: Vec<Value> = calls
        .iter()
        .map(|(m, a)| json!({ "method_name": m, "args": b64(a), "deposit": "1", "gas": "100000000000000" }))
        .collect();
    let kind = json!({ "FunctionCall": { "receiver_id": e.vault, "actions": actions } });
    council
        .call(dao.id(), "add_proposal")
        .args_json(json!({ "proposal": { "description": "Kite vault change", "kind": kind } }))
        .deposit(NearToken::from_yoctonear(bond))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    let id: u64 = dao.view("get_last_proposal_id").await?.json::<u64>()? - 1;
    let stored: Value = dao.view("get_proposal").args_json(json!({ "id": id })).await?.json()?;
    // v3 refuses a vote that doesn't repeat the stored kind exactly.
    Ok(council
        .call(dao.id(), "act_proposal")
        .args_json(json!({ "id": id, "action": "VoteApprove", "proposal": stored["kind"] }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

#[tokio::test]
async fn a_sputnik_dao_takes_over_the_vault_and_runs_it_by_vote() -> anyhow::Result<()> {
    let e = setup().await?;
    let code = wasm("res/sputnikdao2_v3_2.wasm");
    let hash: String = Sha256::digest(&code).iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hash, SPUTNIK_V3_2_SHA256, "the DAO contract is the one mainnet's factory deploys");

    let root = e.worker.root_account()?;
    let council = root.create_subaccount("council").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let dao_acc = root.create_subaccount("treasury").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let dao = dao_acc.deploy(&code).await?.into_result()?;
    dao.call("new")
        .args_json(json!({ "config": { "name": "treasury", "purpose": "Kite test", "metadata": "" }, "policy": [council.id()] }))
        .transact()
        .await?
        .into_result()?;

    // 1. The owner offers the vault. Nothing changes yet.
    e.owner.call(&e.vault, "propose_owner").args_json(json!({ "new_owner": dao.id() })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    let s = status(&e).await?;
    assert_eq!(s["owner"], json!(e.owner.id()));
    assert_eq!(s["pending_owner"], json!(dao.id()));

    // 2. The DAO accepts by vote.
    let r = dao_does(&e, &dao, &council, &[("accept_owner", json!({}))]).await?;
    assert!(r.is_success(), "accept vote failed: {:?}", r.failures());
    let s = status(&e).await?;
    assert_eq!(s["owner"], json!(dao.id()), "the DAO owns the vault");
    assert!(s["pending_owner"].is_null());

    // 3. The person who created it no longer controls it.
    let r = e.owner.call(&e.vault, "pause").deposit(NearToken::from_yoctonear(1)).transact().await;
    assert!(failed_with(&r, "ERR_NOT_OWNER"), "{r:?}");

    // 4. The DAO changes the guardrails by vote, and the vault logs which analysis justified it.
    let policy_ref = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    let limits = json!({ "band_bps": 300, "max_trade_bps": 500, "max_slippage_bps": 50, "max_trades_per_day": 2, "min_interval_secs": 14400, "settle_window_secs": 1800 });
    let r = dao_does(&e, &dao, &council, &[("set_limits", json!({ "limits": limits, "policy_ref": policy_ref }))]).await?;
    assert!(r.is_success(), "limits vote failed: {:?}", r.failures());
    assert!(r.logs().iter().any(|l| l.contains("limits_updated") && l.contains(policy_ref)), "{:?}", r.logs());
    let now: Value = e.worker.view(&e.vault, "get_limits").await?.json()?;
    assert_eq!(now["band_bps"], json!(300));

    // 5. And pauses it by vote.
    let r = dao_does(&e, &dao, &council, &[("pause", json!({}))]).await?;
    assert!(r.is_success(), "pause vote failed: {:?}", r.failures());
    assert_eq!(status(&e).await?["paused"], json!(true));

    // 6. Two calls in one vote: rotate Kite's key (remove it, then add a new one with its allowance).
    let new_key = SecretKey::from_random(KeyType::ED25519).public_key();
    let r = dao_does(
        &e,
        &dao,
        &council,
        &[("revoke_agent", json!({})), ("set_agent", json!({ "public_key": new_key.to_string(), "allowance_yocto": "250000000000000000000000" }))],
    )
    .await?;
    assert!(r.is_success(), "key rotation vote failed: {:?}", r.failures());
    let keys = e.worker.view_access_keys(&e.vault).await?;
    assert_eq!(keys.len(), 1, "exactly one key after the rotation");
    assert_eq!(keys[0].public_key.to_string(), new_key.to_string(), "the new key replaced the old one");
    assert_eq!(status(&e).await?["agent"], json!(new_key.to_string()));
    Ok(())
}

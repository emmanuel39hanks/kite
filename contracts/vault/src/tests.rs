//! Unit tests and the attack suite. Each attack asserts the exact refusal.
//!
//! Quotes are signed here with a test key standing in for 1Click's, in exactly the
//! format 1Click uses: ed25519 over base58(sha256(json with sorted keys)).

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use std::collections::BTreeMap;

const USDC: &str = "nep141:usdc.near";
const BTC: &str = "nep141:nbtc.bridge.near";
const XAUT: &str = "nep141:xaut.omft.near";
const DOGE: &str = "nep141:doge.omft.near";
const NOW: u64 = 1_793_664_000; // 2026-11-03, seconds

fn owner() -> AccountId {
    "alex.near".parse().unwrap()
}
fn vault_id() -> AccountId {
    "kite.alex.near".parse().unwrap()
}
fn attacker() -> AccountId {
    "attacker.near".parse().unwrap()
}
fn deposit_addr() -> AccountId {
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".parse().unwrap()
}
fn agent_pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}

/// Stands in for 1Click's quote-signing key.
fn oneclick() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn pk_of(k: &SigningKey) -> PublicKey {
    format!("ed25519:{}", near_sdk::bs58::encode(k.verifying_key().to_bytes()).into_string()).parse().unwrap()
}

fn plan() -> Vec<Target> {
    vec![
        Target { token: BTC.into(), target_bps: 6_000, decimals: 8, max_slippage_bps: None },
        Target { token: XAUT.into(), target_bps: 2_000, decimals: 6, max_slippage_bps: None },
        Target { token: USDC.into(), target_bps: 2_000, decimals: 6, max_slippage_bps: None },
    ]
}
fn limits() -> Limits {
    Limits { band_bps: 500, max_trade_bps: 1_000, max_slippage_bps: 100, max_trades_per_day: 4, min_interval_secs: 3_600, settle_window_secs: 1_800 }
}
/// $1 = 1_000_000.
fn prices() -> Vec<Price> {
    vec![
        Price { token: BTC.into(), usd_e6: U128(80_000_000_000) },   // $80,000
        Price { token: XAUT.into(), usd_e6: U128(4_000_000_000) },   // $4,000
        Price { token: USDC.into(), usd_e6: U128(1_000_000) },       // $1
    ]
}
/// $10,000 portfolio with BTC drifted to 70% (target 60%): 0.0875 BTC, 0.375 XAUt, $1,500 USDC.
fn drifted_balances() -> Vec<u128> {
    vec![8_750_000, 375_000, 1_500_000_000]
}
fn balances_ok() -> Result<Vec<U128>, PromiseError> {
    Ok(drifted_balances().into_iter().map(U128).collect())
}

fn ctx(predecessor: AccountId, deposit: u128, now_secs: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(predecessor)
        .signer_account_pk(agent_pk())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_secs * NS_PER_SEC)
        .build());
}

fn new_vault() -> Vault {
    ctx(owner(), 0, NOW);
    Vault::new(owner(), plan(), limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())))
}

/// "2026-11-03T00:00:00.000Z" for a Unix time in seconds.
fn iso(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil from days (Howard Hinnant).
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

/// The fields of a 1Click quote response that 1Click signs. Defaults: sell $500 of BTC for XAUt, fairly.
#[derive(Clone)]
struct Q {
    dry: bool,
    sell: &'static str,
    buy: &'static str,
    amount_in: u128,
    amount_out: u128,
    min_out: u128,
    in_usd: &'static str,
    out_usd: &'static str,
    recipient: String,
    refund_to: String,
    deposit: Option<String>,
    at: u64,
}
fn good() -> Q {
    Q {
        dry: false,
        sell: BTC,
        buy: XAUT,
        amount_in: 625_000, // 0.00625 BTC = $500
        amount_out: 124_750, // 0.12475 XAUt = $499 (0.2% cost)
        min_out: 124_126, // 0.5% under amount_out
        in_usd: "500.000000000000",
        out_usd: "499.000000000000",
        recipient: vault_id().to_string(),
        refund_to: vault_id().to_string(),
        deposit: Some(deposit_addr().to_string()),
        at: NOW,
    }
}

/// The exact JSON 1Click signs (sorted keys), and its signature by `key`.
fn sign_with(q: &Q, key: &SigningKey) -> (String, String) {
    sign_full(q, key, &[])
}
/// Same, with extra fields in the signed request (fees, referrals, …).
fn sign_full(q: &Q, key: &SigningKey, extra: &[(&'static str, near_sdk::serde_json::Value)]) -> (String, String) {
    let mut m: BTreeMap<&str, near_sdk::serde_json::Value> = BTreeMap::new();
    use near_sdk::serde_json::json;

    m.insert("amount", json!(q.amount_in.to_string()));
    m.insert("amountIn", json!(q.amount_in.to_string()));
    m.insert("amountInFormatted", json!("x"));
    m.insert("amountInUsd", json!(q.in_usd));
    m.insert("amountOut", json!(q.amount_out.to_string()));
    m.insert("amountOutFormatted", json!("x"));
    m.insert("amountOutUsd", json!(q.out_usd));
    m.insert("deadline", json!(iso(q.at + 3_600)));
    if let Some(d) = &q.deposit {
        m.insert("depositAddress", json!(d));
    }
    m.insert("depositType", json!("INTENTS"));
    m.insert("destinationAsset", json!(q.buy));
    m.insert("dry", json!(q.dry));
    m.insert("minAmountIn", json!(q.amount_in.to_string()));
    m.insert("minAmountOut", json!(q.min_out.to_string()));
    m.insert("originAsset", json!(q.sell));
    m.insert("recipient", json!(q.recipient));
    m.insert("recipientType", json!("INTENTS"));
    m.insert("refundTo", json!(q.refund_to));
    m.insert("refundType", json!("INTENTS"));
    m.insert("slippageTolerance", json!(50));
    m.insert("swapType", json!("EXACT_INPUT"));
    m.insert("timestamp", json!(iso(q.at)));
    for (k, v) in extra {
        m.insert(k, v.clone()); // extras win, so a test can corrupt any field
    }
    let body = near_sdk::serde_json::to_string(&m).unwrap();
    let msg = near_sdk::bs58::encode(env::sha256(body.as_bytes())).into_string();
    let sig = key.sign(msg.as_bytes());
    (body, format!("ed25519:{}", near_sdk::bs58::encode(sig.to_bytes()).into_string()))
}
fn signed(q: &Q) -> (String, String) {
    sign_with(q, &oneclick())
}
/// Verified terms for a quote, as the vault sees them at NOW + 30 s.
fn terms(v: &Vault, q: &Q) -> QuoteTerms {
    let (body, sig) = signed(q);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC)
}
/// Run step 2 of a good rebalance (balances already read).
fn start_good_trade(v: &mut Vault) {
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    let _ = v.on_rebalance_sent(Ok(())); // the transfer to the deposit address went through
}
/// The agent calling step 1 with a quote.
fn agent_rebalance(v: &mut Vault, q: &Q, at: u64) {
    let (body, sig) = signed(q);
    ctx(vault_id(), 0, at);
    let _ = v.rebalance(body, sig, prices());
}

/* ───────────── setup and owner rules ───────────── */

#[test]
fn creates_with_valid_plan() {
    let v = new_vault();
    assert_eq!(v.get_plan().len(), 3);
    assert!(!v.get_status().paused);
}

#[test]
#[should_panic(expected = "ERR_PLAN_SUM")]
fn plan_must_sum_to_100() {
    ctx(owner(), 0, 1);
    let mut p = plan();
    p[0].target_bps = 5_999;
    Vault::new(owner(), p, limits(), None, None, None);
}

#[test]
#[should_panic(expected = "ERR_PLAN_ASSET")]
fn plan_rejects_duplicates() {
    ctx(owner(), 0, 1);
    let mut p = plan();
    p[1].token = BTC.into();
    Vault::new(owner(), p, limits(), None, None, None);
}

#[test]
#[should_panic(expected = "ERR_LIMITS")]
fn limits_are_bounded() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    v.set_limits(Limits { max_trade_bps: 9_000, ..limits() }, None);
}

#[test]
#[should_panic(expected = "ERR_ONE_YOCTO")]
fn owner_actions_need_one_yocto() {
    let mut v = new_vault();
    ctx(owner(), 0, NOW + 100);
    v.pause();
}

#[test]
fn owner_can_pause_and_unpause() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    v.pause();
    assert!(v.get_status().paused);
    v.unpause();
    assert!(!v.get_status().paused);
}

#[test]
fn good_trade_passes_policy() {
    let v = new_vault();
    let c = v.policy_check(&drifted_balances(), &terms(&v, &good()), &prices());
    assert_eq!(c.sell_drift_bps, 1_000);
}

#[test]
fn signed_quote_terms_are_read() {
    let v = new_vault();
    let t = terms(&v, &good());
    assert_eq!((t.sell.as_str(), t.buy.as_str()), (BTC, XAUT));
    assert_eq!((t.amount_in.0, t.min_out.0, t.in_usd_e6.0), (625_000, 124_126, 500_000_000));
    assert_eq!(t.deposit_address, deposit_addr());
}

#[test]
fn parses_1click_numbers_and_times() {
    assert_eq!(parse_usd_e6("4.996660000000"), Some(4_996_660));
    assert_eq!(parse_usd_e6("38"), Some(38_000_000));
    assert_eq!(parse_usd_e6("-1"), None);
    assert_eq!(parse_iso_ns("2026-11-03T00:01:49.235Z"), Some(1_793_664_109_235 * 1_000_000));
    assert_eq!(parse_iso_ns("2026-11-03T00:01:49Z"), Some(1_793_664_109 * NS_PER_SEC));
    assert_eq!(parse_iso_ns("2026-11-03 00:01:49Z"), None);
    assert_eq!(parse_iso_ns(&iso(NOW)), Some(NOW * NS_PER_SEC));
}

/// The real thing: a quote 1Click returned at 2026-11-03T00:05:28.110Z, checked against 1Click's real key.
#[test]
fn verifies_a_real_1click_signature() {
    ctx(owner(), 0, NOW);
    let v = Vault::new(owner(), plan(), limits(), None, None, None);
    let body = r#"{"amount":"5000000","amountIn":"5000000","amountInFormatted":"5.0","amountInUsd":"4.996540000000","amountOut":"6499","amountOutFormatted":"0.00006499","amountOutUsd":"4.984408050000","deadline":"2026-11-06T01:05:27.789Z","depositAddress":"309eda6dc4ff8679f6de9e57aede0142ee2bb14ccaa4166145355bb2bcd7a55c","depositType":"INTENTS","destinationAsset":"nep141:nbtc.bridge.near","dry":false,"minAmountIn":"5000000","minAmountOut":"6434","originAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","recipient":"kite.preview.near","recipientType":"INTENTS","refundFee":"0","refundTo":"kite.preview.near","refundType":"INTENTS","slippageTolerance":100,"swapType":"EXACT_INPUT","timeEstimate":10,"timeWhenInactive":"2026-11-06T01:05:27.789Z","timestamp":"2026-11-03T00:05:28.110Z","withdrawFee":"0"}"#;
    let sig = REAL_SIG;
    // The quote pays kite.preview.near, so check it as that vault.
    testing_env!(VMContextBuilder::new().current_account_id("kite.preview.near".parse().unwrap()).block_timestamp(1793664348 * NS_PER_SEC).build());
    let t = v.verify_quote(body, sig, env::block_timestamp());
    assert_eq!(t.amount_out.0, 6499);
}

#[test]
fn rebalance_records_pending_and_counts_trade() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    let st = v.get_status();
    assert!(st.pending.is_some());
    assert_eq!(st.trades_today, 1);
}

#[test]
fn settle_confirms_delivery() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    // BTC went out, XAUt came in (more than min_out).
    let after = vec![8_750_000 - 625_000, 375_000 + 124_800, 1_500_000_000];
    assert_eq!(v.settle_with(&after, (NOW + 300) * NS_PER_SEC), "settled");
    assert!(v.get_status().pending.is_none());
    assert!(!v.get_status().paused);
}

#[test]
fn settle_accepts_a_refund() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    assert_eq!(v.settle_with(&drifted_balances(), (NOW + 300) * NS_PER_SEC), "refunded");
    assert!(!v.get_status().paused);
}

#[test]
fn settle_waits_inside_the_window() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    let gone = vec![8_750_000 - 625_000, 375_000, 1_500_000_000];
    assert_eq!(v.settle_with(&gone, (NOW + 300) * NS_PER_SEC), "waiting");
}

#[test]
fn owner_can_allocate_new_money() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    let _ = v.allocate(vec![
        Transfer { token: USDC.into(), amount: U128(600_000_000), to: deposit_addr() },
        Transfer { token: USDC.into(), amount: U128(200_000_000), to: deposit_addr() },
    ]);
}

/// A12: the agent tries to use allocate to move money out.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a12_agent_allocates() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 100);
    let _ = v.allocate(vec![Transfer { token: USDC.into(), amount: U128(1), to: attacker() }]);
}

#[test]
fn owner_can_withdraw() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    let _ = v.withdraw(USDC.into(), U128(100), owner());
}

/* ───────────── attack suite: the agent key, or anyone else, trying to misbehave ───────────── */

/// A1: the agent tries to withdraw. (Its key can't even call `withdraw`; the contract refuses too.)
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a1_agent_withdraws() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 100);
    let _ = v.withdraw(USDC.into(), U128(1_500_000_000), attacker());
}

/// A1b: a stranger tries to withdraw.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a1b_stranger_withdraws() {
    let mut v = new_vault();
    ctx(attacker(), 1, NOW + 100);
    let _ = v.withdraw(USDC.into(), U128(1), attacker());
}

/// A2: buy an asset that isn't in the plan (even with a genuine 1Click quote for it).
#[test]
#[should_panic(expected = "ERR_NOT_IN_PLAN")]
fn attack_a2_off_plan_asset() {
    let mut v = new_vault();
    agent_rebalance(&mut v, &Q { buy: DOGE, ..good() }, NOW + 30);
}

/// A3: sell something that is under its target.
#[test]
#[should_panic(expected = "ERR_NOT_OVER_BAND")]
fn attack_a3_sell_underweight() {
    let v = new_vault();
    let q = Q { sell: USDC, amount_in: 100_000_000, amount_out: 24_900, min_out: 24_800, in_usd: "100", out_usd: "99.6", ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

/// A3b: buy something that is already over target.
/// BTC 70% (target 60), XAUt 25% (target 20), USDC 5% (target 20). BTC→XAUt adds to an overweight asset.
#[test]
#[should_panic(expected = "ERR_WRONG_DIRECTION")]
fn attack_a3b_buy_overweight() {
    let v = new_vault();
    let bal = vec![8_750_000, 625_000, 500_000_000];
    v.policy_check(&bal, &terms(&v, &good()), &prices());
}

/// A4: one giant trade (60% of NAV).
#[test]
#[should_panic(expected = "ERR_TOO_BIG")]
fn attack_a4_oversized_trade() {
    let v = new_vault();
    let q = Q { amount_in: 7_500_000, amount_out: 1_497_000, min_out: 1_490_000, in_usd: "6000", out_usd: "5988", ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

/// A5: a genuinely signed but bad quote: what comes back is worth 10% less than what goes out.
#[test]
#[should_panic(expected = "ERR_SLIPPAGE")]
fn attack_a5_bad_price() {
    let v = new_vault();
    let q = Q { amount_out: 112_500, min_out: 112_000, out_usd: "450", ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

/// A yield token can carry a wider limit: a 2% cost is fine when XAUt allows 2.5%…
#[test]
fn per_asset_limit_widens_for_that_asset() {
    ctx(owner(), 0, NOW);
    let mut p = plan();
    p[1].max_slippage_bps = Some(250);
    let v = Vault::new(owner(), p, limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())));
    let q = Q { amount_out: 122_500, min_out: 122_000, out_usd: "490", ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

/// …but not past what the owner set (here 2.5%, quote costs 4%).
#[test]
#[should_panic(expected = "ERR_SLIPPAGE")]
fn per_asset_limit_still_binds() {
    ctx(owner(), 0, NOW);
    let mut p = plan();
    p[1].max_slippage_bps = Some(250);
    let v = Vault::new(owner(), p, limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())));
    let q = Q { amount_out: 120_000, min_out: 119_500, out_usd: "480", ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

#[test]
#[should_panic(expected = "ERR_PLAN_ASSET")]
fn per_asset_limit_is_bounded() {
    ctx(owner(), 0, NOW);
    let mut p = plan();
    p[1].max_slippage_bps = Some(2_000);
    Vault::new(owner(), p, limits(), None, None, None);
}

/// A5b: a fair quote, but asked for with a loose minimum (10% under), so solvers could underfill.
#[test]
#[should_panic(expected = "ERR_SLIPPAGE")]
fn attack_a5b_loose_minimum() {
    let v = new_vault();
    let q = Q { min_out: 112_000, ..good() };
    v.policy_check(&drifted_balances(), &terms(&v, &q), &prices());
}

/// A6: a fifth trade in one day when the limit is four.
#[test]
#[should_panic(expected = "ERR_RATE")]
fn attack_a6_too_many_trades() {
    let mut v = new_vault();
    let start = NOW - NOW % DAY_SECS + 60; // early in a UTC day
    for i in 0..5u64 {
        ctx(vault_id(), 0, start + i * 3_700);
        v.check_can_trade(BTC, XAUT, U128(1));
        v.trades_today += 1;
        v.last_trade_ns = env::block_timestamp();
    }
}

/// A6b: two trades too close together.
#[test]
#[should_panic(expected = "ERR_RATE")]
fn attack_a6b_too_soon() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    v.pending = None; // pretend it settled
    ctx(vault_id(), 0, NOW + 300);
    v.check_can_trade(BTC, XAUT, U128(1));
}

/// A7: a second rebalance while one is pending.
#[test]
#[should_panic(expected = "ERR_PENDING")]
fn attack_a7_overlapping_swaps() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    agent_rebalance(&mut v, &Q { at: NOW + 200, ..good() }, NOW + 230);
}

/// A8: the agent tries to loosen its own limits.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a8_agent_changes_limits() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 100);
    v.set_limits(Limits { max_trade_bps: 5_000, ..limits() }, None);
}

/// A8b: the agent tries to unpause after the breaker.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a8b_agent_unpauses() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 100);
    v.unpause();
}

/// A9: the swap never delivers (e.g. a lying worker sent funds to its own address).
/// After the window, settle pauses the vault, and the next rebalance is refused.
#[test]
#[should_panic(expected = "ERR_PAUSED")]
fn attack_a9_non_delivery_trips_breaker() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    let gone = vec![8_750_000 - 625_000, 375_000, 1_500_000_000];
    assert_eq!(v.settle_with(&gone, (NOW + 30 + 1_801) * NS_PER_SEC), "breaker");
    assert!(v.get_status().paused);
    agent_rebalance(&mut v, &Q { at: NOW + 99_000, ..good() }, NOW + 99_030);
}

/// A10: a stranger calls rebalance directly, with a perfectly good quote.
#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn attack_a10_stranger_rebalances() {
    let mut v = new_vault();
    let (body, sig) = signed(&good());
    ctx(attacker(), 0, NOW + 30);
    let _ = v.rebalance(body, sig, prices());
}

/// A11: after the owner revokes the agent, rebalance is refused even from the account itself.
#[test]
#[should_panic(expected = "ERR_NO_AGENT")]
fn attack_a11_revoked_agent() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    let _ = v.revoke_agent();
    agent_rebalance(&mut v, &good(), NOW + 30);
}

/* ───────────── attacks on the quote: a stolen agent key trying to redirect money ───────────── */

/// A13: take a real quote and edit it (here: a bigger amount). The signature no longer matches.
#[test]
#[should_panic(expected = "ERR_QUOTE_SIG")]
fn attack_a13_edited_quote() {
    let v = new_vault();
    let (body, sig) = signed(&good());
    let edited = body.replace(r#""amountIn":"625000""#, r#""amountIn":"6250000""#);
    v.verify_quote(&edited, &sig, (NOW + 30) * NS_PER_SEC);
}

/// A13b: sign a quote with the attacker's own key instead of 1Click's.
#[test]
#[should_panic(expected = "ERR_QUOTE_SIG")]
fn attack_a13b_self_signed_quote() {
    let v = new_vault();
    let (body, sig) = sign_with(&good(), &SigningKey::from_bytes(&[9u8; 32]));
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

/// A14: a genuine 1Click quote, requested by the attacker, that pays out to the attacker.
#[test]
#[should_panic(expected = "ERR_QUOTE_RECIPIENT")]
fn attack_a14_quote_pays_attacker() {
    let v = new_vault();
    terms(&v, &Q { recipient: attacker().to_string(), ..good() });
}

/// A15: a genuine quote whose refund goes to the attacker (then make the swap fail on purpose).
#[test]
#[should_panic(expected = "ERR_QUOTE_REFUND")]
fn attack_a15_refund_to_attacker() {
    let v = new_vault();
    terms(&v, &Q { refund_to: attacker().to_string(), ..good() });
}

/// A16: an old quote, saved up for when the price has moved in the attacker's favour.
#[test]
#[should_panic(expected = "ERR_QUOTE_STALE")]
fn attack_a16_stale_quote() {
    let v = new_vault();
    terms(&v, &Q { at: NOW - 600, ..good() });
}

/// A17: replay a quote that was already used, after the first swap settled.
#[test]
#[should_panic(expected = "ERR_QUOTE_REPLAY")]
fn attack_a17_replayed_quote() {
    let mut v = new_vault();
    start_good_trade(&mut v);
    v.pending = None;
    v.last_trade_ns = 0; // even with the time limits out of the way
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
}

/// A18: lie about prices to make a giant trade look small (BTC "worth" $1). The two traded
/// assets are valued from the signed quote, so the lie changes nothing.
#[test]
#[should_panic(expected = "ERR_TOO_BIG")]
fn attack_a18_lying_prices() {
    let v = new_vault();
    let q = Q { amount_in: 7_500_000, amount_out: 1_497_000, min_out: 1_490_000, in_usd: "6000", out_usd: "5988", ..good() };
    let lies = vec![
        Price { token: BTC.into(), usd_e6: U128(1_000_000) },
        Price { token: XAUT.into(), usd_e6: U128(1_000_000) },
        Price { token: USDC.into(), usd_e6: U128(1_000_000) },
    ];
    v.policy_check(&drifted_balances(), &terms(&v, &q), &lies);
}

/// A19: a dry quote (no deposit address, never executable) passed off as real.
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a19_dry_quote() {
    let v = new_vault();
    terms(&v, &Q { dry: true, deposit: None, ..good() });
}

/// A20: a quote with no deposit address.
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a20_no_deposit_address() {
    let v = new_vault();
    terms(&v, &Q { deposit: None, ..good() });
}

/// Only the owner can rotate the quote key.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a21_agent_rotates_quote_key() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 100);
    v.set_quote_signer(pk_of(&SigningKey::from_bytes(&[9u8; 32])));
}

/// A22: a real quote whose signed request carries a referral or a redirect.
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a22_referral_on_the_quote() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("referral", json!("thief"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a22b_virtual_chain_redirect_on_the_quote() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("virtualChainRecipient", json!("0xthief"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

/// Empty or null fields are what an honest request looks like, and are fine.
#[test]
fn empty_referral_fields_are_fine() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("referral", json!(null)), ("customRecipientMsg", json!(""))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

/// A25: a quote that wants a deposit memo: the vault's plain transfer carries none, so the swap would never start.
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a25_deposit_memo_required() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("depositMemo", json!("needs-this"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

/// A23: some other key on the vault account (not the one recorded for Kite) calls rebalance.
#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn attack_a23_other_key_on_the_account() {
    let mut v = new_vault();
    let (body, sig) = signed(&good());
    testing_env!(VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(vault_id())
        .signer_account_pk("ed25519:3tysLvy7KGoE8pznUgXvSHa4vYyGvrDZFcT8jgb8PEQ6".parse().unwrap())
        .block_timestamp(NOW * NS_PER_SEC)
        .build());
    let _ = v.rebalance(body, sig, prices());
}

/// A zero allowance would have meant unlimited gas for the agent key.
#[test]
#[should_panic(expected = "ERR_LIMITS")]
fn set_agent_refuses_zero_allowance() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    let _ = v.set_agent(agent_pk(), U128(0));
}

/// The quote key must be ed25519, or every rebalance would panic.
#[test]
#[should_panic(expected = "ERR_QUOTE_SIG")]
fn quote_signer_must_be_ed25519() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW + 100);
    v.set_quote_signer(PublicKey::from_parts(near_sdk::CurveType::SECP256K1, vec![1u8; 64]).unwrap());
}

/// Only the owner can set a vault up.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn new_refuses_a_stranger() {
    ctx("stranger.near".parse().unwrap(), 0, NOW);
    Vault::new(owner(), plan(), limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())));
}

/// The account that created the vault (Kite's factory) can set it up for another owner, such as a DAO.
#[test]
fn new_by_the_parent_factory_for_a_dao() {
    testing_env!(VMContextBuilder::new()
        .current_account_id("treasury.kitevaults.near".parse().unwrap())
        .predecessor_account_id("kitevaults.near".parse().unwrap())
        .build());
    let v = Vault::new("dao.sputnik-dao.near".parse().unwrap(), plan(), limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())));
    assert_eq!(v.get_status().owner.as_str(), "dao.sputnik-dao.near");
}

/// Only the direct parent: not a grandparent, a lookalike suffix, or the vault itself.
#[test]
fn only_the_direct_parent_counts() {
    let c = |s: &str| -> AccountId { s.parse().unwrap() };
    assert!(is_direct_child(&c("treasury.kitevaults.near"), &c("kitevaults.near")));
    assert!(!is_direct_child(&c("a.treasury.kitevaults.near"), &c("kitevaults.near")));
    assert!(!is_direct_child(&c("treasury.evilkitevaults.near"), &c("kitevaults.near")));
    assert!(!is_direct_child(&c("treasurykitevaults.near"), &c("kitevaults.near")));
    assert!(!is_direct_child(&c("kitevaults.near"), &c("kitevaults.near")));
    assert!(!is_direct_child(&c("treasury.kitevaults.near"), &c("near")));
}

/// A grandparent isn't the creator: it can't set the vault up for someone else.
#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn new_refuses_a_grandparent() {
    testing_env!(VMContextBuilder::new()
        .current_account_id("treasury.kitevaults.near".parse().unwrap())
        .predecessor_account_id("near".parse().unwrap())
        .build());
    Vault::new("dao.sputnik-dao.near".parse().unwrap(), plan(), limits(), Some(agent_pk()), None, Some(pk_of(&oneclick())));
}

#[test]
#[should_panic(expected = "ERR_LIMITS")]
fn min_interval_is_bounded() {
    ctx(owner(), 0, NOW);
    Vault::new(owner(), plan(), Limits { min_interval_secs: u64::MAX, ..limits() }, Some(agent_pk()), None, Some(pk_of(&oneclick())));
}

/// A24: dust trades to burn the daily trade count and lock the vault in pending.
#[test]
#[should_panic(expected = "ERR_TOO_SMALL")]
fn attack_a24_dust_trade() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let q = Q { amount_in: 625, amount_out: 124, min_out: 123, in_usd: "0.5", out_usd: "0.499", ..good() };
    let t = terms(&v, &q);
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
}


/// A26: anyone calls `settle` right after `rebalance`, before the sell transfer has executed. The sell balance still
/// looks untouched, which used to read as "refunded" and cleared `pending` while the swap was in flight.
#[test]
fn attack_a26_settle_before_the_transfer_lands() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    // Transfer not yet sent: balances are exactly what they were.
    assert_eq!(v.settle_with(&drifted_balances(), (NOW + 40) * NS_PER_SEC), "waiting");
    assert!(v.get_status().pending.is_some(), "pending must survive an early settle");
    // Once the transfer is confirmed, the same balances do mean a refund.
    let _ = v.on_rebalance_sent(Ok(()));
    assert_eq!(v.settle_with(&drifted_balances(), (NOW + 60) * NS_PER_SEC), "refunded");
}

/// If the transfer's callback never records it, the swap is still judged once the settle window ends,
/// so the vault can't be stuck: money that left and never came back trips the breaker.
#[test]
fn an_unconfirmed_swap_is_judged_after_the_window() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    let mut gone = drifted_balances();
    let si = v.get_plan().iter().position(|x| x.token == v.get_status().pending.unwrap().sell).unwrap();
    gone[si] = 0;
    assert_eq!(v.settle_with(&gone, (NOW + 60) * NS_PER_SEC), "waiting");
    assert_eq!(v.settle_with(&gone, (NOW + 4_000) * NS_PER_SEC), "breaker");
    assert!(v.get_status().paused && v.get_status().pending.is_none());
}

#[test]
fn a_failed_transfer_clears_pending() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    assert!(!v.on_rebalance_sent(Err(PromiseError::Failed)));
    assert!(v.get_status().pending.is_none());
}

/// Fields of the signed quote that must be exactly right (each used to be unprotected by any test).
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn quote_amount_must_equal_amount_in() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("amount", json!("999"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}
#[test]
#[should_panic(expected = "ERR_QUOTE_STALE")]
fn quote_may_not_be_dated_in_the_future() {
    let v = new_vault();
    terms(&v, &Q { at: NOW + 60, ..good() }); // verified at NOW + 30: 30 s ahead, over the 15 s allowance
}
#[test]
#[should_panic(expected = "ERR_QUOTE_REFUND")]
fn refund_must_stay_inside_intents() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("refundType", json!("ORIGIN_CHAIN"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}
#[test]
#[should_panic(expected = "ERR_QUOTE_RECIPIENT")]
fn payout_must_stay_inside_intents() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("recipientType", json!("ORIGIN_CHAIN"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}
#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn deposit_must_come_from_inside_intents() {
    use near_sdk::serde_json::json;
    let v = new_vault();
    let (body, sig) = sign_full(&good(), &oneclick(), &[("depositType", json!("ORIGIN_CHAIN"))]);
    v.verify_quote(&body, &sig, (NOW + 30) * NS_PER_SEC);
}

/// A27: a trade bigger than the drift plus the band would sell past target. The max-trade cap is raised here so
/// that only the no-overshoot rule can stop it: $2,000 is 20% of a $10,000 vault, and the room is 10 + 5 = 15 points.
#[test]
#[should_panic(expected = "ERR_TOO_BIG")]
fn attack_a27_overshooting_the_target() {
    ctx(owner(), 0, NOW);
    let v = Vault::new(owner(), plan(), Limits { max_trade_bps: 5_000, ..limits() }, Some(agent_pk()), None, Some(pk_of(&oneclick())));
    let q = Q { amount_in: 2_500_000, amount_out: 499_000, min_out: 496_500, in_usd: "2000.000000000000", out_usd: "1996.000000000000", ..good() };
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &q);
    let _ = v.policy_check(&drifted_balances(), &t, &prices());
}

/// Selling more than the vault holds.
#[test]
#[should_panic(expected = "ERR_INSUFFICIENT")]
fn cannot_sell_more_than_the_vault_holds() {
    let v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &Q { amount_in: 625_001, ..good() });
    let _ = v.policy_check(&[625_000, 0, 0], &t, &prices()); // holds exactly 0.00625 BTC, asked to sell a hair more
}

/* ───────────── close_vault ───────────── */

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn close_refuses_non_owner() {
    let mut v = new_vault();
    ctx(attacker(), 1, NOW + 2_000);
    let _ = v.close_vault(None);
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn close_refuses_agent_key() {
    let mut v = new_vault();
    ctx(vault_id(), 1, NOW + 2_000);
    let _ = v.close_vault(None);
}

#[test]
#[should_panic(expected = "ERR_NOT_EMPTY")]
fn close_refuses_while_money_remains() {
    let v = new_vault();
    v.check_close(&[0, 1, 0]);
}

#[test]
fn close_allowed_when_empty_and_pauses_kite() {
    let mut v = new_vault();
    v.check_close(&[0, 0, 0, 0]);
    ctx(owner(), 1, NOW + 2_000);
    let _ = v.close_vault(Some(vec![USDC.into(), DOGE.into()]));
    assert!(v.get_status().paused, "closing pauses Kite before balances are read");
}

#[test]
fn close_checks_extra_tokens_once() {
    let v = new_vault();
    let t = v.close_tokens(vec![USDC.into(), DOGE.into(), DOGE.into()]);
    assert_eq!(t, vec![BTC.to_string(), XAUT.to_string(), USDC.to_string(), DOGE.to_string()]);
}

/// 1Click's signature on the quote in `verifies_a_real_1click_signature`.
const REAL_SIG: &str = "ed25519:7XRRcve6kEgqHdKGWZ5QwXNmk7bn2vmNeFoMdfipTauyTu8spkDwM5SgM9u4WfEYJqDNaHt6RAEnhGgSQRGuvZB";

/// A balance read that was sent before the transfer out was confirmed may land after it is.
/// That read can't see the transfer, so it must not judge the swap (it would look like a refund).
#[test]
fn attack_a28_stale_balance_read_cannot_settle() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    let started = v.get_status().pending.unwrap().started_ns;
    let _ = v.on_rebalance_sent(Ok(()));
    let stale: Vec<U128> = drifted_balances().into_iter().map(U128).collect();
    assert_eq!(v.on_settle_balances(started, false, Ok(stale.clone())), "waiting");
    assert!(v.get_status().pending.is_some(), "a stale read must not clear the swap");
    // A read for some other swap says nothing either.
    assert_eq!(v.on_settle_balances(started + 1, true, Ok(stale.clone())), "waiting");
    assert!(v.get_status().pending.is_some());
    // A read sent after the confirmation is judged: the same balances now mean a refund.
    assert_eq!(v.on_settle_balances(started, true, Ok(stale)), "refunded");
    assert!(v.get_status().pending.is_none());
}

/// settle() tells its callback whether the transfer was confirmed when the balance read was sent.
#[test]
fn settle_records_whether_the_transfer_was_confirmed() {
    use near_sdk::mock::MockAction;
    let args_of_callback = || {
        near_sdk::test_utils::get_created_receipts()
            .into_iter()
            .flat_map(|r| r.actions)
            .find_map(|a| match a {
                MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"on_settle_balances" => {
                    Some(String::from_utf8(args).unwrap())
                }
                _ => None,
            })
            .expect("settle schedules on_settle_balances")
    };
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let t = terms(&v, &good());
    let _ = v.on_rebalance_balances(balances_ok(), t, prices());
    ctx(vault_id(), 0, NOW + 31);
    let _ = v.settle();
    assert!(args_of_callback().contains(r#""confirmed":false"#));
    let _ = v.on_rebalance_sent(Ok(()));
    ctx(vault_id(), 0, NOW + 32);
    let _ = v.settle();
    assert!(args_of_callback().contains(r#""confirmed":true"#));
}

#[test]
#[should_panic(expected = "ERR_PRICE")]
fn attack_a29_repeated_prices_are_refused() {
    let mut v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let mut p = prices();
    p.push(p[0].clone());
    let (q, sig) = signed(&good());
    let _ = v.rebalance(q, sig, p);
}

#[test]
#[should_panic(expected = "ERR_QUOTE_TERMS")]
fn attack_a30_oversized_quote_is_refused() {
    let v = new_vault();
    ctx(vault_id(), 0, NOW + 30);
    let _ = v.verify_quote(&"x".repeat(5000), "sig", NOW * NS_PER_SEC);
}

/* ───────────── handing a vault to a DAO ───────────── */

fn dao() -> AccountId {
    "treasury.sputnik-dao.near".parse().unwrap()
}

#[test]
fn a_vault_can_be_handed_to_a_dao_in_two_steps() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(dao()));
    assert_eq!(v.get_status().pending_owner, Some(dao()));
    assert_eq!(v.get_status().owner, owner(), "nothing changes until the DAO accepts");
    ctx(dao(), 1, NOW + 1);
    v.accept_owner();
    let s = v.get_status();
    assert_eq!(s.owner, dao());
    assert_eq!(s.pending_owner, None);
    // The DAO now runs the vault; its proposals arrive as calls from the DAO account.
    ctx(dao(), 1, NOW + 2);
    v.pause();
    assert!(v.get_status().paused);
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn the_old_owner_loses_control_after_the_handover() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(dao()));
    ctx(dao(), 1, NOW + 1);
    v.accept_owner();
    ctx(owner(), 1, NOW + 2);
    v.pause();
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn attack_a31_a_stranger_cannot_offer_the_vault() {
    let mut v = new_vault();
    ctx(attacker(), 1, NOW);
    v.propose_owner(Some(attacker()));
}

#[test]
#[should_panic(expected = "ERR_NOT_NEW_OWNER")]
fn attack_a32_a_stranger_cannot_accept_an_offer_made_to_someone_else() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(dao()));
    ctx(attacker(), 1, NOW + 1);
    v.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_NOT_NEW_OWNER")]
fn attack_a33_nobody_can_accept_when_no_offer_is_open() {
    let mut v = new_vault();
    ctx(attacker(), 1, NOW);
    v.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_ONE_YOCTO")]
fn accepting_needs_a_full_access_signature() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(dao()));
    ctx(dao(), 0, NOW + 1);
    v.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_NOT_NEW_OWNER")]
fn a_withdrawn_offer_cannot_be_accepted() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(dao()));
    ctx(owner(), 1, NOW + 1);
    v.propose_owner(None);
    assert_eq!(v.get_status().pending_owner, None);
    ctx(dao(), 1, NOW + 2);
    v.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_SAME_OWNER")]
fn offering_the_vault_to_its_owner_is_refused() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.propose_owner(Some(owner()));
}

#[test]
#[should_panic(expected = "ERR_ONE_YOCTO")]
fn offering_needs_a_full_access_signature() {
    let mut v = new_vault();
    ctx(owner(), 0, NOW);
    v.propose_owner(Some(dao()));
}

const POLICY: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

#[test]
fn a_policy_reference_is_written_to_the_vaults_log() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.set_limits(limits(), Some(POLICY.into()));
    v.set_plan(plan(), Some(POLICY.into()));
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|l| l.contains("limits_updated") && l.contains(POLICY)), "{logs:?}");
    assert!(logs.iter().any(|l| l.contains("plan_updated") && l.contains(POLICY)), "{logs:?}");
}

#[test]
#[should_panic(expected = "ERR_POLICY_REF")]
fn attack_a34_a_policy_reference_cannot_smuggle_text_into_the_log() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.set_limits(limits(), Some(r#"x","admin":"attacker"#.into()));
}

#[test]
#[should_panic(expected = "ERR_POLICY_REF")]
fn a_policy_reference_must_be_lowercase_hex() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    v.set_plan(plan(), Some(POLICY.to_uppercase()));
}

#[test]
#[should_panic(expected = "ERR_TOKEN")]
fn attack_a35_a_token_name_cannot_inject_fields_into_the_withdraw_log() {
    let mut v = new_vault();
    ctx(owner(), 1, NOW);
    let _ = v.withdraw(r#"x","to":"attacker.near"#.into(), U128(1), owner());
}

#[test]
fn real_intents_token_ids_are_accepted() {
    for t in [USDC, BTC, "nep245:v2_1.omni.hot.tg:56_11111111111111111111", "nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near"] {
        assert!(valid_token(t), "{t}");
    }
}

// ───────────── Known limits ─────────────
//
// These tests pass on today's behaviour. They pin down where the published loss bound stops holding, so the
// docs/DESIGN.md can point at code instead of prose. None of them moves money anywhere but the vault:
// they are about how much a stolen keeper key could waste in swap costs, not about where funds can go.
//
// Model: every token has 6 decimals and is worth exactly $1, so a balance is its value in micro-dollars.

const E6: u128 = 1_000_000;
const TOK_A: &str = "nep141:a.near";
const TOK_B: &str = "nep141:b.near";
const TOK_C: &str = "nep141:c.near";

fn dollar_vault(weights: &[(&str, u16)]) -> Vault {
    ctx(owner(), 0, NOW);
    let plan = weights.iter().map(|(t, w)| Target { token: (*t).into(), target_bps: *w, decimals: 6, max_slippage_bps: None }).collect();
    Vault::new(owner(), plan, limits(), None, None, None)
}
/// A quote at a perfectly fair price: `usd` dollars in, the same value out.
fn fair(sell: &str, buy: &str, usd: u128) -> QuoteTerms {
    QuoteTerms {
        sell: sell.into(),
        buy: buy.into(),
        amount_in: U128(usd * E6),
        amount_out: U128(usd * E6),
        min_out: U128(usd * E6),
        in_usd_e6: U128(usd * E6),
        out_usd_e6: U128(usd * E6),
        deposit_address: deposit_addr(),
        quoted_ns: 1,
    }
}
fn refusal(v: &Vault, balances: &[u128], q: &QuoteTerms, prices: &[Price]) -> Option<String> {
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        v.policy_check(balances, q, prices);
    }));
    std::panic::set_hook(hook);
    r.err().map(|e| e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default())
}
fn dollar(token: &str) -> Price {
    Price { token: token.into(), usd_e6: U128(E6) }
}

/// With two assets the rules close the loop: once a trade brings the mix back, the reverse trade is refused.
#[test]
fn two_assets_a_trade_cannot_be_reversed() {
    let v = dollar_vault(&[(TOK_A, 5_000), (TOK_B, 5_000)]);
    assert_eq!(refusal(&v, &[6_000 * E6, 4_000 * E6], &fair(TOK_A, TOK_B, 1_000), &[]), None);
    let back = refusal(&v, &[5_000 * E6, 5_000 * E6], &fair(TOK_B, TOK_A, 1_000), &[]);
    assert!(back.unwrap().contains(ERR_NOT_OVER_BAND));
}

/// Known limit: with three or more assets, the bought asset may end far above its own target (only the sold
/// asset is kept from overshooting). The next trade can then sell it straight back, at honest prices, so a
/// stolen key could keep trading every interval and pay swap costs each time. A fix needs a new vault version:
/// refuse a buy that takes the bought asset past its target by more than the band.
#[test]
fn known_limit_three_assets_a_trade_can_be_reversed_by_the_next_one() {
    let v = dollar_vault(&[(TOK_A, 6_000), (TOK_B, 2_000), (TOK_C, 2_000)]);
    // A 4.9 points under, B 7.4 over, C 2.5 under. Selling $999 of B for C is allowed...
    assert_eq!(refusal(&v, &[5_509 * E6, 2_740 * E6, 1_750 * E6], &fair(TOK_B, TOK_C, 999), &[dollar(TOK_A)]), None);
    // ...and leaves C 7.5 points over target, so the opposite trade is allowed next.
    assert_eq!(refusal(&v, &[5_509 * E6, 1_741 * E6, 2_749 * E6], &fair(TOK_C, TOK_B, 999), &[dollar(TOK_A)]), None);
}

/// Known limit: the prices of plan assets outside the trade come from the keeper, and the vault can only check
/// that they are above zero. A false price for the third asset can make a trade pass that honest prices refuse:
/// here, selling an asset that is already under target. The two traded assets are still priced by the signed quote.
#[test]
fn known_limit_a_false_third_price_can_pass_a_trade_honest_prices_refuse() {
    let v = dollar_vault(&[(TOK_A, 6_000), (TOK_B, 2_000), (TOK_C, 2_000)]);
    let balances = [5_600 * E6, 1_300 * E6, 3_100 * E6]; // A is 4 points under target
    let q = fair(TOK_A, TOK_B, 850);
    assert!(refusal(&v, &balances, &q, &[dollar(TOK_C)]).unwrap().contains(ERR_NOT_OVER_BAND));
    let lie = Price { token: TOK_C.into(), usd_e6: U128(548_000) }; // C "worth" $0.548
    assert_eq!(refusal(&v, &balances, &q, &[lie]), None);
}

/// What a false price for an untraded asset cannot do: make a trade bigger than the per-trade limit. The sold
/// asset has to look over its band, so the vault's own total can't be more than (sold holding) / (target + band).
/// While that holding is really inside its band, this is at most the vault's real value, whatever price is given.
#[test]
fn three_assets_a_false_price_cannot_raise_the_size_of_a_trade() {
    let v = dollar_vault(&[(TOK_A, 6_000), (TOK_B, 2_000), (TOK_C, 2_000)]);
    let balances = [6_200 * E6, 2_100 * E6, 1_700 * E6]; // $10,000, every holding inside its 5-point band
    let cap = 1_000; // the 10% per-trade limit, in dollars of the real value

    // A lie does get a trade through here that honest prices refuse: with B "worth" $0.50, A looks 9 points over.
    assert!(refusal(&v, &balances, &fair(TOK_A, TOK_C, 895), &[dollar(TOK_B)]).unwrap().contains(ERR_NOT_OVER_BAND));
    let lie = [Price { token: TOK_B.into(), usd_e6: U128(500_000) }];
    assert_eq!(refusal(&v, &balances, &fair(TOK_A, TOK_C, 895), &lie), None);
    // But the lie made the vault look smaller ($8,950), so the limit bites sooner than at honest prices, not later.
    assert!(refusal(&v, &balances, &fair(TOK_A, TOK_C, 896), &lie).unwrap().contains(ERR_TOO_BIG));

    // No price for the third asset, from $0.000001 to $5,000,000, lets any pair trade more than the limit.
    let tokens = [TOK_A, TOK_B, TOK_C];
    for sell in tokens {
        for buy in tokens.into_iter().filter(|t| *t != sell) {
            let third = tokens.into_iter().find(|t| *t != sell && *t != buy).unwrap();
            for exp in 0..=12u32 {
                for mult in [1u128, 2, 5] {
                    let price = [Price { token: third.into(), usd_e6: U128(mult * 10u128.pow(exp)) }];
                    for usd in [cap + 1, 2 * cap, 5 * cap] {
                        let r = refusal(&v, &balances, &fair(sell, buy, usd), &price);
                        assert!(r.is_some(), "{sell} -> {buy} for ${usd} passed with {third} at {} micro-dollars", price[0].usd_e6.0);
                    }
                }
            }
        }
    }
}

/// Known limit: with three or more assets the per-trade limit holds only while the sold holding is really inside
/// its band. One trade let through by a false price can push the bought holding out of its band; after that the
/// vault's own total can be overstated, and a later trade can be bigger than the limit. Here, from a $10,000 vault
/// with a $1,000 limit, five trades pass that honest prices refuse: four of them add up to $4,070 (the limit
/// allows $4,000 a day), and the fifth is $1,460. Each still loses at most the price limit on what it moves.
#[test]
fn known_limit_three_assets_false_prices_over_several_trades_can_exceed_the_size_limit() {
    let v = dollar_vault(&[(TOK_A, 6_000), (TOK_B, 2_000), (TOK_C, 2_000)]);
    let tokens = [TOK_A, TOK_B, TOK_C];
    let mut balances = [6_200 * E6, 2_100 * E6, 1_700 * E6]; // every holding inside its band
    let trades = [(0usize, 2usize, 950u128), (2, 1, 1_055), (0, 2, 805), (1, 2, 1_260), (2, 0, 1_460)];

    for (sell, buy, usd) in trades {
        let third = 3 - sell - buy;
        let q = fair(tokens[sell], tokens[buy], usd);
        assert!(refusal(&v, &balances, &q, &[dollar(tokens[third])]).is_some(), "honest prices allow ${usd}");
        // Some price for the third asset, between $0.001 and $1,000, lets it through.
        let mut micro = 1_000u128;
        let passed = loop {
            let lie = [Price { token: tokens[third].into(), usd_e6: U128(micro) }];
            if refusal(&v, &balances, &q, &lie).is_none() {
                break true;
            }
            micro += micro / 1_000 + 1;
            if micro > 1_000_000_000 {
                break false;
            }
        };
        assert!(passed, "no false price lets ${usd} of {} through", tokens[sell]);
        balances[sell] -= usd * E6;
        balances[buy] += usd * E6;
    }
}

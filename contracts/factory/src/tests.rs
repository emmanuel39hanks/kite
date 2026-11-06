use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

fn factory_id() -> AccountId {
    "kitevaults.near".parse().unwrap()
}
fn dao() -> AccountId {
    "treasury.sputnik-dao.near".parse().unwrap()
}
fn ctx(predecessor: AccountId, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(factory_id())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .build());
}
fn factory() -> Factory {
    ctx(factory_id(), NearToken::from_yoctonear(0));
    Factory::new(None)
}
fn plan() -> Value {
    serde_json::json!([{ "token": "nep141:wrap.near", "weight_bps": 10000 }])
}
fn limits() -> Value {
    serde_json::json!({ "band_bps": 500 })
}
fn one_near() -> NearToken {
    NearToken::from_millinear(2_600)
}

#[test]
fn names() {
    for ok in ["treasury", "ab", "dao-2026", "my_vault", "a1"] {
        assert!(valid_name(ok), "{ok}");
    }
    for bad in ["", "a", "Treasury", "a.b", "-ab", "ab-", "a--b", "a-_b", "has space", "ünï", &"x".repeat(33)] {
        assert!(!valid_name(bad), "{bad}");
    }
}

#[test]
fn creates_and_records_for_the_caller() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    let e = f.get_vault("treasury.kitevaults.near".parse().unwrap()).unwrap();
    assert_eq!(e.creator, dao());
    assert_eq!(f.get_config().vaults, 1);
    assert_eq!(f.get_vaults_by(dao(), None, None).len(), 1);
}

#[test]
#[should_panic(expected = "ERR_TAKEN")]
fn a_name_is_used_once() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    ctx("someone.near".parse().unwrap(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
}

#[test]
#[should_panic(expected = "ERR_NAME")]
fn refuses_a_dotted_name() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("a.b".into(), plan(), limits(), None);
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT")]
fn refuses_too_little() {
    let mut f = factory();
    ctx(dao(), NearToken::from_millinear(2_599));
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT")]
fn refuses_too_much() {
    let mut f = factory();
    ctx(dao(), NearToken::from_millinear(5_001));
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
}

#[test]
#[should_panic(expected = "ERR_ARGS")]
fn refuses_a_plan_that_isnt_a_list() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), serde_json::json!({}), limits(), None);
}

fn callback(f: &mut Factory, ok: bool) -> PromiseOrValue<bool> {
    callback_with_balance(f, ok, NearToken::from_near(100))
}
fn callback_with_balance(f: &mut Factory, ok: bool, balance: NearToken) -> PromiseOrValue<bool> {
    testing_env!(
        VMContextBuilder::new().current_account_id(factory_id()).predecessor_account_id(factory_id()).account_balance(balance).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }],
    );
    let r = if ok { Ok(()) } else { Err(PromiseError::Failed) };
    f.on_vault_created("treasury.kitevaults.near".parse().unwrap(), dao(), U128(one_near().as_yoctonear()), r)
}

#[test]
fn success_keeps_the_record_and_logs() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    assert!(matches!(callback(&mut f, true), PromiseOrValue::Value(true)));
    assert_eq!(f.get_config().vaults, 1);
    assert!(get_logs().iter().any(|l| l.contains("vault_created") && l.contains("treasury.sputnik-dao.near")));
}

#[test]
fn failure_forgets_the_name_so_it_can_be_tried_again() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    assert!(matches!(callback(&mut f, false), PromiseOrValue::Promise(_)), "a failure is reported as a failure, not as false");
    assert_eq!(f.get_config().vaults, 0);
    assert!(f.get_vaults_by(dao(), None, None).is_empty(), "the creator's index forgets it too");
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
}

#[test]
fn the_code_it_deploys_is_the_shipped_vault() {
    let f = factory();
    let c = f.get_config();
    assert_eq!(c.vault_code_bytes as usize, VAULT_CODE.len());
    assert!(VAULT_CODE.starts_with(b"\0asm"), "a wasm module");
    let want: [u8; 32] = env::sha256(VAULT_CODE).try_into().unwrap();
    assert_eq!(c.vault_code_hash, Base58CryptoHash::from(want));
}

/// If the failed batch's NEAR hasn't come back yet, the refund is owed instead of lost.
#[test]
fn a_refund_the_factory_cant_pay_yet_is_owed_and_claimable() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    assert!(matches!(callback_with_balance(&mut f, false, NearToken::from_millinear(10)), PromiseOrValue::Promise(_)));
    assert_eq!(f.get_refund(dao()).0, one_near().as_yoctonear());
    assert!(get_logs().iter().any(|l| l.contains("refund_owed")));
    // Later, with the NEAR back, the DAO claims it, once.
    testing_env!(VMContextBuilder::new().current_account_id(factory_id()).predecessor_account_id(dao()).account_balance(NearToken::from_near(100)).build());
    let _ = f.claim_refund();
    assert_eq!(f.get_refund(dao()).0, 0);
}

#[test]
#[should_panic(expected = "ERR_NO_REFUND")]
fn nothing_to_claim() {
    let mut f = factory();
    ctx(dao(), NearToken::from_yoctonear(0));
    let _ = f.claim_refund();
}

#[test]
#[should_panic(expected = "ERR_NOT_YET")]
fn a_claim_waits_for_the_refund_to_arrive() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    let _ = callback_with_balance(&mut f, false, NearToken::from_millinear(10));
    testing_env!(VMContextBuilder::new().current_account_id(factory_id()).predecessor_account_id(dao()).account_balance(NearToken::from_millinear(10)).build());
    let _ = f.claim_refund();
}

#[test]
fn a_refund_it_can_pay_is_sent_at_once() {
    let mut f = factory();
    ctx(dao(), one_near());
    let _ = f.create_vault("treasury".into(), plan(), limits(), None);
    let _ = callback(&mut f, false);
    assert_eq!(f.get_refund(dao()).0, 0);
}

#[test]
#[should_panic(expected = "ERR_NOT_CREATED")]
fn the_last_step_of_a_failure_is_an_error() {
    let f = factory();
    f.fail_creation();
}

#[test]
fn a_creators_vaults_are_indexed_without_scanning_everyone_elses() {
    let mut f = factory();
    for (who, name) in [("a.near", "aa"), ("b.near", "bb"), ("a.near", "ac")] {
        ctx(who.parse().unwrap(), one_near());
        let _ = f.create_vault(name.into(), plan(), limits(), None);
    }
    let a: Vec<String> = f.get_vaults_by("a.near".parse().unwrap(), None, None).into_iter().map(|e| e.vault.to_string()).collect();
    assert_eq!(a, vec!["aa.kitevaults.near", "ac.kitevaults.near"]);
    assert_eq!(f.get_vaults_by("a.near".parse().unwrap(), Some(1), Some(1)).len(), 1);
    assert!(f.get_vaults_by("nobody.near".parse().unwrap(), None, None).is_empty());
}

/// A refund that bounces (the account was deleted meanwhile) is owed again instead of stranded.
#[test]
fn a_bounced_refund_is_owed_again() {
    let mut f = factory();
    testing_env!(
        VMContextBuilder::new().current_account_id(factory_id()).predecessor_account_id(factory_id()).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed],
    );
    f.on_refund_sent(dao(), U128(one_near().as_yoctonear()), Err(PromiseError::Failed));
    assert_eq!(f.get_refund(dao()).0, one_near().as_yoctonear());
}

//! Kite vault factory.
//!
//! `create_vault` makes `<name>.<factory>`, deploys the Kite vault code this factory was built with, and
//! initialises it with the caller as owner. A DAO calls it through a proposal, so the DAO owns its vault from
//! the first block and no person ever holds it.
//!
//! The factory has no owner, no admin method and no upgrade path. The vault code is compiled into it, so once
//! its keys are deleted nobody can change what it creates: every vault in `get_vaults` runs the code whose
//! sha256 is `vault_code_hash`, the same file as `apps/web/public/vault/kite_vault.wasm`.

use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::{self, Value};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey};

#[cfg(test)]
mod tests;

/// The Kite vault, byte for byte the file the app deploys from a wallet.
pub const VAULT_CODE: &[u8] = include_bytes!("../../../apps/web/public/vault/kite_vault.wasm");

/// A vault stores its own code, about 2.39 NEAR at NEAR's storage price, plus its state, plus gas for Kite's
/// daily check (about 0.002 NEAR a rebalance). The same as a vault created from a wallet. What gas leaves goes back
/// to the owner when the vault is closed.
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(2_600);
/// The most one call may attach. More can be sent to the vault directly afterwards.
pub const MAX_DEPOSIT: NearToken = NearToken::from_near(5);
/// Gas allowance on Kite's key, the same as on vaults created from a wallet.
pub const AGENT_ALLOWANCE: NearToken = NearToken::from_millinear(250);
/// The longest `<name>` part. With `.kitevaults.near` that stays well under NEAR's 64-character limit.
pub const MAX_NAME: usize = 32;

const GAS_INIT: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(20);

pub const ERR_NAME: &str = "ERR_NAME: a vault name is 2 to 32 lowercase letters, digits, - or _, starting and ending with a letter or digit";
pub const ERR_TAKEN: &str = "ERR_TAKEN: a vault with this name already exists";
pub const ERR_DEPOSIT: &str = "ERR_DEPOSIT: attach between 2.6 and 5 NEAR";
pub const ERR_ARGS: &str = "ERR_ARGS: plan must be a list and limits an object";
pub const ERR_NO_REFUND: &str = "ERR_NO_REFUND: nothing to claim";
pub const ERR_NOT_CREATED: &str = "ERR_NOT_CREATED: the vault couldn't be created; the deposit was refunded or is claimable with claim_refund";

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct VaultEntry {
    pub vault: AccountId,
    /// Whoever called `create_vault`. The vault can change hands later; its own `get_status` is the truth.
    pub creator: AccountId,
    pub created_ns: u64,
}

#[near(serializers = [json])]
pub struct Config {
    /// base58 sha256 of the vault code this factory deploys. Equal to the code hash NEAR reports for every vault it made.
    pub vault_code_hash: Base58CryptoHash,
    pub vault_code_bytes: u32,
    pub intents: AccountId,
    pub min_deposit: U128,
    pub max_deposit: U128,
    pub agent_allowance: U128,
    pub vaults: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    intents: AccountId,
    vaults: IterableMap<AccountId, VaultEntry>,
    /// Each creator's vaults, so looking them up never scans the whole registry.
    by_creator: LookupMap<AccountId, Vec<AccountId>>,
    /// Deposits from failed creations that couldn't be sent back at once. Their owner can claim them.
    refunds: LookupMap<AccountId, NearToken>,
}

#[near]
impl Factory {
    /// Fixes the NEAR Intents contract, forever. The vault code is already fixed: it's compiled in.
    #[init]
    #[private]
    pub fn new(intents: Option<AccountId>) -> Self {
        Self {
            intents: intents.unwrap_or_else(|| "intents.near".parse().unwrap()),
            vaults: IterableMap::new(b"v"),
            by_creator: LookupMap::new(b"c"),
            refunds: LookupMap::new(b"r"),
        }
    }

    /// Create `<name>.<factory>` owned by the caller, holding `plan` within `limits`. `agent` is Kite's key; it
    /// can only call `rebalance` and `settle`. The whole deposit funds the vault, less the few bytes this
    /// factory spends recording it. If anything fails, the vault doesn't exist and the deposit comes back.
    #[payable]
    pub fn create_vault(&mut self, name: String, plan: Value, limits: Value, agent: Option<PublicKey>) -> Promise {
        require!(valid_name(&name), ERR_NAME);
        let vault: AccountId = format!("{name}.{}", env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str(ERR_NAME));
        require!(!self.vaults.contains_key(&vault), ERR_TAKEN);
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT && deposit <= MAX_DEPOSIT, ERR_DEPOSIT);
        require!(plan.is_array() && limits.is_object(), ERR_ARGS);
        let owner = env::predecessor_account_id();

        // Record it first, so a second call for the same name before this one finishes is refused,
        // and charge the caller for the bytes it takes here.
        let before = env::storage_usage();
        self.vaults.insert(vault.clone(), VaultEntry { vault: vault.clone(), creator: owner.clone(), created_ns: env::block_timestamp() });
        let mut mine = self.by_creator.get(&owner).cloned().unwrap_or_default();
        mine.push(vault.clone());
        self.by_creator.insert(owner.clone(), mine);
        self.vaults.flush();
        self.by_creator.flush();
        let cost = env::storage_byte_cost().saturating_mul(env::storage_usage().saturating_sub(before) as u128);
        let funding = deposit.saturating_sub(cost);

        let mut init = serde_json::Map::new();
        init.insert("owner".into(), Value::String(owner.to_string()));
        init.insert("plan".into(), plan);
        init.insert("limits".into(), limits);
        init.insert("agent".into(), agent.as_ref().map_or(Value::Null, |k| Value::String(String::from(k))));
        init.insert("intents".into(), Value::String(self.intents.to_string()));

        // One batch: if any step fails, none of it happened and the attached NEAR returns to the factory.
        let mut p = Promise::new(vault.clone())
            .create_account()
            .transfer(funding)
            .deploy_contract(VAULT_CODE.to_vec())
            .function_call("new", serde_json::to_vec(&init).unwrap(), NearToken::from_yoctonear(0), GAS_INIT);
        if let Some(key) = agent {
            p = p.add_access_key_allowance(key, Allowance::limited(AGENT_ALLOWANCE).unwrap(), vault.clone(), "rebalance,settle");
        }
        p.then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_vault_created(vault, owner, U128(deposit.as_yoctonear())))
    }

    /// After the vault's creation: keep the record, or undo it and give the caller their whole deposit back.
    ///
    /// A failure must *look* like a failure to the caller. A DAO marks a proposal Approved whenever the call
    /// returns without an error, so returning `false` would record "vault created" for a vault that doesn't
    /// exist. Panicking here would undo the refund. So the refund goes out first, and a second receipt fails.
    #[private]
    pub fn on_vault_created(&mut self, vault: AccountId, owner: AccountId, deposit: U128, #[callback_result] result: Result<(), PromiseError>) -> PromiseOrValue<bool> {
        if result.is_ok() {
            env::log_str(&format!(r#"EVENT_JSON:{{"standard":"kite_factory","version":"1.0.0","event":"vault_created","data":[{{"vault":"{vault}","owner":"{owner}"}}]}}"#));
            return PromiseOrValue::Value(true);
        }
        self.vaults.remove(&vault);
        if let Some(mut mine) = self.by_creator.get(&owner).cloned() {
            mine.retain(|v| v != &vault);
            if mine.is_empty() {
                self.by_creator.remove(&owner);
            } else {
                self.by_creator.insert(owner.clone(), mine);
            }
        }
        self.vaults.flush();
        self.by_creator.flush();
        let deposit = NearToken::from_yoctonear(deposit.0);
        // The failed batch sends its NEAR back to the factory in a refund receipt that may land after this. Pay
        // now if the factory can; otherwise keep it for the owner to claim, so it can never be stranded here.
        let fail = Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(3)).fail_creation();
        if self.spare() >= deposit {
            return PromiseOrValue::Promise(self.send_refund(owner, deposit).then(fail));
        }
        self.owe(&owner, deposit);
        PromiseOrValue::Promise(fail)
    }

    /// A refund that couldn't be delivered (the account was deleted meanwhile) is owed again, never stranded.
    #[private]
    pub fn on_refund_sent(&mut self, owner: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            self.owe(&owner, NearToken::from_yoctonear(amount.0));
        }
    }

    /// The last step of a failed creation: an error the caller (and a DAO's proposal) sees.
    #[private]
    pub fn fail_creation(&self) {
        env::panic_str(ERR_NOT_CREATED)
    }

    /// Send a refund the factory owes the caller (see `on_vault_created`). A DAO claims through a proposal.
    pub fn claim_refund(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let owed = self.refunds.remove(&who).unwrap_or_else(|| env::panic_str(ERR_NO_REFUND));
        require!(self.spare() >= owed, "ERR_NOT_YET: the refund hasn't reached the factory yet; try again in a few blocks");
        self.send_refund(who, owed)
    }

    /* ───────────── views ───────────── */

    pub fn get_config(&self) -> Config {
        Config {
            vault_code_hash: Base58CryptoHash::from(<[u8; 32]>::try_from(env::sha256(VAULT_CODE)).unwrap()),
            vault_code_bytes: VAULT_CODE.len() as u32,
            intents: self.intents.clone(),
            min_deposit: U128(MIN_DEPOSIT.as_yoctonear()),
            max_deposit: U128(MAX_DEPOSIT.as_yoctonear()),
            agent_allowance: U128(AGENT_ALLOWANCE.as_yoctonear()),
            vaults: self.vaults.len(),
        }
    }

    /// Every vault this factory created. Roughly oldest first: a failed creation's slot is refilled by the newest entry.
    pub fn get_vaults(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<VaultEntry> {
        self.vaults.values().skip(from_index.unwrap_or(0) as usize).take(limit.unwrap_or(50).min(100) as usize).cloned().collect()
    }

    /// The vaults a given account created, in the order it created them.
    pub fn get_vaults_by(&self, creator: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<VaultEntry> {
        let Some(mine) = self.by_creator.get(&creator) else { return vec![] };
        mine.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|v| self.vaults.get(v).cloned())
            .collect()
    }

    pub fn get_vault(&self, vault: AccountId) -> Option<VaultEntry> {
        self.vaults.get(&vault).cloned()
    }

    pub fn get_refund(&self, owner: AccountId) -> U128 {
        U128(self.refunds.get(&owner).map_or(0, |n| n.as_yoctonear()))
    }
}

impl Factory {
    fn owe(&mut self, owner: &AccountId, amount: NearToken) {
        let owed = self.refunds.get(owner).copied().unwrap_or(NearToken::from_yoctonear(0)).saturating_add(amount);
        self.refunds.insert(owner.clone(), owed);
        env::log_str(&format!(r#"EVENT_JSON:{{"standard":"kite_factory","version":"1.0.0","event":"refund_owed","data":[{{"owner":"{owner}","amount":"{}"}}]}}"#, amount.as_yoctonear()));
    }

    fn send_refund(&self, to: AccountId, amount: NearToken) -> Promise {
        Promise::new(to.clone()).transfer(amount).then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_refund_sent(to, U128(amount.as_yoctonear())))
    }

    /// NEAR the factory holds beyond what its own storage locks.
    fn spare(&self) -> NearToken {
        let locked = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance().saturating_sub(locked)
    }
}

/// 2 to 32 of `a-z 0-9 - _`, starting and ending with a letter or digit, no doubled separators. No dots, so
/// the vault is always a direct child of the factory.
pub fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    let alnum = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    (2..=MAX_NAME).contains(&b.len())
        && alnum(b[0])
        && alnum(b[b.len() - 1])
        && b.iter().all(|&c| alnum(c) || c == b'-' || c == b'_')
        && !b.windows(2).any(|w| !alnum(w[0]) && !alnum(w[1]))
}

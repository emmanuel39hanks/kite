//! A stand-in for `intents.near` in sandbox tests: just enough of the NEP-245 multi-token
//! interface for the vault (balances, transfers), plus test switches. Never deployed to mainnet.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockIntents {
    balances: LookupMap<(AccountId, String), u128>,
    fail_transfers: bool,
}

#[near]
impl MockIntents {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b"), fail_transfers: false }
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.into_iter().map(|t| U128(self.get(&account_id, &t))).collect()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        #[allow(unused_variables)] approval: Option<(AccountId, u128)>,
        #[allow(unused_variables)] memo: Option<String>,
    ) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Requires attached deposit of exactly 1 yoctoNEAR");
        require!(!self.fail_transfers, "mock: transfers are switched off");
        let from = env::predecessor_account_id();
        let have = self.get(&from, &token_id);
        require!(have >= amount.0, "mock: insufficient balance");
        self.balances.insert((from, token_id.clone()), have - amount.0);
        let to = self.get(&receiver_id, &token_id);
        self.balances.insert((receiver_id, token_id), to + amount.0);
    }

    /// Test helper: set a balance directly (stands in for deposits and swap settlement).
    pub fn set_balance(&mut self, account_id: AccountId, token_id: String, amount: U128) {
        self.balances.insert((account_id, token_id), amount.0);
    }

    /// Test helper: make every mt_transfer fail, to exercise the vault's failure callbacks.
    pub fn set_fail_transfers(&mut self, fail: bool) {
        self.fail_transfers = fail;
    }
}

impl MockIntents {
    fn get(&self, account: &AccountId, token: &str) -> u128 {
        self.balances.get(&(account.clone(), token.to_string())).copied().unwrap_or(0)
    }
}

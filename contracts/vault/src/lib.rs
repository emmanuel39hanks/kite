//! Kite vault.
//!
//! One vault per user, deployed at `kite.<owner>`. The vault account owns the
//! user's balances inside NEAR Intents (`intents.near`), so every asset (nBTC,
//! ETH, SOL, USDC, XAUt…) sits in one ledger the vault controls by direct calls.
//!
//! Two kinds of caller:
//! - **Owner** (`predecessor == owner`, 1 yocto attached): changes the plan and
//!   limits, pauses, withdraws, adds or revokes the agent key.
//! - **Agent**: a function-call access key on the vault account itself, limited
//!   by the protocol to `rebalance` and `settle`. Calls through it arrive with
//!   `predecessor == current_account_id`. The agent can never withdraw.
//!
//! `rebalance` takes a quote **signed by NEAR Intents 1Click** and checks the
//! signature on-chain. Every economic term of the trade comes from that signed
//! quote: what is sold and bought, how much, the deposit address, the minimum
//! out, the USD values, and that the output and any refund come back to this
//! vault. The agent can't choose where money goes. Then it reads balances from
//! `intents.near`, checks the trade against the plan and limits (in the
//! callback), and moves the sell amount to the 1Click deposit address. `settle`
//! later confirms what came back and trips a circuit breaker (pauses the
//! vault) if the swap fell short.

use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PublicKey,
};

mod errors;
pub use errors::*;

const BPS: u128 = 10_000;
const NS_PER_SEC: u64 = 1_000_000_000;
const DAY_SECS: u64 = 86_400;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_CALLBACK: Gas = Gas::from_tgas(60);
const AGENT_METHODS: &str = "rebalance,settle";
/// The key NEAR Intents 1Click signs quotes with (published in its SDK as ONE_CLICK_MANAGER_PUB_KEY).
const ONE_CLICK_SIGNER: &str = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
/// A signed quote is only usable this long after 1Click issued it.
const QUOTE_MAX_AGE_SECS: u64 = 300;

/// One asset in the plan.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    /// NEAR Intents token id, e.g. `nep141:nbtc.bridge.near`.
    pub token: String,
    /// Share of the portfolio in basis points. All targets sum to 10_000.
    pub target_bps: u16,
    /// Token decimals, used to value balances.
    pub decimals: u8,
    /// A looser price limit for this asset, in bps, when it costs more to trade
    /// (yield tokens like stNEAR or wstETH). A trade uses the widest of the global
    /// limit and the limits of the two assets it touches. At most 500 bps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_slippage_bps: Option<u16>,
}

/// Limits the agent must respect. Only the owner can change them.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Limits {
    /// Kite may only sell an asset at least this far above its target (bps of NAV).
    pub band_bps: u16,
    /// Largest single trade, as bps of NAV.
    pub max_trade_bps: u16,
    /// `min_out` must be within this many bps of the value-equivalent amount.
    pub max_slippage_bps: u16,
    /// Most trades per UTC day.
    pub max_trades_per_day: u8,
    /// Minimum seconds between two trades.
    pub min_interval_secs: u64,
    /// Seconds a swap may stay pending before `settle` treats a shortfall as a failure.
    pub settle_window_secs: u64,
}

impl Limits {
    fn validate(&self) {
        require!((100..=2_000).contains(&self.band_bps), ERR_LIMITS);
        require!((100..=5_000).contains(&self.max_trade_bps), ERR_LIMITS);
        require!((10..=500).contains(&self.max_slippage_bps), ERR_LIMITS);
        require!((1..=24).contains(&self.max_trades_per_day), ERR_LIMITS);
        require!(self.min_interval_secs <= 86_400, ERR_LIMITS);
        require!(self.settle_window_secs >= 60 && self.settle_window_secs <= 86_400, ERR_LIMITS);
    }
}

/// A USD price for one token, supplied by the agent. Fixed point, 6 decimals ($1 = 1_000_000).
/// Only used to measure drift. The two assets in a trade are valued from the signed quote instead.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Price {
    pub token: String,
    pub usd_e6: U128,
}

/// One slice of an owner-signed allocation: send `amount` of `token` to `to`
/// (a 1Click deposit address whose output comes back to this vault).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Transfer {
    pub token: String,
    pub amount: U128,
    pub to: AccountId,
}

/// A swap that has left the vault and not yet been settled.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub sell: String,
    pub buy: String,
    pub amount_in: U128,
    pub min_out: U128,
    pub sell_before: U128,
    pub buy_before: U128,
    pub deposit_address: AccountId,
    pub started_ns: u64,
}

#[near(serializers = [json])]
pub struct Status {
    pub owner: AccountId,
    pub agent: Option<PublicKey>,
    pub paused: bool,
    pub pending: Option<Pending>,
    pub trades_today: u8,
    pub last_trade_ns: u64,
}

#[ext_contract(ext_intents)]
#[allow(dead_code)]
trait Intents {
    fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128>;
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u128)>,
        memo: Option<String>,
    );
    fn ft_withdraw(
        &mut self,
        token: AccountId,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: Option<String>,
    );
}

/// The fields of a 1Click quote the vault relies on. The full JSON is what 1Click signed;
/// fields not listed here are ignored after the signature check.
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct SignedQuote {
    pub dry: bool,
    pub swap_type: String,
    pub origin_asset: String,
    pub destination_asset: String,
    pub deposit_type: String,
    pub recipient: String,
    pub recipient_type: String,
    pub refund_to: String,
    pub refund_type: String,
    pub amount: String,
    pub amount_in: String,
    pub amount_out: String,
    pub min_amount_out: String,
    pub amount_in_usd: String,
    pub amount_out_usd: String,
    pub deposit_address: Option<String>,
    pub timestamp: String,
    // Side payments a signed request can carry. Kite never asks for any, so any non-empty value is refused.
    #[serde(default)]
    pub app_fees: Option<Vec<near_sdk::serde::de::IgnoredAny>>,
    #[serde(default)]
    pub referral: Option<String>,
    #[serde(default)]
    pub custom_recipient_msg: Option<String>,
    #[serde(default)]
    pub virtual_chain_recipient: Option<String>,
    #[serde(default)]
    pub virtual_chain_refund_recipient: Option<String>,
}

/// What the vault takes from a verified quote.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct QuoteTerms {
    pub sell: String,
    pub buy: String,
    pub amount_in: U128,
    pub amount_out: U128,
    pub min_out: U128,
    pub in_usd_e6: U128,
    pub out_usd_e6: U128,
    pub deposit_address: AccountId,
    pub quoted_ns: u64,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait SelfCallbacks {
    fn on_rebalance_balances(&mut self, terms: QuoteTerms, prices: Vec<Price>) -> bool;
    fn on_rebalance_sent(&mut self) -> bool;
    fn on_settle_balances(&mut self) -> String;
    fn on_close_balances(&mut self) -> Promise;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    agent: Option<PublicKey>,
    intents: AccountId,
    plan: Vec<Target>,
    limits: Limits,
    paused: bool,
    pending: Option<Pending>,
    day: u64,
    trades_today: u8,
    last_trade_ns: u64,
    /// Key whose signature makes a 1Click quote acceptable. The owner can rotate it.
    quote_signer: PublicKey,
    /// Timestamp of the last quote used. Each trade needs a newer one, so a quote can't be replayed.
    last_quote_ns: u64,
}

#[near]
impl Vault {
    /// Called once, in the same transaction that creates `kite.<owner>` and deploys this code.
    #[init]
    pub fn new(
        owner: AccountId,
        plan: Vec<Target>,
        limits: Limits,
        agent: Option<PublicKey>,
        intents: Option<AccountId>,
        quote_signer: Option<PublicKey>,
    ) -> Self {
        // The web flow runs `new` in the same transaction that creates the account, signed by the owner.
        require!(env::predecessor_account_id() == owner, ERR_NOT_OWNER);
        validate_plan(&plan);
        limits.validate();
        let vault = Self {
            owner,
            agent,
            intents: intents.unwrap_or_else(|| "intents.near".parse().unwrap()),
            plan,
            limits,
            paused: false,
            pending: None,
            day: 0,
            trades_today: 0,
            last_trade_ns: 0,
            quote_signer: quote_signer.unwrap_or_else(|| ONE_CLICK_SIGNER.parse().unwrap()),
            last_quote_ns: 0,
        };
        emit("vault_created", &format!(r#"{{"owner":"{}"}}"#, vault.owner));
        vault
    }

    /* ───────────── owner ───────────── */

    /// Rotate the key 1Click signs quotes with, if 1Click ever changes it.
    #[payable]
    pub fn set_quote_signer(&mut self, public_key: PublicKey) {
        self.assert_owner();
        require!(public_key.curve_type() == near_sdk::CurveType::ED25519, ERR_QUOTE_SIG);
        self.quote_signer = public_key;
        emit("quote_signer_set", "{}");
    }

    #[payable]
    pub fn set_plan(&mut self, plan: Vec<Target>) {
        self.assert_owner();
        require!(self.pending.is_none(), ERR_PENDING);
        validate_plan(&plan);
        self.plan = plan;
        emit("plan_updated", "{}");
    }

    #[payable]
    pub fn set_limits(&mut self, limits: Limits) {
        self.assert_owner();
        limits.validate();
        self.limits = limits;
        emit("limits_updated", "{}");
    }

    #[payable]
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        emit("paused", r#"{"by":"owner"}"#);
    }

    /// Unpausing also clears a stuck pending swap; the owner has seen the balances.
    #[payable]
    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        self.pending = None;
        emit("unpaused", "{}");
    }

    /// Give Kite's worker a key that can only call `rebalance` and `settle` on this vault.
    #[payable]
    pub fn set_agent(&mut self, public_key: PublicKey, allowance_yocto: U128) -> Promise {
        self.assert_owner();
        require!(allowance_yocto.0 > 0, ERR_LIMITS);
        let allowance = Allowance::limited(NearToken::from_yoctonear(allowance_yocto.0)).unwrap_or(Allowance::Unlimited);
        let mut p = Promise::new(env::current_account_id());
        if let Some(old) = self.agent.take() {
            p = p.delete_key(old);
        }
        self.agent = Some(public_key.clone());
        emit("agent_set", "{}");
        p.add_access_key_allowance(public_key, allowance, env::current_account_id(), AGENT_METHODS.to_string())
    }

    /// Delete the agent's key from this account. Kite stops at once; funds stay put.
    #[payable]
    pub fn revoke_agent(&mut self) -> Option<Promise> {
        self.assert_owner();
        emit("agent_revoked", "{}");
        self.agent.take().map(|pk| Promise::new(env::current_account_id()).delete_key(pk))
    }

    /// Move a balance to any NEAR account inside NEAR Intents (e.g. back to the owner).
    #[payable]
    pub fn withdraw(&mut self, token: String, amount: U128, receiver_id: AccountId) -> Promise {
        self.assert_owner();
        require!(self.pending.as_ref().is_none_or(|p| p.sell != token && p.buy != token), ERR_PENDING);
        emit("withdraw", &format!(r#"{{"token":"{}","amount":"{}","to":"{}"}}"#, token, amount.0, receiver_id));
        ext_intents::ext(self.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_TRANSFER)
            .mt_transfer(receiver_id, token, amount, None, Some("kite: owner withdraw".into()))
    }

    /// Put new money to work: the owner sends slices of a balance (usually USDC)
    /// to 1Click deposit addresses that swap into the plan and pay back to this vault.
    /// Owner-signed, so it carries no more trust than `withdraw`.
    #[payable]
    pub fn allocate(&mut self, transfers: Vec<Transfer>) -> Promise {
        self.assert_owner();
        require!(!transfers.is_empty() && transfers.len() <= 8, ERR_ALLOCATE);
        let mut p: Option<Promise> = None;
        for t in transfers {
            require!(t.amount.0 > 0, ERR_ZERO);
            emit("allocate", &format!(r#"{{"token":"{}","amount":"{}","to":"{}"}}"#, t.token, t.amount.0, t.to));
            let call = ext_intents::ext(self.intents.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(Gas::from_tgas(15))
                .mt_transfer(t.to, t.token, t.amount, None, Some("kite: allocate".into()));
            p = Some(match p {
                Some(prev) => prev.and(call),
                None => call,
            });
        }
        p.unwrap()
    }

    /// Withdraw a NEP-141 out of NEAR Intents to another chain or account (`memo`/`msg` per the token's bridge).
    #[payable]
    pub fn withdraw_external(&mut self, token: AccountId, amount: U128, receiver_id: AccountId, memo: Option<String>, msg: Option<String>) -> Promise {
        self.assert_owner();
        emit("withdraw_external", &format!(r#"{{"token":"{}","amount":"{}"}}"#, token, amount.0));
        ext_intents::ext(self.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_TRANSFER)
            .ft_withdraw(token, receiver_id, amount, memo, msg)
    }

    /// Close the vault and get its storage deposit back. Pauses Kite first, then reads every
    /// balance in NEAR Intents; only if all are zero is this account deleted, sending its NEAR to
    /// the owner. A deleted account can never touch its Intents balances again, hence the check.
    /// `also_check` adds tokens outside the plan (e.g. USDC from deposits).
    #[payable]
    pub fn close_vault(&mut self, also_check: Option<Vec<String>>) -> Promise {
        self.assert_owner();
        require!(self.pending.is_none(), ERR_PENDING);
        self.paused = true;
        let tokens = self.close_tokens(also_check.unwrap_or_default());
        ext_intents::ext(self.intents.clone())
            .with_static_gas(GAS_VIEW)
            .mt_batch_balance_of(env::current_account_id(), tokens)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_close_balances())
    }

    #[private]
    pub fn on_close_balances(&mut self, #[callback_result] balances: Result<Vec<U128>, PromiseError>) -> Promise {
        let balances: Vec<u128> = balances.unwrap_or_else(|_| env::panic_str(ERR_BALANCES)).into_iter().map(|b| b.0).collect();
        self.check_close(&balances);
        emit("vault_closed", &format!(r#"{{"owner":"{}"}}"#, self.owner));
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    /* ───────────── agent ───────────── */

    /// Step 1 of a rebalance: verify 1Click's signature on the quote, check its terms,
    /// then read live balances from NEAR Intents.
    ///
    /// `quote` is the exact JSON 1Click signed (keys sorted, as its SDK builds it) and
    /// `signature` is 1Click's `ed25519:…` signature from the same response.
    pub fn rebalance(&mut self, quote: String, signature: String, prices: Vec<Price>) -> Promise {
        self.assert_agent();
        let terms = self.verify_quote(&quote, &signature, env::block_timestamp());
        self.check_can_trade(&terms.sell, &terms.buy, terms.amount_in);
        ext_intents::ext(self.intents.clone())
            .with_static_gas(GAS_VIEW)
            .mt_batch_balance_of(env::current_account_id(), self.tokens())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_rebalance_balances(terms, prices))
    }

    /// Step 2: the full policy check against real balances, then send the sell amount to 1Click.
    #[private]
    pub fn on_rebalance_balances(
        &mut self,
        #[callback_result] balances: Result<Vec<U128>, PromiseError>,
        terms: QuoteTerms,
        prices: Vec<Price>,
    ) -> Promise {
        let balances = balances.unwrap_or_else(|_| env::panic_str(ERR_BALANCES));
        // State may have changed between the two steps.
        self.check_can_trade(&terms.sell, &terms.buy, terms.amount_in);
        require!(terms.quoted_ns > self.last_quote_ns, ERR_QUOTE_REPLAY);
        let balances: Vec<u128> = balances.into_iter().map(|b| b.0).collect();
        let check = self.policy_check(&balances, &terms, &prices);

        let now = env::block_timestamp();
        self.roll_day(now);
        self.trades_today += 1;
        self.last_trade_ns = now;
        self.last_quote_ns = terms.quoted_ns;
        let QuoteTerms { sell, buy, amount_in, min_out, deposit_address, .. } = terms;
        self.pending = Some(Pending {
            sell: sell.clone(),
            buy: buy.clone(),
            amount_in,
            min_out,
            sell_before: U128(check.sell_balance),
            buy_before: U128(check.buy_balance),
            deposit_address: deposit_address.clone(),
            started_ns: now,
        });
        emit(
            "rebalance_started",
            &format!(
                r#"{{"sell":"{}","buy":"{}","amount_in":"{}","min_out":"{}","drift_bps":{},"to":"{}","quote":"signed"}}"#,
                sell, buy, amount_in.0, min_out.0, check.sell_drift_bps, deposit_address
            ),
        );
        ext_intents::ext(self.intents.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_TRANSFER)
            .mt_transfer(deposit_address, sell, amount_in, None, Some("kite: rebalance".into()))
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_VIEW).on_rebalance_sent())
    }

    #[private]
    pub fn on_rebalance_sent(&mut self, #[callback_result] sent: Result<(), PromiseError>) -> bool {
        if sent.is_err() {
            // Nothing left the vault; undo the pending swap but keep the rate-limit count.
            self.pending = None;
            emit("rebalance_failed", r#"{"reason":"transfer_failed"}"#);
            return false;
        }
        true
    }

    /// Anyone may call: confirms a pending swap, or trips the breaker if it fell short in time.
    pub fn settle(&mut self) -> Promise {
        require!(self.pending.is_some(), ERR_NO_PENDING);
        ext_intents::ext(self.intents.clone())
            .with_static_gas(GAS_VIEW)
            .mt_batch_balance_of(env::current_account_id(), self.tokens())
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_settle_balances())
    }

    #[private]
    pub fn on_settle_balances(&mut self, #[callback_result] balances: Result<Vec<U128>, PromiseError>) -> String {
        let balances: Vec<u128> = balances.unwrap_or_else(|_| env::panic_str(ERR_BALANCES)).into_iter().map(|b| b.0).collect();
        self.settle_with(&balances, env::block_timestamp()).to_string()
    }

    /* ───────────── views ───────────── */

    pub fn get_plan(&self) -> Vec<Target> {
        self.plan.clone()
    }
    /// Free check of a 1Click quote against this vault, exactly as `rebalance` would check it:
    /// the signature, the terms, freshness and plan membership. Panics with the refusal reason.
    pub fn check_quote(&self, quote: String, signature: String) -> QuoteTerms {
        let terms = self.verify_quote(&quote, &signature, env::block_timestamp());
        require!(terms.quoted_ns > self.last_quote_ns, ERR_QUOTE_REPLAY);
        require!(self.plan.iter().any(|t| t.token == terms.sell) && self.plan.iter().any(|t| t.token == terms.buy), ERR_NOT_IN_PLAN);
        terms
    }
    pub fn get_quote_signer(&self) -> PublicKey {
        self.quote_signer.clone()
    }
    pub fn get_limits(&self) -> Limits {
        self.limits.clone()
    }
    pub fn get_status(&self) -> Status {
        Status {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            paused: self.paused,
            pending: self.pending.clone(),
            trades_today: if env::block_timestamp() / NS_PER_SEC / DAY_SECS == self.day { self.trades_today } else { 0 },
            last_trade_ns: self.last_trade_ns,
        }
    }
}

/* ───────────── pure logic (unit-tested directly) ───────────── */

pub struct PolicyCheck {
    pub sell_balance: u128,
    pub buy_balance: u128,
    pub sell_drift_bps: i64,
}

impl Vault {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, ERR_NOT_OWNER);
        require!(env::attached_deposit() >= ONE_YOCTO, ERR_ONE_YOCTO);
    }

    /// The agent's function-call key lives on this account, so its calls come from the account itself.
    fn assert_agent(&self) {
        require!(env::predecessor_account_id() == env::current_account_id(), ERR_NOT_AGENT);
        require!(self.agent.is_some(), ERR_NO_AGENT);
        // Only the key recorded for Kite, not any other key that happens to be on this account.
        require!(self.agent.as_ref() == Some(&env::signer_account_pk()), ERR_NOT_AGENT);
    }

    pub fn close_tokens(&self, also_check: Vec<String>) -> Vec<String> {
        let mut tokens = self.tokens();
        for t in also_check {
            if !tokens.contains(&t) {
                tokens.push(t);
            }
        }
        require!(tokens.len() <= 16, ERR_CLOSE_TOKENS);
        tokens
    }

    /// Closing is only allowed with nothing in flight and nothing left in NEAR Intents.
    pub fn check_close(&self, balances: &[u128]) {
        require!(self.pending.is_none(), ERR_PENDING);
        require!(balances.iter().all(|b| *b == 0), ERR_NOT_EMPTY);
    }

    fn tokens(&self) -> Vec<String> {
        self.plan.iter().map(|t| t.token.clone()).collect()
    }

    fn roll_day(&mut self, now_ns: u64) {
        let day = now_ns / NS_PER_SEC / DAY_SECS;
        if day != self.day {
            self.day = day;
            self.trades_today = 0;
        }
    }

    /// Checks that don't need balances: pause, pending, plan membership, rate limits.
    pub fn check_can_trade(&mut self, sell: &str, buy: &str, amount_in: U128) {
        require!(!self.paused, ERR_PAUSED);
        require!(self.pending.is_none(), ERR_PENDING);
        require!(sell != buy, ERR_SAME_ASSET);
        require!(self.plan.iter().any(|t| t.token == sell), ERR_NOT_IN_PLAN);
        require!(self.plan.iter().any(|t| t.token == buy), ERR_NOT_IN_PLAN);
        require!(amount_in.0 > 0, ERR_ZERO);
        let now = env::block_timestamp();
        self.roll_day(now);
        require!(self.trades_today < self.limits.max_trades_per_day, ERR_RATE);
        require!(
            self.last_trade_ns == 0 || now.saturating_sub(self.last_trade_ns) >= self.limits.min_interval_secs * NS_PER_SEC,
            ERR_RATE
        );
    }

    /// Check 1Click's signature and the quote's terms. Returns what the trade may do.
    pub fn verify_quote(&self, quote: &str, signature: &str, now_ns: u64) -> QuoteTerms {
        // 1Click signs base58(sha256(json)) with its manager key.
        let sig = signature.strip_prefix("ed25519:").unwrap_or(signature);
        let sig: [u8; 64] = near_sdk::bs58::decode(sig)
            .into_vec()
            .ok()
            .and_then(|v| v.try_into().ok())
            .unwrap_or_else(|| env::panic_str(ERR_QUOTE_SIG));
        let pk: [u8; 32] = self.quote_signer.as_bytes()[1..].try_into().unwrap_or_else(|_| env::panic_str(ERR_QUOTE_SIG));
        let message = near_sdk::bs58::encode(env::sha256(quote.as_bytes())).into_string();
        require!(env::ed25519_verify(&sig, message.as_bytes(), &pk), ERR_QUOTE_SIG);

        let q: SignedQuote = near_sdk::serde_json::from_str(quote).unwrap_or_else(|_| env::panic_str(ERR_QUOTE_TERMS));
        // A signed request can carry fees, referrals or redirects that pay someone else out of the swap.
        // A stolen key could otherwise skim the whole price-limit budget of every trade into its own account.
        let blank = |s: &Option<String>| s.as_deref().is_none_or(str::is_empty);
        require!(
            q.app_fees.as_ref().is_none_or(Vec::is_empty)
                && blank(&q.referral)
                && blank(&q.custom_recipient_msg)
                && blank(&q.virtual_chain_recipient)
                && blank(&q.virtual_chain_refund_recipient),
            ERR_QUOTE_TERMS
        );
        let me = env::current_account_id();
        require!(!q.dry && q.swap_type == "EXACT_INPUT" && q.deposit_type == "INTENTS", ERR_QUOTE_TERMS);
        require!(q.recipient == me.as_str() && q.recipient_type == "INTENTS", ERR_QUOTE_RECIPIENT);
        require!(q.refund_to == me.as_str() && q.refund_type == "INTENTS", ERR_QUOTE_REFUND);
        require!(q.amount == q.amount_in, ERR_QUOTE_TERMS);

        let quoted_ns = parse_iso_ns(&q.timestamp).unwrap_or_else(|| env::panic_str(ERR_QUOTE_TERMS));
        require!(quoted_ns <= now_ns + 15 * NS_PER_SEC, ERR_QUOTE_STALE);
        require!(now_ns.saturating_sub(quoted_ns) <= QUOTE_MAX_AGE_SECS * NS_PER_SEC, ERR_QUOTE_STALE);

        let int = |s: &str| s.parse::<u128>().unwrap_or_else(|_| env::panic_str(ERR_QUOTE_TERMS));
        let usd = |s: &str| parse_usd_e6(s).unwrap_or_else(|| env::panic_str(ERR_QUOTE_TERMS));
        let deposit_address: AccountId = q
            .deposit_address
            .as_deref()
            .and_then(|a| a.parse().ok())
            .unwrap_or_else(|| env::panic_str(ERR_QUOTE_TERMS));
        QuoteTerms {
            sell: q.origin_asset,
            buy: q.destination_asset,
            amount_in: U128(int(&q.amount_in)),
            amount_out: U128(int(&q.amount_out)),
            min_out: U128(int(&q.min_amount_out)),
            in_usd_e6: U128(usd(&q.amount_in_usd)),
            out_usd_e6: U128(usd(&q.amount_out_usd)),
            deposit_address,
            quoted_ns,
        }
    }

    /// The core rule: the trade must reduce drift, stay small, and price fairly.
    /// The two traded assets are valued at the signed quote's prices, so a lying agent
    /// can't make a trade look smaller or fairer than it is.
    pub fn policy_check(&self, balances: &[u128], terms: &QuoteTerms, prices: &[Price]) -> PolicyCheck {
        require!(balances.len() == self.plan.len(), ERR_BALANCES);
        let (sell, buy) = (terms.sell.as_str(), terms.buy.as_str());
        let idx = |token: &str| self.plan.iter().position(|t| t.token == token).unwrap();
        let (si, bi) = (idx(sell), idx(buy));
        let sell_dec = 10u128.pow(self.plan[si].decimals as u32);
        let buy_dec = 10u128.pow(self.plan[bi].decimals as u32);
        require!(terms.amount_in.0 > 0 && terms.amount_out.0 > 0 && terms.in_usd_e6.0 > 0 && terms.out_usd_e6.0 > 0, ERR_PRICE);
        require!(terms.in_usd_e6.0 >= 1_000_000, ERR_TOO_SMALL);
        // Signed prices: micro-dollars per whole token.
        let sell_px = terms.in_usd_e6.0 * sell_dec / terms.amount_in.0;
        let buy_px = terms.out_usd_e6.0 * buy_dec / terms.amount_out.0;

        let price_of = |token: &str| -> u128 {
            if token == sell {
                return sell_px;
            }
            if token == buy {
                return buy_px;
            }
            let p = prices.iter().find(|p| p.token == token).unwrap_or_else(|| env::panic_str(ERR_PRICE));
            require!(p.usd_e6.0 > 0, ERR_PRICE);
            p.usd_e6.0
        };
        // Value each holding in micro-dollars.
        let values: Vec<u128> = self
            .plan
            .iter()
            .zip(balances)
            .map(|(t, b)| b * price_of(&t.token) / 10u128.pow(t.decimals as u32))
            .collect();
        let nav: u128 = values.iter().sum();
        require!(nav > 0, ERR_EMPTY);

        let weight_bps = |i: usize| (values[i] * BPS / nav) as i64;
        let sell_drift = weight_bps(si) - self.plan[si].target_bps as i64;
        let buy_drift = weight_bps(bi) - self.plan[bi].target_bps as i64;

        require!(sell_drift >= self.limits.band_bps as i64, ERR_NOT_OVER_BAND);
        require!(buy_drift < 0, ERR_WRONG_DIRECTION);
        require!(terms.amount_in.0 <= balances[si], ERR_INSUFFICIENT);

        let value_in = terms.in_usd_e6.0;
        require!(value_in * BPS <= nav * self.limits.max_trade_bps as u128, ERR_TOO_BIG);
        // Never sell past target: the trade may not overshoot by more than the band.
        require!(value_in * BPS <= nav * (sell_drift as u128 + self.limits.band_bps as u128), ERR_TOO_BIG);

        // Price: what comes back must be worth at least (1 - limit) of what goes out, by 1Click's
        // own signed USD values, and the guaranteed minimum may not be looser than the limit either.
        let limit = [Some(self.limits.max_slippage_bps), self.plan[si].max_slippage_bps, self.plan[bi].max_slippage_bps]
            .into_iter()
            .flatten()
            .max()
            .unwrap_or(self.limits.max_slippage_bps);
        let keep = BPS - limit as u128;
        require!(terms.out_usd_e6.0 * BPS >= value_in * keep, ERR_SLIPPAGE);
        require!(terms.min_out.0 * BPS >= terms.amount_out.0 * keep, ERR_SLIPPAGE);

        PolicyCheck { sell_balance: balances[si], buy_balance: balances[bi], sell_drift_bps: sell_drift }
    }

    /// Settlement given fresh balances. Returns "settled", "refunded", "breaker" or "waiting".
    pub fn settle_with(&mut self, balances: &[u128], now_ns: u64) -> &'static str {
        let p = match self.pending.clone() {
            Some(p) => p,
            None => return "none",
        };
        let pos = |token: &str| self.plan.iter().position(|t| t.token == token);
        let (Some(si), Some(bi)) = (pos(&p.sell), pos(&p.buy)) else {
            self.pending = None;
            return "none";
        };
        let received = balances[bi].saturating_sub(p.buy_before.0);
        let refunded = balances[si] >= p.sell_before.0;
        if received >= p.min_out.0 {
            self.pending = None;
            emit("rebalance_settled", &format!(r#"{{"received":"{}","min_out":"{}"}}"#, received, p.min_out.0));
            "settled"
        } else if refunded {
            self.pending = None;
            emit("rebalance_refunded", "{}");
            "refunded"
        } else if now_ns.saturating_sub(p.started_ns) > self.limits.settle_window_secs * NS_PER_SEC {
            self.pending = None;
            self.paused = true;
            emit("breaker_tripped", &format!(r#"{{"received":"{}","min_out":"{}"}}"#, received, p.min_out.0));
            "breaker"
        } else {
            "waiting"
        }
    }
}

fn validate_plan(plan: &[Target]) {
    require!((2..=8).contains(&plan.len()), ERR_PLAN_SIZE);
    let sum: u32 = plan.iter().map(|t| t.target_bps as u32).sum();
    require!(sum == BPS as u32, ERR_PLAN_SUM);
    for (i, t) in plan.iter().enumerate() {
        require!(t.target_bps > 0 && t.decimals <= 24, ERR_PLAN_ASSET);
        require!(t.max_slippage_bps.is_none_or(|s| (10..=500).contains(&s)), ERR_PLAN_ASSET);
        require!(!plan[..i].iter().any(|u| u.token == t.token), ERR_PLAN_ASSET);
    }
}

/// "4.996660000000" → 4_996_660 (micro-dollars). Extra decimals are cut, not rounded.
pub fn parse_usd_e6(s: &str) -> Option<u128> {
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if int.is_empty() || !int.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut micro = frac.chars().take(6).collect::<String>();
    while micro.len() < 6 {
        micro.push('0');
    }
    Some(int.parse::<u128>().ok()? * 1_000_000 + micro.parse::<u128>().ok()?)
}

/// "2026-11-03T00:01:49.235Z" → nanoseconds since the Unix epoch. Only the UTC `Z` form 1Click returns.
pub fn parse_iso_ns(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let mut ms = 0i64;
    if b[19] == b'.' {
        let frac = s.get(20..s.len() - 1)?;
        if frac.is_empty() || !frac.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let f: String = frac.chars().chain("000".chars()).take(3).collect();
        ms = f.parse().ok()?;
    } else if b.len() != 20 {
        return None;
    }
    // Days from civil (Howard Hinnant).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hh * 3_600 + mm * 60 + ss;
    u64::try_from(secs).ok()?.checked_mul(NS_PER_SEC)?.checked_add(ms as u64 * 1_000_000)
}

/// NEP-297 event log.
fn emit(event: &str, data: &str) {
    log!(r#"EVENT_JSON:{{"standard":"kite","version":"1.0.0","event":"{}","data":{}}}"#, event, data);
}

#[cfg(test)]
mod tests;

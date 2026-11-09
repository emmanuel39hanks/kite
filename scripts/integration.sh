#!/bin/sh
# Sandbox tests: run the shipped vault wasm (apps/web/public/vault/kite_vault.wasm) on a local NEAR node
# against a mock intents.near, with real keys and real receipts. Needs cargo-near; downloads the sandbox once.
set -e
cd "$(dirname "$0")/../contracts"
cargo near build non-reproducible-wasm --manifest-path mock-intents/Cargo.toml
cargo test -p kite-integration-tests --test sandbox -- --nocapture --test-threads=1

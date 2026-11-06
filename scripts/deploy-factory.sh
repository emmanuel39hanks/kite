#!/bin/sh
# Deploy Kite's vault factory to NEAR mainnet and lock it. Run it yourself: it signs with your keys.
#
#   FACTORY=kitevaults.near FUNDER=you.near sh scripts/deploy-factory.sh
#
# Needs near-cli-rs (https://github.com/near/near-cli-rs):  npm i -g near-cli-rs   or   cargo install near-cli-rs
# Costs about 4.5 NEAR from FUNDER: 4.21 NEAR stays locked in the factory for its storage (it holds the
# vault code it deploys), the rest is spare for refunds. Once locked, nobody can take it out or change it.
set -e
cd "$(dirname "$0")/.."

FACTORY="${FACTORY:-kitevaults.near}"
FUNDER="${FUNDER:?set FUNDER to the account that pays, e.g. FUNDER=you.near}"
WASM=apps/web/public/vault/kite_factory.wasm
VAULT=apps/web/public/vault/kite_vault.wasm

command -v near >/dev/null || { echo "Install near-cli-rs first: npm i -g near-cli-rs"; exit 1; }
echo "factory wasm  $(shasum -a 256 "$WASM" | cut -d' ' -f1)  ($(wc -c <"$WASM" | tr -d ' ') bytes)"
echo "vault wasm    $(shasum -a 256 "$VAULT" | cut -d' ' -f1)  ($(wc -c <"$VAULT" | tr -d ' ') bytes, compiled into the factory)"
printf "Deploy to %s, paid by %s, and lock it for good? [y/N] " "$FACTORY" "$FUNDER"
read -r ok
[ "$ok" = "y" ] || exit 1

echo "\n1/4  Create $FACTORY with 4.5 NEAR (a new key is saved to your keychain; it's deleted in step 4)"
near account create-account fund-myself "$FACTORY" '4.5 NEAR' autogenerate-new-keypair save-to-keychain sign-as "$FUNDER" network-config mainnet sign-with-keychain send
# If your CLI can't create a top-level .near name this way, create it in your wallet instead, fund it
# with 4.5 NEAR, import its key into the keychain, and run the script again from step 2.

echo "\n2/4  Deploy the factory and initialise it (NEAR Intents = intents.near)"
near contract deploy "$FACTORY" use-file "$WASM" with-init-call new json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send

echo "\n3/4  Check it: the vault code hash it reports must be the sha256 above, in base58"
near contract call-function as-read-only "$FACTORY" get_config json-args '{}' network-config mainnet now

echo "\n4/4  Lock it: delete every key. After this, nobody can change the factory or what it creates."
near account list-keys "$FACTORY" network-config mainnet now
printf "Paste the public key to delete (ed25519:...): "
read -r PK
near account delete-keys "$FACTORY" public-keys "$PK" network-config mainnet sign-with-keychain send
near account list-keys "$FACTORY" network-config mainnet now
echo "\nDone. The list above must be empty. Set NEXT_PUBLIC_KITE_FACTORY=$FACTORY on Vercel if it isn't kitevaults.near."

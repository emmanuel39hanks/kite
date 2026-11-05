#!/bin/sh
# Install everything from a fresh clone. The web app links the worker package, so the worker goes first.
set -e
cd "$(dirname "$0")/.."
npm ci --prefix worker
npm ci --prefix web
echo "Done. Next: npm test --prefix worker && npm test --prefix web && (cd contracts/vault && cargo test)"

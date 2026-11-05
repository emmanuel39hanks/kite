#!/bin/sh
# Install everything from a fresh clone: one npm install for the web app and the keeper (npm workspaces).
set -e
cd "$(dirname "$0")/.."
npm ci
echo "Done. Next: npm test && npm run test:contracts"

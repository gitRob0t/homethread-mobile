#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${COHO_RELEASE_BRANCH:-agent/chat-keyboard-homebot}"
cd "$ROOT"

echo "Fetching the verified Coho release branch..."
git fetch origin "$BRANCH"

npm run verify:source
npm run release:check

echo "Starting the verified iOS internal build..."
npx eas-cli build --platform ios --profile internal

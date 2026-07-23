#!/usr/bin/env bash
set -euo pipefail

npm run typecheck
npm run eval:coh
npm run eval:backend
npx expo-doctor
npx expo export --platform ios --output-dir /tmp/coho-ios-export
git diff --check

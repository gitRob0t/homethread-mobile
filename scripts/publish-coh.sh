#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${COHO_RELEASE_BRANCH:-agent/chat-keyboard-homebot}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-cbkpgkiuikpcrefcbutq}"
EXPECTED_PRODUCTION_REF="cbkpgkiuikpcrefcbutq"
SUPABASE=(npx --yes supabase@2.109.1)
EXPECTED_MIGRATION="202607270002_coh_agent_hardening.sql"

cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "This must run from a Git clone, not a downloaded ZIP." >&2
  exit 1
fi

if [[ "$PROJECT_REF" != "$EXPECTED_PRODUCTION_REF" && "${COHO_ALLOW_OTHER_PROJECT:-false}" != "true" ]]; then
  echo "Refusing to publish Coh to unexpected Supabase project: $PROJECT_REF" >&2
  echo "Set COHO_ALLOW_OTHER_PROJECT=true only for an intentional non-production deployment." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "The working tree is not clean. Commit, stash, or discard local changes first." >&2
  git status --short
  exit 1
fi

echo "Fetching the verified Coho release branch..."
git fetch origin "$BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  echo "This checkout is not the published release commit." >&2
  echo "Local:  $LOCAL_SHA" >&2
  echo "Remote: $REMOTE_SHA" >&2
  echo "Run: git pull --ff-only origin $BRANCH" >&2
  exit 1
fi

echo "Running the complete release gate..."
npm run release:check

echo "Linking Supabase production project $PROJECT_REF..."
"${SUPABASE[@]}" link --project-ref "$PROJECT_REF"

echo "Current local/remote migration history:"
"${SUPABASE[@]}" migration list --linked

echo "Database dry run:"
DRY_RUN_OUTPUT="$("${SUPABASE[@]}" db push --linked --dry-run 2>&1)"
printf '%s\n' "$DRY_RUN_OUTPUT"

PENDING_MIGRATIONS="$(
  printf '%s\n' "$DRY_RUN_OUTPUT" |
    grep -Eo '[0-9]{12,14}_[[:alnum:]_]+\.sql' |
    sort -u || true
)"
MIGRATION_PENDING="false"
if [[ -n "$PENDING_MIGRATIONS" ]]; then
  if [[ "$PENDING_MIGRATIONS" != "$EXPECTED_MIGRATION" ]]; then
    echo "Refusing to publish because the dry run contains unexpected migrations:" >&2
    printf '%s\n' "$PENDING_MIGRATIONS" >&2
    exit 1
  fi
  MIGRATION_PENDING="true"
elif ! printf '%s\n' "$DRY_RUN_OUTPUT" | grep -Eqi 'up to date|no migrations'; then
  echo "Refusing to publish because the dry-run output could not prove that no migrations are pending." >&2
  exit 1
fi

echo "Checking that the server-side OpenAI key is configured..."
SECRETS_OUTPUT="$("${SUPABASE[@]}" secrets list --project-ref "$PROJECT_REF" --output json)"
if ! printf '%s\n' "$SECRETS_OUTPUT" | grep -q 'OPENAI_API_KEY'; then
  echo "OPENAI_API_KEY is not configured in Supabase. Coh cannot be published safely." >&2
  exit 1
fi

echo
echo "Allowed pending migration: $EXPECTED_MIGRATION"
echo "This release deploys only the Coh database migration and coh-assistant."
echo "It does not change mailbox secrets or deploy mailbox functions."
read -r -p "Type PUBLISH COH to continue: " confirmation
if [[ "$confirmation" != "PUBLISH COH" ]]; then
  echo "Publish cancelled."
  exit 1
fi

if [[ "$MIGRATION_PENDING" == "true" ]]; then
  echo "Applying $EXPECTED_MIGRATION..."
  "${SUPABASE[@]}" db push --linked
else
  echo "$EXPECTED_MIGRATION is already applied; skipping database push."
fi

echo "Deploying coh-assistant with JWT verification..."
"${SUPABASE[@]}" functions deploy coh-assistant \
  --project-ref "$PROJECT_REF" \
  --use-api

echo "Verifying migration history..."
"${SUPABASE[@]}" migration list --linked
"${SUPABASE[@]}" functions list --project-ref "$PROJECT_REF"

echo "Coh backend publish complete."

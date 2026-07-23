#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF to the target Supabase project ref}"
SUPABASE=(npx --yes supabase@2.109.1)

echo "Linking Supabase project ${PROJECT_REF}..."
"${SUPABASE[@]}" link --project-ref "${PROJECT_REF}"

echo "Applying pending database migrations..."
"${SUPABASE[@]}" db push

protected_functions=(
  coh-assistant
  coh-extract
  instacart-shopping-list
  privacy-data
  send-household-invite
)

public_entry_functions=(
  calendar-oauth
  calendar-sync
  dispatch-notifications
  resend-inbound
  run-automations
  send-household-briefings
)

for function_name in "${protected_functions[@]}"; do
  echo "Deploying ${function_name}..."
  "${SUPABASE[@]}" functions deploy "${function_name}" \
    --project-ref "${PROJECT_REF}"
done

for function_name in "${public_entry_functions[@]}"; do
  echo "Deploying ${function_name} with its own request verification..."
  "${SUPABASE[@]}" functions deploy "${function_name}" \
    --no-verify-jwt \
    --project-ref "${PROJECT_REF}"
done

echo "Supabase schema and Edge Functions are deployed."

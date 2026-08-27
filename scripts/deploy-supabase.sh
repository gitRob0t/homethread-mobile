#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF to the target Supabase project ref}"
OPENAI_MODEL_VALUE="${OPENAI_MODEL:-gpt-5.6-sol}"
SUPABASE=(npx --yes supabase@2.109.1)
DIRECT_MAILBOX_ENABLED="${ENABLE_DIRECT_MAILBOX:-false}"
MAILBOX_WEBHOOK_URL_VALUE="${MAILBOX_WEBHOOK_URL:-https://${PROJECT_REF}.supabase.co/functions/v1/mailbox-webhook?provider=outlook}"
MAILBOX_RETURN_URI_ALLOWLIST_VALUE="${MAILBOX_RETURN_URI_ALLOWLIST:-coho://mail-connected/google,coho://mail-connected/outlook}"

require_env() {
  local variable_name="$1"
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
}

echo "Linking Supabase project ${PROJECT_REF}..."
"${SUPABASE[@]}" link --project-ref "${PROJECT_REF}"

echo "Setting the supported Coh model (${OPENAI_MODEL_VALUE})..."
"${SUPABASE[@]}" secrets set "OPENAI_MODEL=${OPENAI_MODEL_VALUE}" \
  --project-ref "${PROJECT_REF}"

if [[ "${DIRECT_MAILBOX_ENABLED}" == "true" ]]; then
  require_env MAILBOX_TOKEN_ENCRYPTION_KEY
  require_env MAILBOX_SYNC_SECRET
  require_env MAILBOX_WEBHOOK_SECRET

  if [[ -n "${GOOGLE_MAIL_CLIENT_ID:-}${GOOGLE_MAIL_CLIENT_SECRET:-}" ]]; then
    require_env GOOGLE_MAIL_CLIENT_ID
    require_env GOOGLE_MAIL_CLIENT_SECRET
    require_env GMAIL_PUBSUB_TOPIC
    require_env GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT
    require_env GMAIL_PUBSUB_PUSH_AUDIENCE
  fi
  if [[ -n "${MICROSOFT_MAIL_CLIENT_ID:-}${MICROSOFT_MAIL_CLIENT_SECRET:-}" ]]; then
    require_env MICROSOFT_MAIL_CLIENT_ID
    require_env MICROSOFT_MAIL_CLIENT_SECRET
  fi
  if [[ -z "${GOOGLE_MAIL_CLIENT_ID:-}" && -z "${MICROSOFT_MAIL_CLIENT_ID:-}" ]]; then
    echo "ENABLE_DIRECT_MAILBOX=true requires at least one Google or Microsoft mail OAuth client." >&2
    exit 1
  fi

  mailbox_secrets=(
    "ENABLE_DIRECT_MAILBOX=true"
    "MAILBOX_TOKEN_ENCRYPTION_KEY=${MAILBOX_TOKEN_ENCRYPTION_KEY}"
    "MAILBOX_SYNC_SECRET=${MAILBOX_SYNC_SECRET}"
    "MAILBOX_WEBHOOK_SECRET=${MAILBOX_WEBHOOK_SECRET}"
    "MAILBOX_WEBHOOK_URL=${MAILBOX_WEBHOOK_URL_VALUE}"
    "MAILBOX_RETURN_URI_ALLOWLIST=${MAILBOX_RETURN_URI_ALLOWLIST_VALUE}"
  )
  if [[ -n "${GOOGLE_MAIL_CLIENT_ID:-}" ]]; then
    mailbox_secrets+=(
      "GOOGLE_MAIL_CLIENT_ID=${GOOGLE_MAIL_CLIENT_ID}"
      "GOOGLE_MAIL_CLIENT_SECRET=${GOOGLE_MAIL_CLIENT_SECRET}"
      "GMAIL_PUBSUB_TOPIC=${GMAIL_PUBSUB_TOPIC}"
      "GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT=${GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT}"
      "GMAIL_PUBSUB_PUSH_AUDIENCE=${GMAIL_PUBSUB_PUSH_AUDIENCE}"
    )
    if [[ -n "${GMAIL_PUBSUB_SUBSCRIPTION:-}" ]]; then
      mailbox_secrets+=("GMAIL_PUBSUB_SUBSCRIPTION=${GMAIL_PUBSUB_SUBSCRIPTION}")
    fi
  fi
  if [[ -n "${MICROSOFT_MAIL_CLIENT_ID:-}" ]]; then
    mailbox_secrets+=(
      "MICROSOFT_MAIL_CLIENT_ID=${MICROSOFT_MAIL_CLIENT_ID}"
      "MICROSOFT_MAIL_CLIENT_SECRET=${MICROSOFT_MAIL_CLIENT_SECRET}"
    )
  fi

  echo "Configuring direct-mailbox server secrets..."
  "${SUPABASE[@]}" secrets set "${mailbox_secrets[@]}" \
    --project-ref "${PROJECT_REF}"
else
  echo "Disabling direct mailbox runtime entry points in ${PROJECT_REF}..."
  "${SUPABASE[@]}" secrets set "ENABLE_DIRECT_MAILBOX=false" \
    --project-ref "${PROJECT_REF}"
  echo "Direct mailbox code will deploy inactive. Set ENABLE_DIRECT_MAILBOX=true with verified provider credentials to activate it."
fi

echo "Applying pending database migrations..."
"${SUPABASE[@]}" db push

protected_functions=(
  coh-assistant
  coh-extract
  instacart-shopping-list
  privacy-data
)

public_entry_functions=(
  calendar-oauth
  calendar-sync
  dispatch-notifications
  mailbox-oauth
  mailbox-sync
  mailbox-webhook
  resend-inbound
  run-automations
  send-household-invite
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

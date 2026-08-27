# Coho deployment runbook

This runbook deploys the production backend without placing secrets in the
mobile bundle or repository.

## 1. Validate the app

From the repository root:

```bash
npm install
npm run release:check
```

The release check validates TypeScript, Coh's deterministic contracts, Expo
configuration and dependencies, and a complete iOS JavaScript bundle.

## 2. Configure server-only secrets

Set secrets through the Supabase CLI or Dashboard. Never prefix these values
with `EXPO_PUBLIC_`.

Required for Coh:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Required for Google/Outlook calendar sync:

- `CALENDAR_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MICROSOFT_CALENDAR_CLIENT_ID`
- `MICROSOFT_CALENDAR_CLIENT_SECRET`
- `CRON_SECRET`

Required to activate direct Gmail or Outlook mailbox reading:

- `ENABLE_DIRECT_MAILBOX=true` in the shell running the deployment script
- `MAILBOX_TOKEN_ENCRYPTION_KEY` — a new 32-byte secret, not reused from another
  environment
- `MAILBOX_SYNC_SECRET` — authenticates the reconciliation schedule
- `MAILBOX_WEBHOOK_SECRET` — authenticates Gmail pushes and derives Microsoft
  Graph `clientState`
- `MAILBOX_RETURN_URI_ALLOWLIST` — exact comma-separated app deep links; the
  deployment defaults to
  `coho://mail-connected/google,coho://mail-connected/outlook`
- `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET` for Gmail
- `GMAIL_PUBSUB_TOPIC` for Gmail, for example
  `projects/coho-production/topics/mailbox-events`
- `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT` — the exact service-account email used
  by the Pub/Sub authenticated push subscription
- `GMAIL_PUBSUB_PUSH_AUDIENCE` — the exact OIDC audience configured on that
  push subscription
- `GMAIL_PUBSUB_SUBSCRIPTION` — optional full subscription name; when set,
  notifications from any other subscription are rejected
- `MICROSOFT_MAIL_CLIENT_ID` and `MICROSOFT_MAIL_CLIENT_SECRET` for Outlook

`MAILBOX_WEBHOOK_URL` is optional and defaults to
`https://SUPABASE_PROJECT_REF.supabase.co/functions/v1/mailbox-webhook?provider=outlook`.
Use dedicated mail OAuth clients in production. Do not reuse broad calendar
clients or put provider credentials in `EXPO_PUBLIC_*` variables.

Required for Family Inbox, invitation email, and email briefings:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `COHO_FROM_EMAIL`
- `BRIEFING_CRON_SECRET`

Required for production notification and automation workers:

- `AUTOMATION_CRON_SECRET`
- `CRON_SECRET`

Optional commerce handoff:

- `INSTACART_API_KEY`
- `INSTACART_BASE_URL`

Generate each encryption or cron secret independently:

```bash
openssl rand -hex 32
```

## 3. Deploy Supabase

Log in once, then run the checked-in deployment script:

```bash
npx --yes supabase@2.109.1 login
export SUPABASE_PROJECT_REF="YOUR_PROJECT_REF"
bash scripts/deploy-supabase.sh
```

The script links the project named by `SUPABASE_PROJECT_REF`, applies every
pending migration, pins Coh to the supported `gpt-5.6-sol` API model unless
`OPENAI_MODEL` is deliberately overridden, and deploys all Edge Functions with
the correct gateway mode.
Webhook, OAuth callback, and scheduler endpoints bypass Supabase's JWT gateway
only because each function verifies its own signature, session, service token,
or cron secret.

Direct mailbox code deploys in an inactive state unless
`ENABLE_DIRECT_MAILBOX=true`. A production activation with Gmail looks like:

```bash
export ENABLE_DIRECT_MAILBOX=true
export MAILBOX_TOKEN_ENCRYPTION_KEY="LOAD_STABLE_VALUE_FROM_SECRET_MANAGER"
export MAILBOX_SYNC_SECRET="LOAD_VALUE_FROM_SECRET_MANAGER"
export MAILBOX_WEBHOOK_SECRET="LOAD_VALUE_FROM_SECRET_MANAGER"
export GOOGLE_MAIL_CLIENT_ID="..."
export GOOGLE_MAIL_CLIENT_SECRET="..."
export GMAIL_PUBSUB_TOPIC="projects/YOUR_GOOGLE_PROJECT/topics/mailbox-events"
export GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT="coho-mail-push@YOUR_GOOGLE_PROJECT.iam.gserviceaccount.com"
export GMAIL_PUBSUB_PUSH_AUDIENCE="https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-webhook?provider=google"
export GMAIL_PUBSUB_SUBSCRIPTION="projects/YOUR_GOOGLE_PROJECT/subscriptions/coho-mailbox-events"
bash scripts/deploy-supabase.sh
```

Generate these values once, store them in the production secret manager, and
load the same values on every deployment. Rotating the encryption key requires
an explicit token re-encryption or reconnection plan. Add Microsoft variables
to the same invocation to activate Outlook.

## 4. Configure schedules and webhooks

Invoke these workers from Supabase Cron:

- `send-household-briefings`: every 15 minutes with
  `x-coho-cron-secret: BRIEFING_CRON_SECRET`
- `dispatch-notifications`: every minute with
  `x-cron-secret: CRON_SECRET`
- `run-automations`: every minute with
  `x-coho-cron-secret: AUTOMATION_CRON_SECRET`
- `calendar-sync`: every 5 minutes with
  `x-cron-secret: CRON_SECRET`
- `mailbox-sync`: every 10 minutes with
  `x-coho-scheduler-secret: MAILBOX_SYNC_SECRET`

The mailbox schedule is reconciliation, not polling-only delivery. Provider
webhooks trigger an immediate incremental sync; the schedule renews expiring
subscriptions and catches missed or delayed notifications. Invoke:

```text
POST https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-sync
Content-Type: application/json
x-coho-scheduler-secret: MAILBOX_SYNC_SECRET

{}
```

Configure Resend's `email.received` webhook to:

`https://YOUR_PROJECT.supabase.co/functions/v1/resend-inbound`

Configure both calendar providers' callback URL to:

`https://YOUR_PROJECT.supabase.co/functions/v1/calendar-oauth`

### Gmail direct connection

1. Create a dedicated Google OAuth web client and enable the Gmail API.
2. Configure this exact authorized redirect URI:
   `https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-oauth`.
3. Request only `openid`, `email`, `profile`, and
   `https://www.googleapis.com/auth/gmail.readonly`. Do not request
   `gmail.modify`, `gmail.send`, or full-mail access.
4. Create the Pub/Sub topic from `GMAIL_PUBSUB_TOPIC` in the same Google Cloud
   project and grant `gmail-api-push@system.gserviceaccount.com` permission to
   publish to it.
5. Create a dedicated service account for authenticated Pub/Sub push. Grant
   the Pub/Sub service agent permission to mint an OIDC token for it, and set
   `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT` to its exact email.
6. Create a push subscription whose endpoint is exactly:
   `https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-webhook?provider=google&token=MAILBOX_WEBHOOK_SECRET`.
   Enable authenticated push, set the token service account to the value above,
   and set an explicit audience. Export that exact value as
   `GMAIL_PUBSUB_PUSH_AUDIENCE`. Optionally export the full subscription name
   as `GMAIL_PUBSUB_SUBSCRIPTION` for an additional source check.
7. Publish and verify the OAuth consent screen and its domains, privacy policy,
   and data-use disclosures. Gmail read-only is a restricted scope; complete
   Google's verification and any required security assessment before enabling
   accounts outside the approved test-user list.

The first sync reads a bounded recent window. Later syncs use Gmail
`historyId`; an expired cursor falls back to a bounded rescan and provider
message IDs prevent duplicate inbox items. Gmail watches expire and are renewed
by `mailbox-sync`.

### Outlook direct connection

1. Register a Microsoft identity-platform web application that supports the
   intended personal and/or work account types.
2. Configure this exact web redirect URI:
   `https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-oauth`.
3. Grant only delegated `openid`, `email`, `profile`, `offline_access`,
   `User.Read`, and `Mail.Read`. Do not grant `Mail.ReadWrite`,
   `Mail.ReadWrite.Shared`, application mail permissions, or send permissions.
4. Set the Microsoft Graph notification URL to:
   `https://YOUR_PROJECT.supabase.co/functions/v1/mailbox-webhook?provider=outlook`.
   Graph's plain-text `validationToken` challenge and each notification's
   `clientState` are validated by the function.
5. Complete publisher verification, privacy disclosures, and administrator
   consent where a customer's Microsoft tenant requires it.

Outlook sync stores a separate delta cursor and subscription for each selected
folder. The scheduled reconciliation renews subscriptions before expiration
and replays the delta feed after a missed notification.

### Activation gates

Keep the Connect button marked unavailable in production until all applicable
items pass:

- provider app is in production, not test-only, and the redirect URI matches
  exactly;
- least-privilege scopes above are the only mail scopes granted;
- privacy policy, account deletion, data export, and disconnect/revocation UX
  are live;
- tokens are encrypted with the production mailbox key and never returned by
  the sanitized connection RPC;
- Gmail push or Graph webhook verification succeeds from the provider;
- the 10-minute reconciliation job succeeds and subscription renewal is
  observable;
- a real email, HTML email, PDF attachment, duplicate notification, revoked
  grant, and expired-cursor recovery have passed staging;
- extracted events always enter Family Inbox review and require an adult's
  approval before a calendar or task write.

Provider setup references:
[Google Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push),
[Microsoft Graph mail permissions](https://learn.microsoft.com/graph/permissions-reference#mail-permissions),
[Microsoft Graph change notifications](https://learn.microsoft.com/graph/change-notifications-delivery-webhooks).

## 5. Build the internal iOS release

App Store submission remains intentionally separate. For the registered test
devices:

```bash
eas login
eas build --platform ios --profile internal
```

Install the generated build from the EAS link and test with two distinct family
accounts before promoting a production build.

## Release acceptance checks

- A second invited adult joins without owner assistance.
- A family message appears immediately on both phones and its notification
  opens Family Chat.
- Coh asks one missing-detail question at a time, requires confirmation, and
  opens the exact action it created.
- A Family Inbox email with an attachment reaches review, extracts proposals,
  and creates only approved actions.
- Google and Outlook imported events retain their source; edits flow both ways;
  simultaneous edits display a Keep Coho/Keep provider choice.
- An assigned chore opens from push, records its configured reward, and notifies
  the creator when completed.
- Daily, week-ahead, and follow-up snapshots are saved, playable, and reopenable.
- Export returns a short-lived private download; account deletion requires the
  exact confirmation phrase and email.

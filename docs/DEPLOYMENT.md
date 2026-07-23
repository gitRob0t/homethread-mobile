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
pending migration, and deploys all Edge Functions with the correct gateway mode.
Webhook, OAuth callback, and scheduler endpoints bypass Supabase's JWT gateway
only because each function verifies its own signature, session, service token,
or cron secret.

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

Configure Resend's `email.received` webhook to:

`https://YOUR_PROJECT.supabase.co/functions/v1/resend-inbound`

Configure both calendar providers' callback URL to:

`https://YOUR_PROJECT.supabase.co/functions/v1/calendar-oauth`

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

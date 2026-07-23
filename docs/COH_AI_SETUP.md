# Coh AI production setup

Coh runs through a Supabase Edge Function so the OpenAI API key never ships in the iPhone app. The mobile client automatically falls back to its local guided assistant when the function is unavailable.

## 1. Apply the database migration

From the repository directory, link the Supabase project and push the migration:

```bash
supabase login
supabase link --project-ref cbkpgkiuikpcrefcbutq
supabase db push
```

The migration creates private conversation history and an auditable queue of proposed, approved, executed, canceled, or failed actions. Row-level security restricts each user to their own Coh conversations and household.

## 2. Add server-only provider secrets

Create an OpenAI project API key. Do not place it in `App.tsx`, `app.json`, an Expo environment variable, GitHub, or chat.

```bash
supabase secrets set OPENAI_API_KEY=YOUR_KEY OPENAI_MODEL=gpt-5.6-sol --project-ref cbkpgkiuikpcrefcbutq
```

`gpt-5.6-sol` is the quality-first default for Coh, because this assistant is the product’s core interaction layer. The function keeps the model configurable without rebuilding the app, so a lower-cost tier can be evaluated later against the same structured-output tests.

To activate the real Instacart handoff, add the server-side key supplied through the Instacart Developer Platform:

```bash
supabase secrets set INSTACART_API_KEY=YOUR_INSTACART_KEY --project-ref cbkpgkiuikpcrefcbutq
```

To activate the family inbox and briefing email copies, verify receiving and sending domains in Resend, then add a full-access server key, the webhook signing secret, and the verified From address:

```bash
supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY RESEND_WEBHOOK_SECRET=YOUR_WHSEC_SECRET COHO_FROM_EMAIL="Coho <briefings@YOUR_VERIFIED_DOMAIN>" --project-ref cbkpgkiuikpcrefcbutq
```

Create a separate random secret for scheduled briefings:

```bash
openssl rand -hex 32
supabase secrets set BRIEFING_CRON_SECRET=PASTE_THE_RANDOM_VALUE --project-ref cbkpgkiuikpcrefcbutq
```

## 3. Deploy the production functions

```bash
supabase functions deploy coh-assistant --project-ref cbkpgkiuikpcrefcbutq
supabase functions deploy instacart-shopping-list --project-ref cbkpgkiuikpcrefcbutq
supabase functions deploy resend-inbound --no-verify-jwt --project-ref cbkpgkiuikpcrefcbutq
supabase functions deploy send-household-briefings --no-verify-jwt --project-ref cbkpgkiuikpcrefcbutq
```

The webhook and scheduler functions deliberately bypass the platform JWT gateway because their callers are Resend and Supabase Cron. They still reject requests unless the Resend signature or private cron secret verifies.

No new iOS build is required after deploying or updating an Edge Function. Restart Coho, sign in, and send:

> Hey Coh, I have a haircut Wednesday.

Coh should ask for missing details one at a time, summarize the complete event, request confirmation, and add it to the in-app calendar only after an explicit “add it” or equivalent confirmation.

## 4. Activate the family inbox

1. In Resend, verify the same receiving domain stored in `household_inboxes.domain` (currently `inbox.coho.ai`).
2. Add this webhook endpoint and subscribe it to `email.received`:

   `https://cbkpgkiuikpcrefcbutq.supabase.co/functions/v1/resend-inbound`

3. In Coho, open **More → Family Inbox**, reserve the family alias, and send a test email to that exact address.
4. Confirm that the message appears in **Needs review**. Reject it or explicitly choose **Review with Coh**.

The receiver verifies the raw Resend/Svix signature, rejects stale requests, deduplicates webhook and email IDs, retrieves the body from Resend’s Received Emails API, stores a limited text copy, records attachment metadata without downloading files, and sends a push notification to household devices.

## 5. Activate real briefing delivery

Deploying the function does not create a schedule by itself. In Supabase Dashboard, use **Integrations → Cron** to invoke:

`https://cbkpgkiuikpcrefcbutq.supabase.co/functions/v1/send-household-briefings`

Run it every 15 minutes with method `POST` and header:

`x-coho-cron-secret: THE_SAME_BRIEFING_CRON_SECRET`

The function calculates each user’s local time, sends only due daily/week-ahead/follow-up briefings through the push and/or email channels that person selected, and records the provider results in a unique delivery row so successful deliveries do not duplicate that day.

## Safety contract

- Every request requires a valid Supabase user session.
- Only messages deliberately addressed to Coh are sent as conversation input.
- Coh receives a bounded, read-only household snapshot needed to answer usefully: household name, family member names and roles, upcoming events, open chores, unchecked groceries, and the near-term meal plan.
- Family chat, inbound email bodies, precise location, payment data, secrets, and unrestricted history are excluded from Coh's context.
- Household access is verified with row-level security and membership checks.
- Coh returns structured data, not free-form commands.
- Writes require explicit confirmation and are recorded in `assistant_actions`.
- Imported email, shared text, and links are treated as untrusted content.
- Email access is opt-in and scoped; Coh must never silently scan an inbox.
- Location is off by default, controlled on each person’s device, and deletes the last shared coordinate when disabled.

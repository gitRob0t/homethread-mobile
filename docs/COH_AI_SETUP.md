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

## 2. Add the server-only OpenAI secret

Create an OpenAI project API key. Do not place it in `App.tsx`, `app.json`, an Expo environment variable, GitHub, or chat.

```bash
supabase secrets set OPENAI_API_KEY=YOUR_KEY OPENAI_MODEL=gpt-5.6-terra --project-ref cbkpgkiuikpcrefcbutq
```

`gpt-5.6-terra` is the default production balance of capability and cost. The function keeps the model configurable without rebuilding the app.

## 3. Deploy Coh

```bash
supabase functions deploy coh-assistant --project-ref cbkpgkiuikpcrefcbutq
```

No new iOS build is required after deploying or updating the function. Restart Coho, sign in, and send:

> Hey Coh, I have a haircut Wednesday.

Coh should ask for missing details one at a time, summarize the complete event, request confirmation, and add it to the in-app calendar only after an explicit “add it” or equivalent confirmation.

## Safety contract

- Every request requires a valid Supabase user session.
- Household access is verified with row-level security and membership checks.
- Coh returns structured data, not free-form commands.
- Writes require explicit confirmation and are recorded in `assistant_actions`.
- Imported email, shared text, and links are treated as untrusted content.
- Email access is opt-in and scoped; Coh must never silently scan an inbox.

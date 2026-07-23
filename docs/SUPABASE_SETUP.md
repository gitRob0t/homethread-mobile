# Coho Supabase setup

Coho uses Supabase for authentication, household-scoped data, realtime synchronization, Edge Functions, and scheduled household briefings.

## Create the project

1. Create or select the Coho Supabase project.
2. Link the CLI and run `npm run deploy:supabase` so every migration is applied
   once and every Edge Function is deployed with its intended gateway mode.
3. Enable email/password authentication. Enable Sign in with Apple before public production.
4. Add the app's redirect scheme: `homethread://auth/callback` (the legacy scheme remains for installed-build continuity).
5. Copy the project URL and publishable key into local environment variables.

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

Never put the service-role key, OpenAI key, provider client secrets, email-provider secrets, webhook signing secrets, or payment credentials in the mobile app.

## Security model

Every shared record includes a `household_id`. Row Level Security checks authenticated membership for every read or write. Only household owners and admins can manage invitations and membership.

Invitation acceptance, household creation, inbox reservation, and membership changes use server-side database functions so they remain atomic and cannot be forged by the client.

## Production activation

After configuring server-only secrets, follow
[DEPLOYMENT.md](DEPLOYMENT.md). Then configure:

- the Resend receiving domain and `email.received` webhook;
- the verified transactional From address;
- the Supabase Cron invocation for household briefings;
- OpenAI and Instacart provider keys;
- EAS/APNs credentials for production push delivery.

The app reports integrations as connected only after their real provider configuration succeeds.

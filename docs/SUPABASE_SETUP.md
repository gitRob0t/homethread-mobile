# Supabase setup

HomeThread uses Supabase for authentication, household-scoped data, realtime synchronization, and server-side automation foundations.

## Create the project

1. Create a Supabase project for HomeThread.
2. In SQL Editor, run the migrations in `supabase/migrations` in filename order.
3. Enable email/password authentication. Enable Sign in with Apple before production.
4. Add the app's redirect scheme: `homethread://auth/callback`.
5. Copy the project URL and publishable key into local environment variables.

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

Never put the service-role key, OAuth client secrets, email-provider secrets, or Skylight credentials in the mobile app.

## Security model

Every shared record includes a `household_id`. Row Level Security checks authenticated membership for every read or write. Only household owners and admins can manage invitations and membership.

Invitation acceptance and household creation should be implemented as server-side database functions or Edge Functions so membership changes remain atomic and cannot be forged by the client.

## Next application milestone

The next client milestone connects:

- email/password and Sign in with Apple
- household onboarding
- invitation acceptance
- realtime events, chores, notes, and messages
- offline cache and conflict handling
- push-token registration

Production email, provider OAuth, daily recaps, and integrations should run through Edge Functions or a dedicated backend worker.

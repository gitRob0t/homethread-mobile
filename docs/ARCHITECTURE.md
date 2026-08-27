# Coho production architecture

## Mobile client

Expo/React Native provides the iOS application, Android portability, over-the-air JavaScript updates, native notifications, deep links, and App Store builds through EAS. The client should remain a presentation and offline-cache layer; provider secrets and automation logic belong on the server.

## Current backend

- API and trusted actions: Supabase Edge Functions
- Database: Supabase PostgreSQL with row-level household isolation
- Authentication: Supabase Auth, verified email, and household invitation tokens
- Real-time updates: Supabase Realtime on household-scoped tables
- AI: OpenAI Responses API behind a server-side structured-action boundary
- Email: direct read-only Gmail and Outlook OAuth plus the separate Resend
  household-forwarding address
- Jobs: Supabase Cron invokes idempotent briefing, automation, notification,
  calendar, and mailbox reconciliation workers
- Notifications: Expo Push Service, with APNs credentials managed through EAS
- Device integrations: EventKit and Core Location through permissioned Expo modules
- Commerce handoff: Instacart Developer Platform shopping-list URLs
- Restaurant discovery: OpenTable web handoff until partner API access is approved

## Core entities

- users and profiles
- households, memberships, and invitations
- events and event follow-ups
- chores and personalized rewards
- notes and family messages
- Coh conversations, durable household actions, action history, and evaluation telemetry
- notification preferences, devices, outbox, deliveries, and open receipts
- household inboxes, inbound items, attachments, extraction results, and sender rules
- mailbox connections, encrypted grants, OAuth state, folder/history cursors,
  subscription state, and sync telemetry
- location consent, family locations, and Places
- grocery items and meal plans
- trips, trip members, and itinerary items
- integration connections
- provider calendar links, cursors, and explicit conflict records
- saved briefing snapshots and automation rules/runs
- onboarding readiness and privacy export/deletion requests

Every shared record carries a `household_id`. Authorization derives access from authenticated, server-side membership rather than a role supplied by the client.

## Integration model

Provider OAuth tokens must be encrypted server-side, scoped minimally, revocable, and never shipped to the app. Synchronization jobs must be idempotent and retain provider event IDs to prevent duplicates. A provider is shown as connected only after a successful credential or OAuth handshake.

The first integrations intentionally use supported public surfaces:

- selected iOS calendars through EventKit;
- direct Google and Outlook OAuth with encrypted refresh tokens and incremental
  two-way synchronization;
- direct read-only Gmail and Outlook mailbox connections;
- inbound family forwarding addresses through Resend;
- shopping-list handoff through Instacart;
- restaurant discovery through OpenTable;
- opt-in iPhone location through Core Location.

Coho must not claim unsupported access to Find My, AirTags, Skylight,
iCloud Mail or arbitrary IMAP accounts, reservation inventory, retailer prices,
or payment rails.

## Direct mailbox ingestion

Direct mailbox connections are different from the household forwarding
address. A user explicitly connects Gmail or Outlook through server-side OAuth;
Coho then observes selected folders and turns likely family commitments into
reviewable Family Inbox proposals.

```text
Connect Gmail/Outlook
  -> state + PKCE OAuth callback
  -> encrypted refresh grant (service role only)
  -> bounded initial read
  -> Gmail history / Outlook folder delta cursors
  -> normalized inbound item + deduplicated attachments
  -> deterministic and AI extraction
  -> adult review
  -> approved event, chore, note, or follow-up
```

The OAuth callback for both providers is
`https://PROJECT.supabase.co/functions/v1/mailbox-oauth`. Gmail Pub/Sub pushes
to `mailbox-webhook?provider=google&token=MAILBOX_WEBHOOK_SECRET`; Microsoft
Graph posts to `mailbox-webhook` and is authenticated with per-subscription
`clientState`. The webhook is only a wake-up signal. It never creates an event
and does not treat email content as an instruction or authorization.

Scopes are deliberately read-only:

- Google: `openid email profile gmail.readonly`
- Microsoft delegated: `openid email profile offline_access User.Read Mail.Read`

Provider tokens, OAuth verifier state, cursors, and subscriptions are
service-role-only. Mobile clients receive a sanitized connection summary, never
access or refresh tokens. Disconnect deletes the stored grant and revokes it
where the provider supports direct revocation.

Gmail uses `historyId` and Outlook uses a separate delta link for every selected
folder. Provider message IDs make ingestion idempotent. A ten-minute scheduled
sync renews Gmail watches and Graph subscriptions, catches missed webhooks, and
recovers an expired Gmail cursor with a bounded recent rescan. Sync runs record
counts and errors so renewal and extraction failures can be alerted.

Production availability is gated by Google restricted-scope verification (and
any required assessment), Microsoft publisher/tenant-consent requirements,
published privacy and deletion controls, verified webhook delivery,
reconciliation monitoring, and staging tests for revocation, duplicates,
attachments, and expired cursors. Until a provider passes those gates, its
connection tile must remain visibly unavailable rather than simulating a
connection.

## Coh trust boundary

Coh receives the user's private Coh conversation plus a bounded household snapshot: member names and roles, upcoming events, open chores, unchecked groceries, and near-term meals. It does not receive family chat, inbound email bodies, precise location, payment data, provider secrets, or unlimited history.

The model proposes a typed action. Server-side validation independently derives
hard missing fields and asks one deterministic follow-up at a time. The
application displays the complete proposal and requires explicit confirmation.
Events, chores, notes, shopping handoffs, reservations, invitations, purchases,
and money movement require the appropriate user confirmation; successful writes
are recorded rather than merely described.

## Delivery and review

Inbound email is untrusted. The forwarding receiver verifies the provider
signature; direct connectors validate OAuth grants and provider notification
secrets. Both paths reject or deduplicate repeated deliveries, fetch bodies and
allowed attachments server-side, bound retained content, and place candidates
in a human review queue. Email text may propose an action but never authorize
one. Coh sees an inbound item only after an explicit review action, and an adult
must approve every calendar or task write.

The briefing worker calculates each member's local schedule, honors independent push and email preferences, records provider results, and prevents duplicate deliveries for the same time window.

## Privacy and safety

Coho may process information about children, locations, schedules, messages, and household routines. Location is off by default, opt-in per device, revocable, and deleted from the shared location record when sharing is disabled. Trip membership does not grant access to the household.

Private JSON export, short-lived signed downloads, and verified in-app account
deletion are implemented. Before public launch the service still needs
age-aware onboarding, parental controls, family-member offboarding UX,
retention controls, administrator-visible audit history, rate/abuse controls,
centralized alerting, tested backup restoration, a published privacy policy, a
data-processing inventory, penetration testing, and a documented
incident-response process.

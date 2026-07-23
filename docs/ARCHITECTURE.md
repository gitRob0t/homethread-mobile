# Coho production architecture

## Mobile client

Expo/React Native provides the iOS application, Android portability, over-the-air JavaScript updates, native notifications, deep links, and App Store builds through EAS. The client should remain a presentation and offline-cache layer; provider secrets and automation logic belong on the server.

## Current backend

- API and trusted actions: Supabase Edge Functions
- Database: Supabase PostgreSQL with row-level household isolation
- Authentication: Supabase Auth, verified email, and household invitation tokens
- Real-time updates: Supabase Realtime on household-scoped tables
- AI: OpenAI Responses API behind a server-side structured-action boundary
- Email: Resend receiving webhook, Received Emails API, and transactional email
- Jobs: Supabase Cron invokes the idempotent briefing worker
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
- inbound family email through Resend;
- shopping-list handoff through Instacart;
- restaurant discovery through OpenTable;
- opt-in iPhone location through Core Location.

Coho must not claim unsupported access to Find My, AirTags, Skylight, personal mailboxes, reservation inventory, retailer prices, or payment rails.

## Coh trust boundary

Coh receives the user's private Coh conversation plus a bounded household snapshot: member names and roles, upcoming events, open chores, unchecked groceries, and near-term meals. It does not receive family chat, inbound email bodies, precise location, payment data, provider secrets, or unlimited history.

The model proposes a typed action. Server-side validation independently derives
hard missing fields and asks one deterministic follow-up at a time. The
application displays the complete proposal and requires explicit confirmation.
Events, chores, notes, shopping handoffs, reservations, invitations, purchases,
and money movement require the appropriate user confirmation; successful writes
are recorded rather than merely described.

## Delivery and review

Inbound email is untrusted. The receiver verifies the provider signature, rejects stale or duplicate deliveries, fetches the body server-side, bounds retained content, and places it in a human review queue. Coh sees an inbound item only after an explicit review action.

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

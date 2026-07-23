# Coho Mobile

Coho is your Chief of Home: a shared family command center for calendars, chores, messages, notes, daily recaps, and household integrations. Coho stands for Chief of Household Operations, and Coh is the in-app AI agent.

## Current native build

- Bright Bento home dashboard with saved dark mode
- Native bottom navigation and iPhone safe-area layout
- Shared calendar and upcoming events
- Assignable, completable chores with per-chore rewards such as game time, V-Bucks, allowance, points, or a custom privilege
- Separate family chat and private Coh workspace so AI follow-up questions do not overwhelm family messages
- Multi-turn, server-validated Coh action intake with exact missing-detail
  questions, explicit confirmation, correction, telemetry, and automated
  behavioral contracts
- Family Inbox extraction for email, PDFs, screenshots, calendar files, and
  approved attachments
- Click-through event details from Coh and Daily Sync
- Spoken Daily Sync playback configured for iPhone silent mode
- Configurable daily, week-ahead, and follow-up notifications
- Editable family profiles and shareable household invitations
- Shared notes, recap, integration, and settings screens backed by household data
- Quick-add sheet for events, chores, notes, and messages
- Local iOS notification permission, test notification, and recurring schedule flow
- Selected iPhone calendar import and approved-event write-back through EventKit/Expo Calendar
- Direct Google and Outlook OAuth with recurring events, incremental two-way
  sync, source visibility, cancellation propagation, deduplication, and
  in-app conflict resolution
- Opt-in phone location, approximate or precise sharing, Family Places, and arrival/departure alerts
- Shared grocery list, weekly meal planning, Coh Home Chef prompts, and a server-side Instacart shopping-list handoff
- Private trip spaces with invited friends/families, shared itineraries, and an OpenTable discovery handoff
- A reservable family email address with verified Resend webhooks, a human review queue, sender trust context, and explicit Coh review
- Registered device push tokens plus server-generated push/email daily, week-ahead, follow-up, and inbox notifications
- Bounded, household-scoped Coh context for truthful questions about upcoming events, open chores, groceries, and meals—without sending family chat, inbox content, or location history

Authentication, household membership, invitations, Row Level Security, realtime household data, Coh's server-side assistant, inbound email, provider handoffs, and briefing delivery are backed by Supabase. Provider credentials, domain verification, webhook registration, and the scheduled briefing invocation must be activated in the production accounts before the UI reports those integrations as connected.

See [docs/PRODUCT_STRATEGY.md](docs/PRODUCT_STRATEGY.md) for the market research, product rules, privacy model, and delivery phases.
Use [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the validated backend and
internal iOS release process.

## Run locally

```bash
npm install
npm run release:check
npm start
```

Scan the Expo QR code with a compatible development client, or run `npm run ios` with Xcode and an iOS simulator available.

## App Store path

1. Confirm access to the linked Coho EAS project (the existing project slug remains `homethread` for build continuity).
2. Confirm ownership of the `com.homethread.family` bundle identifier.
3. Add production backend and OAuth environment values through EAS secrets.
4. Create an Apple Developer app record and App Store Connect listing.
5. Run `eas build --platform ios --profile production`.
6. Test through TestFlight.
7. Run `eas submit --platform ios --profile production` after approval.

## Security baseline

- Do not store provider client secrets in the mobile app.
- Keep family data tenant-scoped and encrypted in transit and at rest.
- Use short-lived access tokens and platform keychain storage.
- Require explicit family-admin approval for invitations and integrations.
- Keep the implemented private export and verified in-app account-deletion
  flows operational; add age-aware retention and parental controls before a
  public child-directed launch.
- Keep AI-generated recaps private to the household and exclude them from model training by default.
- Treat inbound email as untrusted, verify provider signatures, and require human review before Coh sees it.
- Keep payment and purchase actions outside Coh's autonomous permissions; require itemized confirmation and provider receipts.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the production design.

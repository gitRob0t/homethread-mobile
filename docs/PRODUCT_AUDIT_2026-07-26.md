# COHO production product audit

Date: July 26, 2026

## Product call

COHO should become the operating system for household execution, not a collection of unrelated family utilities.

Its defensible loop is:

**Capture → Coh clarifies → family approves → correct person owns it → calendar or task is created → the alert opens the exact item → completion is verified → follow-up resurfaces**

Every major screen should strengthen that loop. Features that do not should wait until the loop is dependable for multiple real families.

## Release principles

1. Never show invented members, events, locations, counts, or recaps in a production build.
2. Every item keeps its source, owner, permissions, sync state, and action history.
3. Coh proposes consequential actions and shows a preview; a person approves before COHO commits them.
4. Person color means person everywhere. Provider, status, and category use labels or icons—not competing color meanings.
5. Family Chat and private Coh work are separate. Coh may post a compact approved result into Family Chat.
6. A notification is not complete until its deep link opens the exact event, chore, follow-up, message, or inbox item.
7. Connected does not mean healthy. Every integration reports permission, direction, last success, next sync, and errors.
8. Expansion follows reliability: calendar, inbox, Coh, notifications, and second-user coordination before finance or transaction-heavy commerce.

## Current product scorecard

| Area | Current strength | Material gap | Next production gate |
|---|---|---|---|
| Command Center | Live household data and actionable destinations | Prioritization still needs travel risk, broken syncs, and acknowledgement state | “Needs attention” is accurate, current, configurable, and never demo-backed |
| Calendar | Real shared events, provider identity, Apple reconciliation, new month/week/agenda foundation | Editing, recurrence exceptions, assignee relationships, visible-range loading, search, and travel-aware conflicts | A second member can create, edit, delete, accept, and open any event reliably |
| Coh | Private workspace, voice/attachment architecture, approval-oriented backend | Error diagnosis, durable conversation restoration, automated evaluations, and action correction | At least 95% of representative household requests reach the correct preview or ask the correct missing question |
| Family Chat | Live Supabase messages and separation from Coh | Replies, reactions, mentions, attachments, unread state, pagination, and contextual action conversion | “Turn into…” creates a reviewable event/chore/note without flooding chat |
| Chores | Assignee, due time, repeat, reminder, details, and several reward choices | Verification lifecycle, rotations, reward ledger, redemptions, audit history, and fair-load logic | Completion and reward balances remain correct after edits, reversals, and approvals |
| Family Inbox | Strong capture/review architecture | Real domain receiving, attachments/OCR, extraction confidence, dedupe, and approval-to-action reliability | Forwarded email/PDF reaches the correct household review queue and produces a traceable action |
| Notifications | Device registration, preferences, local schedules, and deep-link routing exist | Split local/server authority, swallowed failures, fixed quiet hours, and no end-to-end delivery suite | Server-authoritative delivery with observable retries and verified destination routing |
| Integrations | Categorized discovery and provider status concepts | Several entries are handoffs or placeholders; health and permission detail are incomplete | Fewer, deeper connections with honest capability labels and recovery controls |
| Family membership | Profiles, roles, photos, invitations, and realtime data foundation | Second-user acceptance and removal need repeatable end-to-end tests | A nontechnical invited adult succeeds without help on a fresh device |
| Operations | Migrations and backend contract checks | No component/E2E suite, route stack, offline queue, incident runbook, or tested export/deletion flow | Release checks block stale source, broken deep links, and failed multi-user flows |

## Calendar standard

### The product should support

- Month, week, and agenda views on phone; a denser Family Board on iPad and wall displays.
- A compact month grid with no more than two or three readable items and a `+N` overflow affordance.
- Family-member filters with a stable color plus initials/avatar so color is never the only cue.
- Source badges for COHO, Apple, Google, Outlook, school, and Family Inbox.
- Family-native event roles: owner, participants, driver, pickup person, approver, and visibility.
- Custom recurrence, alternating weeks, season end dates, exceptions, and “this / future / all events” editing.
- Conflict intelligence for overlaps, impossible travel, double-booked drivers, and events lacking a responsible adult.
- Coh-assisted creation that highlights understood details, asks only what is missing, previews the action, then confirms.
- Import review with the original email/PDF/image, extraction confidence, duplicate warning, selective approval, undo, and history.
- Provider IDs, deletion tombstones, recurrence exceptions, read-only states, and last-sync health.

COHO should adopt the clarity of Cozi’s per-person calendar and agenda views, Fantastical’s natural-language creation and calendar sets, and TimeTree’s event context—but close the full household ownership and follow-up loop those products do not. [Cozi Calendar](https://www.cozi.com/calendar/), [Fantastical Calendar Sets](https://flexibits.com/fantastical/help/calendar-sets), [Fantastical event creation](https://flexibits.com/fantastical-ios/help/adding-events-and-tasks), [TimeTree event attachments and comments](https://support.timetreeapp.com/hc/en-us/articles/203005559-How-to-attach-images-and-comment-events-after-creating-an-event)

### Deliberate pushback

The supplied dense desktop-style month example should not be copied literally to an iPhone. Seven text-heavy columns produce clipped names, tiny targets, and poor scanning once several family members are present. Apple’s calendar adapts views to the device, and Apple recommends sufficiently large, distinguishable controls. COHO should use adaptive density: compact month overview on phone, drill-down agenda, week view, and a separate wall/tablet board. [Apple Calendar views](https://support.apple.com/en-asia/guide/iphone/iphfd1054569/ios), [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility/)

## Command Center standard

The home surface should answer four questions in order:

1. What needs attention?
2. What happens next, and when should we leave?
3. Who owns it?
4. What changed since I last looked?

Recommended modules:

1. Broken sync, safety, conflict, and overdue alerts.
2. Now and next, including preparation and leave-by time.
3. Inbox approvals and Coh action previews.
4. Today’s responsibilities and approvals.
5. Dinner/grocery gap when Meals is enabled.
6. Follow-ups.
7. Upcoming seven days.
8. Consent-based family location freshness.

Users may pin, reorder, or hide ordinary modules. Critical broken-sync and safety alerts remain visible. “Single pane of glass” must mean a prioritized overview, not an endless wall of equally weighted cards.

## Family Chat standard

COHO should not try to replace iMessage or WhatsApp for general conversation. That is a low-leverage battle with mature network effects.

COHO should own **operational family communication**:

- replies, reactions, mentions, unread/action-needed filters, search, and attachments;
- event, chore, trip, inbox-item, and decision threads;
- “Turn into event / chore / note / assignment” on every message;
- pinned decisions and a compact household activity trail;
- Coh kept private unless a person shares an approved result;
- parent-managed child permissions and temporary/private planning spaces.

Threads reduce channel clutter in Slack, while consumer messengers set the interaction baseline for replies, mentions, filters, and privacy. COHO’s advantage is converting the conversation into a completed household outcome. [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-in-channels), [Apple inline replies and mentions](https://support.apple.com/en-gw/104974), [WhatsApp chat filters](https://about.fb.com/news/2024/04/whatsapp-chat-filters/)

## Chores, routines, and rewards standard

COHO should model three different things:

- **Chore:** one-time or repeating work.
- **Routine:** an ordered morning, afternoon, or bedtime sequence.
- **Responsibility:** continuing or rotating ownership.

Lifecycle:

**Scheduled → Ready → Claimed / In progress → Awaiting approval → Done / Missed / Skipped**

Each item may include assignee, approver, due window, recurrence exceptions, checklist, effort, reminders, proof, priority, rotation, reward, completion history, snooze, and skip reason.

Skylight distinguishes routines from chores; Sweepy uses workload-aware scheduling; S’moresUp and BusyKid demonstrate proof, approval, and reward mechanics. COHO should combine these with family context and fair-load suggestions. [Skylight Tasks](https://skylight.zendesk.com/hc/en-us/articles/36846381293979-Using-the-Tasks-Tab-Routines-and-Chores), [Sweepy](https://sweepy.com/), [S’moresUp](https://www.smoresup.com/pricing), [BusyKid](https://busykid.com/busykid-features/)

### Deliberate pushback

Rewards should be optional, not the default for every contribution. A large meta-analysis found that expected tangible rewards can undermine intrinsic motivation in some contexts. COHO should support contribution without reward, recognition, privileges, points, money, game time, and family goals. Public sibling leaderboards should also be opt-in; default to personal progress and cooperative household goals. [Motivation meta-analysis](https://pubmed.ncbi.nlm.nih.gov/10589297/)

The durable economy should use a ledger. A completed chore earns points or a direct advanced reward transaction; approval, reversal, redemption, and edits create new ledger entries rather than rewriting history.

## Integration standard

Directory:

- Connected
- Calendars
- Communication & Family Inbox
- School & Activities
- Food & Shopping
- Location & Safety
- Home & Devices
- Automations
- Finance, later

Every provider detail screen includes:

- connected account;
- granted permissions;
- read/write direction;
- household visibility;
- source labels;
- last successful and next sync;
- conflicts and retries;
- test, pause, reconnect, disconnect;
- delete imported data.

Status vocabulary:

**Permission granted · Connected · Syncing · Needs attention · Paused**

Do not present an outbound link as a transaction integration. Instacart/OpenTable handoffs must say “opens provider” until COHO can reliably create, observe, modify, and reconcile an order or reservation.

## Location standard

Location is opt-in and exception-oriented, not a surveillance engagement loop.

- Explicit consent per person and device.
- Clear freshness and accuracy.
- Temporary sharing and place-based alerts.
- Retention controls and visible access history.
- Useful exceptions: late arrival, missed pickup, left without expected driver—not constant map watching by default.

The FTC has already acted against improper precise-location handling, making consent, minimization, retention, and disclosure production requirements rather than optional polish. [FTC precise-location order](https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-order-will-ban-inmarket-selling-precise-consumer-location-data)

## Build sequence

### P0 — trust and release integrity

- Keep production free of prototype hydration and fake data.
- Make source verification a blocking release check.
- Fix real timestamps, Today selection, spoken Daily Sync ordering, and stale-provider deletion.
- Add observable Coh and notification errors.
- Complete second-user invitation, acceptance, removal, and realtime testing.

### P1 — dependable household loop

- Finish calendar editing, recurrence, assignments, conflicts, visible-range loading, and deep links.
- Complete Family Inbox receiving, attachments/OCR, confidence, dedupe, and approval.
- Persist Coh conversations and correction history; add action evaluations.
- Make notification dispatch server-authoritative.
- Add chore verification and reward ledger.

### P2 — depth

- Operational Family Chat with contextual conversion and threads.
- Travel buffers, leave-by guidance, and location exceptions.
- Meals and groceries connected to schedule and household preferences.
- iPad/wall mode, widgets, Watch, Android, and web.

### P3 — selective expansion

- Reservations and commerce only when they can complete and reconcile a transaction.
- Finance only after privacy, permission, security, audit, and incident-response maturity meet the higher risk.

## Required release evidence

No production candidate advances without:

- TypeScript and static backend contracts;
- source/branch integrity check;
- migration validation;
- calendar timezone, recurrence, assignment, range, and deletion tests;
- notification delivery and deep-link tests;
- Coh evaluation set for missing details, corrections, duplicates, and failed actions;
- fresh-device owner and invited-member end-to-end journeys;
- accessibility pass for Dynamic Type, VoiceOver labels, contrast, and touch targets;
- offline/retry recovery exercise;
- verified export and deletion path.

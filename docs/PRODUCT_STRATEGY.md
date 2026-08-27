# Coho product strategy: the family command center

## Product promise

Coho is the Chief of Household Operations: the integrated operating system for home, family, and the trusted people around them.

The product should feel less like another calendar and more like a chief of staff for home. Coh asks the missing question, connects scattered information, proposes the next action, waits for approval when privacy or money matters, and then follows through.

**Positioning line:** Everything home, integrated.

## Naming decision

Keep **Coho** as the product name and make **integration** the promise, not the name. “Integrate” describes plumbing; “Coho” gives the household a memorable noun and makes “Hey Coh” ownable as a daily behavior. The expansion path is:

- **Coho** — the product and family command center
- **Coh** — the Chief of Home agent
- **Coho Inbox, Coho Places, Coho Chef, Coho Trips, Coho Money** — clear product pillars

A trademark, domain, and App Store name clearance must still happen before public launch.

## What the market already proves

| Product | What families value | Coho's opportunity |
| --- | --- | --- |
| [Skylight Calendar](https://myskylight.com/calendar) | A visible shared calendar, chores, lists, meals, and a dedicated home display | Be mobile-first, conversational, and action-oriented instead of display-first |
| [Skylight Sidekick](https://myskylight.com/calendar-max) | Turning emails, PDFs, and paper into calendar events | Provide a household inbox with a review queue, source traceability, and follow-up automation |
| [Life360](https://www.life360.com/learn/how-does-life360-work) | Family location, place alerts, arrival/departure context, and safety notifications | Use explicit consent, family-defined Places, and useful home actions—not surveillance |
| [FamilyWall](https://www.familywall.com/en/index.html) | Private family messaging, schedules, lists, and location | Keep human chat human; move Coh into its own action workspace |
| [Maple](https://www.growmaple.com/email) | Selective email connection and AI extraction | Support forwarding and sender allowlists so families never have to expose an entire inbox |
| [Hearth](https://hearthdisplay.com/pages/features) | Routines, streaks, stars, and rewards | Let every chore grant the reward that motivates that family member: game time, V-Bucks, allowance, points, or a custom privilege |
| [Cozi](https://play.google.com/store/apps/details?id=com.cozi.androidfree) | Familiar shared calendar, reminders, and lists | Deliver the same fundamentals with automation and less manual maintenance |

## The household operating system

| Pillar | Daily job | Production posture |
| --- | --- | --- |
| Chief of Home | Brief today, show the week ahead, resurface follow-ups, resolve conflicts | Real household events, chores, messages, and push delivery |
| Family Inbox | Collect school, appointment, activity, travel, and reservation email | Verified provider webhook, limited storage, human review before Coh |
| Calendar | Merge selected calendars and write back only approved events | Device calendar connection first; direct provider OAuth later |
| Family Chat | Let people coordinate without AI noise | Human channel separated from the private Coh workspace |
| Chores & Rewards | Turn contribution into personally meaningful rewards | Per-person reward goals and per-chore values |
| Places | Answer “where are we?” and automate arrivals/departures | Per-person opt-in phone location; no Find My/AirTag access claims |
| Chef | Plan meals around allergies, budget, schedule, leftovers, and preferences | Shared meal plan/grocery data plus approved shopping handoff |
| Trips | Invite another family, share an itinerary, discover food and activities | Separate trip membership and data boundary |
| Money | Allowances, family cards, spend awareness, and savings suggestions | Later regulated/payment-provider phase; never autonomous transfers |

## Product rules

1. **Family chat stays human.** Coh lives in a separate workspace, but can send a concise, approved result back to the family.
2. **Suggestions are not commitments.** Imported email and AI-extracted events remain in a review queue until a family member approves them.
3. **Every action is inspectable.** Events opened from a recap or Coh answer show their source, person, time, place, reminder, and status.
4. **Privacy is a feature.** Location is off by default, per-person, revocable, and based on phone permission. Coho does not attempt to access Apple's private Find My or AirTag network.
5. **The system earns trust before autonomy.** Coh first asks, then suggests, then automates only after the household creates a rule.
6. **Connection state is factual.** A provider is never shown as connected until OAuth, credentials, or the webhook handshake succeeds.
7. **Purchases are itemized and confirmed.** Grocery orders, reservations with deposits, card loads, and payments require a final human review with total, provider, recipient, and cancellation terms.

## Household inbox

The preferred experience is a memorable address such as `yourfamily@coho.ai`. During infrastructure rollout, addresses can be provisioned under `inbox.coho.ai` and later promoted to the root domain.

The inbox pipeline is:

1. Receive a forwarded email or provider-authorized message.
2. Store the sender, subject, source, and a limited preview.
3. Extract proposed events, tasks, forms, and follow-ups.
4. Show every proposal in **Needs review**.
5. Let an adult approve, edit, reject, or create a reusable sender rule.
6. Preserve a link back to the source so the family can understand why an item exists.

No personal mailbox should be scraped by default. Forwarding, sender allowlists, and explicitly selected folders are the safe starting points.

The coded first-party route uses Resend inbound email. It verifies each webhook signature, deduplicates deliveries, retrieves the email body server-side, stores only a bounded text copy plus attachment metadata, and sends every item to a review queue. Attachments are not automatically opened.

## Location and Places

Coho can build Life360-style family Places with Core Location and explicit background-location permission. A family member can opt into precise or approximate sharing and arrival/departure alerts for places such as Home, School, Work, or a friend's house.

Apple’s Find My network is intended for approved accessory products, not a third-party API for reading people or AirTag positions. Coho should therefore use each consenting family member’s iPhone location. It should never imply that it can silently follow an AirTag or another person’s Find My location.

## Trips, friends, and vacations

A trip is not automatically part of the household. It has its own invited membership, roles, schedule, and privacy boundary. That lets a family invite friends or another household for one vacation without exposing chores, household chat, locations, notes, or inbox items.

Coh can gather destination, dates, travelers, ages, budget, food needs, pace, and transportation, then help build the itinerary. Restaurant discovery can hand off to a real provider; Coho must not claim a reservation until the provider returns confirmation.

## Chef and commerce

Coho Chef should combine real household context:

- meal schedule and attendance
- allergies, restrictions, dislikes, and favorites
- grocery inventory/list
- weekly budget and preferred stores
- leftovers and preparation time

The first commerce integration creates a real Instacart shopping-list URL from unchecked household groceries. Price comparison, local inventory, delivery windows, DoorDash ordering, and automatic substitutions require provider access and must not be simulated.

## Money guardrails

Money can become a later product pillar only through regulated partners and explicit adult controls. A safe sequence is:

1. read-only transaction aggregation with clear consent;
2. family budgets, allowance ledgers, and savings recommendations;
3. card controls and loads through a regulated issuer/processor;
4. itemized, confirmed payments with receipts and dispute paths.

Coh must never move money because of an email, chat message, location event, or inferred intent.

## Delivery phases

### Phase 1 — Trustworthy daily use

- Family chat separated from Coh
- Multi-turn Coh event creation with missing-detail questions
- Click-through event details from Coh and Daily Sync
- Audible Daily Sync playback
- Configurable chore rewards
- Real notification permission, test, and recurring schedules
- Household invitations that survive signup and join the correct family

### Phase 2 — Information intake

- Household inbox reservation
- Email provider webhook and inbound parser
- Needs-review queue and source view
- Calendar provider authorization and conflict detection
- Sender allowlists and reusable approval rules

### Phase 3 — Family awareness

- Consent-first phone location
- Family Places and arrival/departure alerts
- Time-to-leave and pickup handoff suggestions
- Child and adult privacy controls with audit history

### Phase 4 — The ambient command center

- iPad and wall-display mode
- Voice briefing and household status board
- Proactive conflict resolution
- Hardware partnerships only after the mobile command center is indispensable

### Phase 5 — Home services and commerce

- Pantry-aware meal planning and family preference memory
- Provider-backed grocery pricing, inventory, and checkout
- Restaurant search and confirmed reservation workflows
- Household service marketplace with explicit quotes and approvals

### Phase 6 — Family financial operating layer

- Allowance and reward ledgers
- Read-only spend insights
- Regulated family card partner
- Savings recommendations and adult-controlled funding

## Acquisition-ready architecture

Coho’s long-term strategic value is not a collection of screens. It is a permissioned household graph plus a trustworthy action layer:

- people and relationships
- commitments and routines
- places and movement consent
- preferences and constraints
- household communications
- provider connections and auditable approvals

Each provider sits behind a replaceable service boundary. Household data remains tenant-scoped. Coh’s structured action schema separates reasoning from execution. Those choices make Coho useful as a standalone product and technically legible to a future platform acquirer.

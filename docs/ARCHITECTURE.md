# HomeThread production architecture

## Mobile client

Expo/React Native provides the iOS application, Android portability, over-the-air JavaScript updates, native notifications, deep links, and App Store builds through EAS. The client should remain a presentation and offline-cache layer; provider secrets and automation logic belong on the server.

## Recommended backend

- API: TypeScript service with REST or tRPC endpoints
- Database: PostgreSQL with row-level household isolation
- Authentication: Sign in with Apple plus verified email invitations
- Real-time updates: WebSockets or a managed realtime database channel
- Files: encrypted object storage with signed, short-lived URLs
- Jobs: durable queue for email ingestion, provider synchronization, recaps, and reminders
- Email: dedicated inbound family address plus transactional email provider
- Notifications: Expo Push Service initially, with APNs credentials managed through EAS

## Core entities

- User
- Household
- HouseholdMember
- Invitation
- Event
- Chore
- Note
- Conversation
- Message
- RecapPreference
- IntegrationConnection
- AutomationRule
- AuditEvent

Every user-generated record carries a `householdId`. Authorization checks must derive household access from server-side membership rather than client-supplied roles.

## Integration model

Provider OAuth tokens must be encrypted server-side and scoped minimally. Synchronization jobs should be idempotent and retain provider event IDs to prevent duplicate family events. The Skylight connector should only be enabled after its supported integration mechanism and commercial terms are confirmed.

## Privacy and safety

HomeThread may process information about children, locations, schedules, messages, and household routines. The production service needs data minimization, age-aware onboarding, parental controls, family-member offboarding, complete deletion, audit trails, abuse prevention, and a documented incident response process before public launch.

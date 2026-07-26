import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const [repair, choreScheduling, familyManagement, notificationProfiles, emailSourcesMigration, securityRelease, edgeClient, familyData, emailSources, deviceCalendar, calendarSync, pushNotifications, notificationDispatcher, householdOS, app, deploy, supabaseConfig, invitationFunction, assistant, extractor] = await Promise.all([
  read('supabase/migrations/202607230008_edge_function_repairs.sql'),
  read('supabase/migrations/202607230009_chore_scheduling.sql'),
  read('supabase/migrations/202607250001_family_management.sql'),
  read('supabase/migrations/202607250002_notification_profiles.sql'),
  read('supabase/migrations/202607260001_email_sources.sql'),
  read('supabase/migrations/202607260002_email_event_security_release.sql'),
  read('src/services/edgeFunctions.ts'),
  read('src/services/familyData.ts'),
  read('src/services/emailSources.ts'),
  read('src/services/deviceCalendar.ts'),
  read('supabase/functions/calendar-sync/index.ts'),
  read('src/services/pushNotifications.ts'),
  read('supabase/functions/dispatch-notifications/index.ts'),
  read('src/components/HouseholdOS.tsx'),
  read('App.tsx'),
  read('scripts/deploy-supabase.sh'),
  read('supabase/config.toml'),
  read('supabase/functions/send-household-invite/index.ts'),
  read('supabase/functions/coh-assistant/index.ts'),
  read('supabase/functions/coh-extract/index.ts'),
]);

const contracts = [
  ['secure tokens use hosted pgcrypto schema', repair, /extensions\.gen_random_bytes\(24\)/],
  ['invitation hashes use hosted pgcrypto schema', repair, /extensions\.digest\(raw_token, 'sha256'\)/],
  ['Edge requests carry an explicit user token', edgeClient, /Authorization: `Bearer \$\{accessToken\}`/],
  ['expired Edge sessions refresh once', edgeClient, /supabase\.auth\.refreshSession\(\)/],
  ['Edge error bodies are surfaced safely', edgeClient, /response\.clone\(\)\.json\(\)/],
  ['deployment pins the supported Coh model', deploy, /gpt-5\.6-sol/],
  ['assistant defaults to the supported Coh model', assistant, /'gpt-5\.6-sol'/],
  ['inbox extraction defaults to the supported Coh model', extractor, /'gpt-5\.6-sol'/],
  ['direct chores store due reminders', choreScheduling, /add column if not exists reminder_minutes integer/],
  ['recurring chores create the next occurrence', choreScheduling, /create_next_recurring_chore/],
  ['recurring chore instances are deduplicated', choreScheduling, /chores_series_due_unique_idx/],
  ['reopened chores cannot spawn duplicate occurrences', choreScheduling, /new\.next_occurrence_id is not null/],
  ['direct chore reminders use the notification outbox', choreScheduling, /insert into public\.notification_outbox/],
  ['chore creation persists schedule and owner details', familyData, /assigned_person_id: input\.assignedPersonId/],
  ['canceled calendar events stay out of the family calendar', familyData, /\.neq\('status', 'canceled'\)/],
  ['device calendar imports preserve their source calendar', deviceCalendar, /source_calendar_id: event\.calendarId/],
  ['missing iPhone events are canceled during reconciliation', deviceCalendar, /status: 'canceled'/],
  ['device imports use explicit insert and update with partial-index dedupe', deviceCalendar, /persistDeviceCalendarRows[\s\S]*from\('events'\)\.insert[\s\S]*from\('events'\)\.update/],
  ['cloud imports use explicit insert and update with partial-index dedupe', calendarSync, /existingEvent[\s\S]*from\('events'\)\.update[\s\S]*from\('events'\)\.insert/],
  ['all-day Google events always use an exclusive end date', calendarSync, /googleAllDayEndDate/],
  ['internal event metadata is sanitized before provider export', calendarSync, /calendarDescription\(event\.details\)/],
  ['calendar sync reports removed iPhone events', householdOS, /deleted event.*removed from Coho/],
  ['member removal requires household administration', familyManagement, /if not public\.is_household_admin\(target_household\)/],
  ['household owners cannot be removed', familyManagement, /if member_role = 'owner'/],
  ['member removal clears household access', familyManagement, /delete from public\.household_members/],
  ['linked profiles cannot bypass member removal', familyManagement, /if person\.linked_user_id is not null/],
  ['More menu preferences are private to their user', familyManagement, /using \(user_id = auth\.uid\(\)\)[\s\S]*with check \(user_id = auth\.uid\(\)\)/],
  ['notification profiles persist quiet hours', notificationProfiles, /add column if not exists quiet_hours boolean not null default true/],
  ['saved notification profiles are loaded on sign in', pushNotifications, /loadBriefingPreferences[\s\S]*from\('notification_preferences'\)/],
  ['quiet hours defer non-urgent notification delivery', notificationDispatcher, /Deferred by quiet hours\./],
  ['urgent notifications bypass quiet hours', notificationDispatcher, /item\.payload\?\.urgent === true/],
  ['any valid email address can be registered as a household source', emailSources, /Enter a complete email address, such as chad@cragles\.net/],
  ['email source records never require a mailbox credential', emailSourcesMigration, /connection_method text not null default 'forwarding'/],
  ['email sources are isolated by household membership', emailSourcesMigration, /members read household email sources[\s\S]*is_household_member\(household_id\)/],
  ['only household administrators can manage email sources', emailSourcesMigration, /admins manage household email sources[\s\S]*is_household_admin\(household_id\)/],
  ['local and Coh events are excluded from provider deduplication', securityRelease, /create unique index events_provider_event_dedupe_idx[\s\S]*where provider_event_id is not null/],
  ['legacy null-aware event uniqueness is removed', securityRelease, /drop constraint if exists events_household_id_provider_provider_event_id_key/],
  ['spoofable email-source activation is removed', securityRelease, /drop trigger if exists activate_household_email_source_after_inbound[\s\S]*drop function if exists public\.activate_household_email_source\(\)/],
  ['only adult admins read raw inbound email items', securityRelease, /adult admins read inbound review queue[\s\S]*is_household_admin\(household_id\)/],
  ['only adult admins read raw inbound attachment metadata', securityRelease, /adult admins read inbound attachments[\s\S]*is_household_admin\(household_id\)/],
  ['private attachment bytes follow adult-admin access', securityRelease, /household admins read reviewed inbox attachments[\s\S]*is_household_admin/],
  ['manual event creation persists independently of Coh', app, /async function saveManualEvent[\s\S]*createFamilyEvent/],
  ['manual reminders schedule an actionable iOS deep link', app, /scheduleManualEventReminder[\s\S]*coho:\/\/event/],
  ['manual recurring events expand in the Coho calendar', app, /expandCloudEvent[\s\S]*nextRecurringDate/],
  ['event creation exposes calendar email manual and Coh paths', app, /onEventSource\('manual'\)[\s\S]*onEventSource\('coh'\)[\s\S]*onEventSource\('email'\)[\s\S]*onEventSource\('calendar'\)/],
  ['integrations are grouped into navigable categories', app, /view: 'Calendars'[\s\S]*view: 'Food & Dining'[\s\S]*view: 'Location & Safety'/],
  ['the main view is a live family command center', app, /FAMILY COMMAND CENTER[\s\S]*Needs attention[\s\S]*Family pulse/],
  ['integration status reloads from persisted providers', app, /listCalendarConnections\(household\.id\)[\s\S]*getHouseholdInbox\(household\.id\)[\s\S]*getLocationSharingState/],
  ['invite landing pages bypass gateway JWT verification', supabaseConfig, /\[functions\.send-household-invite\][\s\S]*verify_jwt = false/],
  ['invite deployment preserves its public landing page', deploy, /public_entry_functions=\([\s\S]*send-household-invite[\s\S]*\)/],
  ['invite creation still requires a user session', invitationFunction, /if \(!authorization\) return json\(\{ error: 'Authentication required\.' \}, 401\)/],
  ['invite POST validates the bearer token', invitationFunction, /client\.auth\.getUser\(\)/],
];

for (const [name, source, pattern] of contracts) {
  assert.match(source, pattern, `Missing backend contract: ${name}`);
}
assert.doesNotMatch(assistant, /gpt-5\.6-terra/, 'Assistant uses an unsupported model default.');
assert.doesNotMatch(extractor, /gpt-5\.6-terra/, 'Inbox extraction uses an unsupported model default.');
assert.doesNotMatch(
  securityRelease,
  /on public\.(?:inbound_items|inbound_attachments)\s+for insert/i,
  'Release hardening must not replace service-role ingestion with authenticated inserts.',
);
assert.doesNotMatch(
  `${deviceCalendar}\n${calendarSync}`,
  /onConflict:\s*['"]household_id,provider,provider_event_id['"]/,
  'Provider imports must not target the local-event partial unique index through an unqualified upsert.',
);

console.log(`✓ ${contracts.length} backend reliability contracts passed`);

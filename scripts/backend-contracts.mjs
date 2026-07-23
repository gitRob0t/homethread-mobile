import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const [repair, choreScheduling, edgeClient, familyData, deploy, assistant, extractor] = await Promise.all([
  read('supabase/migrations/202607230008_edge_function_repairs.sql'),
  read('supabase/migrations/202607230009_chore_scheduling.sql'),
  read('src/services/edgeFunctions.ts'),
  read('src/services/familyData.ts'),
  read('scripts/deploy-supabase.sh'),
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
];

for (const [name, source, pattern] of contracts) {
  assert.match(source, pattern, `Missing backend contract: ${name}`);
}
assert.doesNotMatch(assistant, /gpt-5\.6-terra/, 'Assistant uses an unsupported model default.');
assert.doesNotMatch(extractor, /gpt-5\.6-terra/, 'Inbox extraction uses an unsupported model default.');

console.log(`✓ ${contracts.length} backend reliability contracts passed`);

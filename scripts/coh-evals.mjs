import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'supabase/functions/coh-assistant/index.ts'), 'utf8');

const offlineContracts = [
  ['actionable facts never get a capabilities menu', /Never respond with a generic list of capabilities/],
  ['haircut starts an event flow', /If the user says “I have a haircut,” immediately begin the event flow/],
  ['one missing question per turn', /Ask exactly one highest-priority missing-detail question at a time/],
  ['writes require confirmation', /Before a write, summarize the exact proposal and ask for explicit confirmation/],
  ['server validates event date and time', /missing\.add\('date and time'\)/],
  ['server replaces capability fallbacks', /soundsLikeCapabilityFallback/],
  ['requests are retried safely', /fetchWithRetry/],
  ['model responses emit latency telemetry', /coh_response_completed/],
];

for (const [name, pattern] of offlineContracts) {
  assert.match(source, pattern, `Missing Coh contract: ${name}`);
}
console.log(`✓ ${offlineContracts.length} offline Coh contracts passed`);

const accessToken = process.env.COHO_EVAL_ACCESS_TOKEN;
const householdId = process.env.COHO_EVAL_HOUSEHOLD_ID;
if (!accessToken || !householdId) {
  console.log('↷ Live Coh scenarios skipped. Set COHO_EVAL_ACCESS_TOKEN and COHO_EVAL_HOUSEHOLD_ID to run them.');
  process.exit(0);
}

const supabaseUrl = process.env.COHO_EVAL_SUPABASE_URL;
const anonKey = process.env.COHO_EVAL_ANON_KEY;
assert.ok(
  supabaseUrl && anonKey,
  'Set COHO_EVAL_SUPABASE_URL and COHO_EVAL_ANON_KEY before running live Coh scenarios.',
);
const timezone = process.env.COHO_EVAL_TIMEZONE || 'America/New_York';
const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/coh-assistant`;
const conversations = new Set();

async function ask(message, conversationId = null) {
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      conversationId,
      householdId,
      timezone,
      history: [],
    }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `Coh HTTP ${response.status}: ${payload?.error || 'unknown error'}`);
  assert.ok(payload.conversationId, 'Coh must return a conversation ID.');
  conversations.add(payload.conversationId);
  assert.ok(payload.reply?.trim(), 'Coh must return a user-facing reply.');
  assert.ok(Date.now() - started < 45_000, 'Coh exceeded the 45-second evaluation budget.');
  return payload;
}

function assertInteractive(result) {
  assert.doesNotMatch(
    result.reply.toLowerCase(),
    /i can add events|i can help with|try ["“]hey coh/,
    'Coh fell back to a capabilities menu.',
  );
}

try {
  const haircut = await ask('[EVAL] I have a haircut.');
  assert.equal(haircut.intent, 'event');
  assert.equal(haircut.status, 'collecting');
  assert.ok(haircut.missing_fields.includes('date and time'));
  assert.match(haircut.reply, /\?/);
  assertInteractive(haircut);

  const scheduled = await ask('Wednesday at 9:30 AM.', haircut.conversationId);
  assert.equal(scheduled.intent, 'event');
  assert.ok(scheduled.draft.starts_at, 'Coh did not preserve and resolve the event date/time.');
  assertInteractive(scheduled);

  const enriched = await ask(
    'It is at Brass Barber. Give me a 15-minute reminder.',
    haircut.conversationId,
  );
  assert.equal(enriched.draft.location, 'Brass Barber');
  assert.equal(enriched.draft.reminder_minutes, 15);
  assertInteractive(enriched);

  const chore = await ask(
    '[EVAL] Take out the trash tomorrow at 6 PM and earn 20 minutes of game time.',
  );
  assert.equal(chore.intent, 'chore');
  assert.equal(chore.draft.reward_type, 'game_time');
  assert.equal(chore.draft.reward_value, 20);
  assert.ok(chore.draft.due_at, 'Coh did not resolve the chore due time.');
  assertInteractive(chore);

  console.log('✓ 4 live Coh scenarios passed');
} finally {
  await Promise.all([...conversations].map((conversationId) =>
    ask('Cancel this evaluation request.', conversationId).catch(() => undefined),
  ));
}

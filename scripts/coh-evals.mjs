import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'supabase/functions/coh-assistant/index.ts'), 'utf8');
const hardening = await readFile(
  path.join(root, 'supabase/migrations/20260728143416_coh_agent_hardening.sql'),
  'utf8',
);
const responseSchemaSource = source.slice(
  source.indexOf('const responseSchema'),
  source.indexOf('type CohAttachment'),
);

const offlineContracts = [
  ['actionable facts never get a capabilities menu', /Never respond with a generic list of capabilities/],
  ['haircut starts an event flow', /If the user says “I have a haircut,” immediately begin the event flow/],
  ['compact useful questions', /Ask one compact, useful question at a time/],
  ['travel fragments begin planning', /Treat fragments such as "lake"[\s\S]*likely travel planning/],
  ['assistant history uses valid string content', /assistant history as input_text caused Responses API invalid_value/],
  ['travel remains collecting without a write action', /result\.intent === 'travel'[\s\S]*planningMissing[\s\S]*'collecting'/],
  ['model is proposal-only', /You may only propose or correct work\. You can never confirm, cancel, or execute it/],
  ['server validates event date and time', /missing\.add\('date and time'\)/],
  ['server replaces capability fallbacks', /soundsLikeCapabilityFallback/],
  ['requests use a durable idempotency claim', /claim_assistant_request/],
  ['provider attempts have bounded timeouts', /OPENAI_ATTEMPT_TIMEOUT_MS[\s\S]*AbortController/],
  ['provider failure has deterministic behavior', /deterministicFallback/],
  ['conversation recovery returns durable turns', /operation === 'resume'[\s\S]*activeAction/],
  ['recovery distinguishes message and action requests', /operation: reconciledRequestState\?\.operation[\s\S]*rawRequestState\?\.operation[\s\S]*requestState: reconciledRequestState\?\.status[\s\S]*retryable:/],
  ['recovery preserves attachment and timezone retry metadata', /attachmentCount: turn\.role === 'user'[\s\S]*timezone: turn\.role === 'user'[\s\S]*attachment_count: attachments\.length[\s\S]*timezone: body\?\.timezone \?\? null/],
  ['recovery exposes requests that have no durable turn', /outstandingRequests[\s\S]*hasProcessingRequests[\s\S]*requestRow\.status === 'processing'/],
  ['recovery returns recent terminal receipts', /terminalReceiptCutoff[\s\S]*terminal conversation query[\s\S]*\['confirm', 'cancel'\][\s\S]*reconciledStatus[\s\S]*response:/],
  ['closed receipt history never becomes the active conversation', /conversationId: requestRow\.conversation_id[\s\S]*conversationId: conversation\.closed_at \? null : conversation\.id/],
  ['newer terminal receipts outrank stale unfinished work', /Compare unfinished work with recent terminal receipts by updated[\s\S]*Date\.parse\(right\.updated_at\) - Date\.parse\(left\.updated_at\)/],
  ['recovery keeps the newest bounded history', /Keep the newest bounded window[\s\S]*order\('created_at', \{ ascending: false \}\)[\s\S]*\.reverse\(\)/],
  ['recovery is not masked by another open conversation', /unfinished request recovery query[\s\S]*terminal request recovery query[\s\S]*Reconciliation is household-wide rather than tied/],
  ['committed actions recover a terminal receipt without executing again', /terminalReceiptFromAction[\s\S]*request-specific marker is authoritative proof[\s\S]*reconciledStatus/],
  ['durable terminal markers outrank stale worker errors', /durable action markers outrank that stale[\s\S]*recoveredTerminalResponse \?\? requestRow\.response_payload/],
  ['terminal recovery reconciles request-backed turns', /reconciledRequestById[\s\S]*requestState: reconciledRequestState\?\.status/],
  ['proposals use the protected database RPC', /rpc\('propose_coh_action'/],
  ['confirmation requires identity version and digest', /actionId, expectedVersion, and proposalHash/],
  ['confirmation uses the protected database RPC', /operation === 'confirm' \? 'confirm_coh_action' : 'cancel_coh_action'/],
  ['model responses emit latency telemetry', /coh_response_completed/],
];

for (const [name, pattern] of offlineContracts) {
  assert.match(source, pattern, `Missing Coh contract: ${name}`);
}
assert.match(
  responseSchemaSource,
  /enum: \['collecting', 'ready_for_confirmation', 'answered'\]/,
  'The model status schema must remain proposal-only.',
);
assert.doesNotMatch(
  responseSchemaSource,
  /confirmed|canceled/,
  'The model must not be able to emit terminal action statuses.',
);
assert.doesNotMatch(
  source,
  /supabase\.rpc\('approve_and_execute_household_action'/,
  'The Edge Function must not execute an action outside the protected confirmation RPC.',
);
assert.match(
  hardening,
  /confirm_coh_action[\s\S]*expected_version integer[\s\S]*expected_proposal_hash text/,
  'Confirmation must be versioned and bound to the proposal digest.',
);
assert.match(
  hardening,
  /confirmation_request_id = target_request[\s\S]*approve_and_execute_household_action/,
  'Confirmation must persist its replay marker atomically with execution.',
);
assert.match(
  hardening,
  /proposal_action_id = updated_action\.id[\s\S]*proposal_snapshot = to_jsonb\(updated_action\)[\s\S]*proposal_action_id is null/,
  'A proposal request must persist its immutable result before returning.',
);
assert.match(
  hardening,
  /request_row\.proposal_action_id is not null[\s\S]*request_row\.proposal_action_version[\s\S]*request_row\.proposal_hash[\s\S]*superseded\. Resume/,
  'A replayed proposal request must never overwrite a newer correction.',
);
assert.match(
  hardening,
  /input_proposed_payload jsonb[\s\S]*proposed_payload = coalesce\(input_proposed_payload/,
  'Proposal corrections must not use an ambiguous payload parameter.',
);
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
const openProposals = new Map();

async function invoke(body) {
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      householdId,
      timezone,
      ...body,
    }),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `Coh HTTP ${response.status}: ${payload?.error || 'unknown error'}`);
  assert.ok(payload.reply?.trim(), 'Coh must return a user-facing reply.');
  assert.ok(Date.now() - started < 45_000, 'Coh exceeded the 45-second evaluation budget.');
  return payload;
}

async function ask(message, conversationId = crypto.randomUUID()) {
  const payload = await invoke({
    operation: 'message',
    requestId: crypto.randomUUID(),
    conversationId,
    message,
  });
  assert.ok(payload.conversationId, 'Coh must return a conversation ID.');
  assert.ok(payload.requestId, 'Coh must return the stable request ID.');
  if (payload.action) openProposals.set(payload.conversationId, payload);
  return payload;
}

async function finishProposal(operation, proposal) {
  assert.ok(proposal?.action?.id, `Cannot ${operation} without an action ID.`);
  assert.ok(Number.isInteger(proposal.action.version), `Cannot ${operation} without a version.`);
  assert.match(proposal.action.proposalHash, /^[0-9a-f]{64}$/);
  const payload = await invoke({
    operation,
    requestId: crypto.randomUUID(),
    conversationId: proposal.conversationId,
    actionId: proposal.action.id,
    expectedVersion: proposal.action.version,
    proposalHash: proposal.action.proposalHash,
  });
  openProposals.delete(proposal.conversationId);
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
  assert.equal(enriched.status, 'ready_for_confirmation');
  assertInteractive(enriched);
  const confirmed = await finishProposal('confirm', enriched);
  assert.equal(confirmed.status, 'confirmed');
  assert.ok(confirmed.action.targetId, 'Confirmed Coh event must have a durable destination.');

  const chore = await ask(
    '[EVAL] Take out the trash tomorrow at 6 PM and earn 20 minutes of game time.',
  );
  assert.equal(chore.intent, 'chore');
  assert.equal(chore.draft.reward_type, 'game_time');
  assert.equal(chore.draft.reward_value, 20);
  assert.ok(chore.draft.due_at, 'Coh did not resolve the chore due time.');
  assertInteractive(chore);

  console.log('✓ 5 live Coh scenarios passed');
} finally {
  await Promise.all(
    [...openProposals.values()].map((proposal) =>
      finishProposal('cancel', proposal).catch(() => undefined),
    ),
  );
}

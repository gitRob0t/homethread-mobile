-- Harden Coh's request, proposal, confirmation, and recovery boundaries.
-- The model may propose household work, but only an explicit, versioned
-- confirmation may execute it.

alter table public.assistant_conversations
  add column if not exists closed_at timestamptz;

alter table public.assistant_turns
  add column if not exists request_id uuid;

create unique index if not exists assistant_turns_request_role_unique_idx
  on public.assistant_turns(user_id, request_id, role)
  where request_id is not null;

alter table public.household_actions
  add column if not exists proposal_hash text,
  add column if not exists proposal_request_id uuid,
  add column if not exists confirmation_request_id uuid,
  add column if not exists cancellation_request_id uuid;

alter table public.household_actions
  drop constraint if exists household_actions_proposal_hash_check;
alter table public.household_actions
  add constraint household_actions_proposal_hash_check
  check (proposal_hash is null or proposal_hash ~ '^[0-9a-f]{64}$');

create or replace function public.guard_coh_action_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  -- Referential actions (for example removing an assignee) must not make
  -- household/account deletion impossible. They invalidate the proposal so
  -- it must be re-proposed before confirmation.
  if pg_trigger_depth() > 1 then
    new.proposal_hash := null;
    if new.status in ('draft', 'pending_approval') then
      new.status := 'needs_details';
    end if;
    return new;
  end if;
  -- Only the private proposal is protected here. Once an action has executed,
  -- existing destination lifecycle RPCs must still be able to complete,
  -- reopen, or cancel its linked event/chore.
  if old.source_kind = 'coh'
    and old.target_id is null
    and old.executed_at is null
    and coalesce(current_setting('app.coh_action_id', true), '') <> old.id::text then
    raise exception 'Coh proposals can only be changed through the protected Coh workflow.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_coh_action_mutation
  on public.household_actions;

-- Existing Coh proposals predate the confirmation digest. Backfill the same
-- canonical document used by propose_coh_action so an upgrade does not strand
-- a user's active proposal.
update public.household_actions action
set proposal_hash = encode(
  extensions.digest(
    convert_to(
      jsonb_build_object(
        'kind', action.kind,
        'title', action.title,
        'details', action.details,
        'missingFields', action.missing_fields,
        'payload', action.proposed_payload,
        'assignedPersonId', action.assigned_person_id,
        'startsAt', action.starts_at,
        'endsAt', action.ends_at,
        'dueAt', action.due_at,
        'location', action.location,
        'recurrenceRule', action.recurrence_rule,
        'reminderMinutes', action.reminder_minutes,
        'followUpAt', action.follow_up_at
      )::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
where action.source_kind = 'coh'
  and action.proposal_hash is null;

create trigger guard_coh_action_mutation
  before update on public.household_actions
  for each row execute function public.guard_coh_action_mutation();

-- A pending Coh proposal is a private workspace artifact. The family sees the
-- resulting event/chore/note only after approval; the requesting user can
-- still resume and review their own draft.
drop policy if exists "members read household actions"
  on public.household_actions;
drop policy if exists "members read visible household actions"
  on public.household_actions;
create policy "members read visible household actions"
  on public.household_actions
  for select
  to authenticated
  using (
    public.is_household_member(household_id)
    and (
      source_kind not in ('family_inbox', 'coh')
      or approved_at is not null
      or status in ('approved', 'scheduled', 'in_progress', 'completed')
      or (source_kind = 'family_inbox' and public.is_household_admin(household_id))
      or (
        source_kind = 'coh'
        and exists (
          select 1
          from public.assistant_conversations conversation
          where conversation.id = household_actions.source_id
            and conversation.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "members create household actions"
  on public.household_actions;
create policy "members create household actions"
  on public.household_actions
  for insert
  to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = auth.uid()
    and source_kind <> 'coh'
    and (
      source_kind <> 'family_inbox'
      or public.is_household_admin(household_id)
    )
  );

drop policy if exists "members read action history"
  on public.household_action_events;
drop policy if exists "members read visible action history"
  on public.household_action_events;
create policy "members read visible action history"
  on public.household_action_events
  for select
  to authenticated
  using (
    public.is_household_member(household_id)
    and exists (
      select 1
      from public.household_actions action
      where action.id = household_action_events.action_id
        and action.household_id = household_action_events.household_id
        and (
          action.source_kind not in ('family_inbox', 'coh')
          or action.approved_at is not null
          or action.status in ('approved', 'scheduled', 'in_progress', 'completed')
          or (
            action.source_kind = 'family_inbox'
            and public.is_household_admin(action.household_id)
          )
          or (
            action.source_kind = 'coh'
            and exists (
              select 1
              from public.assistant_conversations conversation
              where conversation.id = action.source_id
                and conversation.user_id = auth.uid()
            )
          )
        )
    )
  );

create table if not exists public.assistant_requests (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  conversation_id uuid not null
    references public.assistant_conversations(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null check (operation in ('message', 'confirm', 'cancel')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  response_payload jsonb,
  error_code text,
  retryable boolean not null default false,
  proposal_action_id uuid,
  proposal_action_version integer,
  proposal_hash text,
  proposal_snapshot jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default (now() + interval '180 seconds'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.assistant_requests
  alter column lease_expires_at set default (now() + interval '180 seconds');

alter table public.assistant_requests
  add column if not exists proposal_action_id uuid,
  add column if not exists proposal_action_version integer,
  add column if not exists proposal_hash text,
  add column if not exists proposal_snapshot jsonb;

create index if not exists assistant_requests_conversation_created_idx
  on public.assistant_requests (conversation_id, created_at);

create index if not exists assistant_requests_recovery_idx
  on public.assistant_requests (user_id, household_id, updated_at desc)
  include (status, operation, conversation_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assistant_requests_proposal_result_check'
      and conrelid = 'public.assistant_requests'::regclass
  ) then
    alter table public.assistant_requests
      add constraint assistant_requests_proposal_result_check check (
        (
          proposal_action_id is null
          and proposal_action_version is null
          and proposal_hash is null
          and proposal_snapshot is null
        )
        or (
          proposal_action_id is not null
          and proposal_action_version is not null
          and proposal_action_version > 0
          and proposal_hash is not null
          and proposal_hash ~ '^[0-9a-f]{64}$'
          and proposal_snapshot is not null
        )
      );
  end if;
end;
$$;

alter table public.assistant_requests enable row level security;

drop policy if exists "users read own assistant requests"
  on public.assistant_requests;
create policy "users read own assistant requests"
on public.assistant_requests for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_household_member(household_id)
);

revoke all on table public.assistant_requests from anon, authenticated;
grant select on table public.assistant_requests to authenticated;

create or replace function public.claim_assistant_request(
  target_request uuid,
  target_conversation uuid,
  target_household uuid,
  target_operation text,
  target_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.assistant_conversations%rowtype;
  request_row public.assistant_requests%rowtype;
  inserted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if target_operation not in ('message', 'confirm', 'cancel') then
    raise exception 'Unsupported Coh operation.';
  end if;
  if target_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request payload hash.';
  end if;

  select * into conversation
  from public.assistant_conversations
  where id = target_conversation
    and household_id = target_household
    and user_id = auth.uid();
  if conversation.id is null then
    raise exception 'Conversation not found.';
  end if;
  if not public.is_household_member(target_household) then
    raise exception 'Household access denied.';
  end if;

  insert into public.assistant_requests (
    request_id,
    conversation_id,
    household_id,
    user_id,
    operation,
    payload_hash
  ) values (
    target_request,
    target_conversation,
    target_household,
    auth.uid(),
    target_operation,
    target_payload_hash
  )
  on conflict (user_id, request_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    select * into request_row
    from public.assistant_requests
    where user_id = auth.uid() and request_id = target_request;
    return jsonb_build_object(
      'state', 'claimed',
      'attemptCount', 1,
      'leaseToken', request_row.lease_token
    );
  end if;

  select * into request_row
  from public.assistant_requests
  where user_id = auth.uid() and request_id = target_request
  for update;
  if request_row.conversation_id <> target_conversation
    or request_row.household_id <> target_household
    or request_row.operation <> target_operation
    or request_row.payload_hash <> target_payload_hash then
    raise exception 'A request ID cannot be reused with different Coh input.';
  end if;
  if request_row.status = 'completed' then
    return jsonb_build_object(
      'state', 'completed',
      'response', request_row.response_payload,
      'attemptCount', request_row.attempt_count
    );
  end if;
  if request_row.status = 'failed' and not request_row.retryable then
    return jsonb_build_object(
      'state', 'failed',
      'response', request_row.response_payload,
      'errorCode', request_row.error_code,
      'attemptCount', request_row.attempt_count
    );
  end if;
  if request_row.status = 'processing' and request_row.lease_expires_at > now() then
    return jsonb_build_object(
      'state', 'in_progress',
      'retryAfterMs',
        greatest(250, floor(extract(epoch from (request_row.lease_expires_at - now())) * 1000)),
      'attemptCount', request_row.attempt_count
    );
  end if;

  update public.assistant_requests set
    status = 'processing',
    response_payload = null,
    error_code = null,
    retryable = false,
    attempt_count = attempt_count + 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '180 seconds',
    updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object(
    'state', 'claimed',
    'attemptCount', request_row.attempt_count,
    'leaseToken', request_row.lease_token
  );
end;
$$;

create or replace function public.complete_assistant_request(
  target_request uuid,
  expected_lease_token uuid,
  response_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assistant_requests set
    status = 'completed',
    response_payload = $3,
    error_code = null,
    retryable = false,
    updated_at = now()
  where user_id = auth.uid()
    and request_id = target_request
    and lease_token = expected_lease_token
    and status = 'processing';
  if not found then
    raise exception 'Coh request not found.';
  end if;
end;
$$;

create or replace function public.fail_assistant_request(
  target_request uuid,
  expected_lease_token uuid,
  response_payload jsonb,
  failure_code text,
  may_retry boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assistant_requests set
    status = 'failed',
    response_payload = $3,
    error_code = left(failure_code, 100),
    retryable = may_retry,
    lease_expires_at = now(),
    updated_at = now()
  where user_id = auth.uid()
    and request_id = target_request
    and lease_token = expected_lease_token
    and status = 'processing';
  if not found then
    raise exception 'Coh request not found.';
  end if;
end;
$$;

create or replace function public.propose_coh_action(
  target_conversation uuid,
  target_request uuid,
  request_lease_token uuid,
  expected_action_version integer,
  proposed_kind text,
  proposed_title text,
  proposed_details text,
  proposed_missing_fields text[],
  input_proposed_payload jsonb,
  proposed_assigned_person_id uuid,
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  proposed_due_at timestamptz,
  proposed_location text,
  proposed_recurrence_rule text,
  proposed_reminder_minutes integer,
  proposed_follow_up_at timestamptz
)
returns public.household_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.assistant_conversations%rowtype;
  current_action public.household_actions%rowtype;
  updated_action public.household_actions%rowtype;
  assignee public.household_people%rowtype;
  request_row public.assistant_requests%rowtype;
  next_status text;
  proposal_document jsonb;
  calculated_hash text;
begin
  select * into conversation
  from public.assistant_conversations
  where id = target_conversation and user_id = auth.uid()
  for update;
  if conversation.id is null then raise exception 'Conversation not found.'; end if;
  if not public.is_household_member(conversation.household_id) then
    raise exception 'Household access denied.';
  end if;
  select * into request_row
  from public.assistant_requests
  where user_id = auth.uid()
    and request_id = target_request
    and conversation_id = conversation.id
    and operation = 'message'
  for update;
  if request_row.id is null
    or request_row.status <> 'processing'
    or request_row.lease_token is distinct from request_lease_token
    or request_row.lease_expires_at <= now() then
    raise exception 'The Coh request lease expired. Retry safely.';
  end if;

  -- A request can mutate a proposal at most once. The request-scoped marker is
  -- immutable across lease reclaims and cannot be overwritten by a newer
  -- correction the way the action's last-writer marker can. Return the exact
  -- still-current proposal, or reject a superseded replay without writing.
  if request_row.proposal_action_id is not null then
    select * into updated_action
    from public.household_actions
    where id = request_row.proposal_action_id
      and household_id = conversation.household_id
      and source_kind = 'coh'
      and source_id = conversation.id;
    if updated_action.id is not null
      and updated_action.version = request_row.proposal_action_version
      and updated_action.proposal_hash is not distinct from request_row.proposal_hash then
      return updated_action;
    end if;
    raise exception 'This Coh request was superseded. Resume before retrying.';
  end if;

  if proposed_kind not in ('event', 'chore', 'note', 'grocery', 'meal') then
    raise exception 'Unsupported Coh action kind.';
  end if;
  if nullif(trim(proposed_title), '') is null then
    raise exception 'Coh action title is required.';
  end if;
  if proposed_reminder_minutes is not null
    and proposed_reminder_minutes not between 0 and 525600 then
    raise exception 'Reminder minutes are out of range.';
  end if;
  if proposed_ends_at is not null
    and proposed_starts_at is not null
    and proposed_ends_at < proposed_starts_at then
    raise exception 'The action end cannot be before its start.';
  end if;

  if proposed_assigned_person_id is not null then
    select * into assignee
    from public.household_people
    where id = proposed_assigned_person_id
      and household_id = conversation.household_id;
    if assignee.id is null then
      raise exception 'Assigned family member not found.';
    end if;
  end if;

  next_status := case
    when cardinality(coalesce(proposed_missing_fields, '{}'::text[])) > 0
      then 'needs_details'
    else 'pending_approval'
  end;
  proposal_document := jsonb_build_object(
    'kind', proposed_kind,
    'title', trim(proposed_title),
    'details', proposed_details,
    'missingFields', coalesce(proposed_missing_fields, '{}'::text[]),
    'payload', coalesce(input_proposed_payload, '{}'::jsonb),
    'assignedPersonId', proposed_assigned_person_id,
    'startsAt', proposed_starts_at,
    'endsAt', proposed_ends_at,
    'dueAt', proposed_due_at,
    'location', proposed_location,
    'recurrenceRule', proposed_recurrence_rule,
    'reminderMinutes', proposed_reminder_minutes,
    'followUpAt', proposed_follow_up_at
  );
  calculated_hash := encode(
    extensions.digest(convert_to(proposal_document::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if conversation.active_action_id is not null then
    select * into current_action
    from public.household_actions
    where id = conversation.active_action_id
    for update;
  end if;

  if current_action.id is not null then
    if current_action.source_kind <> 'coh'
      or current_action.source_id is distinct from conversation.id
      or current_action.household_id <> conversation.household_id then
      raise exception 'Conversation action does not belong to Coh.';
    end if;
    -- The proposal mutation and conversation pointer commit in one database
    -- transaction. If the Edge response is lost, replaying the same request
    -- returns that exact durable proposal without incrementing its version.
    if current_action.proposal_request_id = target_request then
      update public.assistant_requests set
        proposal_action_id = current_action.id,
        proposal_action_version = current_action.version,
        proposal_hash = current_action.proposal_hash,
        proposal_snapshot = to_jsonb(current_action),
        updated_at = now()
      where id = request_row.id
        and lease_token = request_lease_token
        and status = 'processing';
      if not found then
        raise exception 'The Coh request lease expired. Retry safely.';
      end if;
      return current_action;
    end if;
    if current_action.status not in ('draft', 'needs_details', 'pending_approval', 'failed') then
      raise exception 'Executed actions must be changed from their destination.';
    end if;
    if current_action.target_id is not null
      or current_action.executed_at is not null then
      raise exception 'Executed actions must be changed from their destination.';
    end if;
    if expected_action_version is null
      or expected_action_version <> current_action.version then
      raise exception 'This Coh draft changed on another device. Resume and try again.';
    end if;

    perform set_config('app.coh_action_id', current_action.id::text, true);
    update public.household_actions set
      kind = proposed_kind,
      title = trim(proposed_title),
      details = proposed_details,
      status = next_status,
      missing_fields = coalesce(proposed_missing_fields, '{}'::text[]),
      proposed_payload = coalesce(input_proposed_payload, '{}'::jsonb),
      assigned_person_id = assignee.id,
      assigned_user_id = assignee.linked_user_id,
      starts_at = proposed_starts_at,
      ends_at = proposed_ends_at,
      due_at = proposed_due_at,
      location = proposed_location,
      recurrence_rule = proposed_recurrence_rule,
      reminder_minutes = proposed_reminder_minutes,
      follow_up_at = proposed_follow_up_at,
      proposal_hash = calculated_hash,
      proposal_request_id = target_request,
      confirmation_request_id = null,
      cancellation_request_id = null,
      approved_by = null,
      approved_at = null,
      version = version + 1,
      updated_at = now()
    where id = current_action.id
    returning * into updated_action;

    insert into public.household_action_events (
      action_id, household_id, actor_user_id, event_type,
      from_status, to_status, metadata
    ) values (
      updated_action.id, updated_action.household_id, auth.uid(), 'corrected',
      current_action.status, updated_action.status,
      jsonb_build_object(
        'source', 'coh',
        'conversationId', conversation.id,
        'requestId', target_request,
        'proposalHash', calculated_hash
      )
    );
  else
    if expected_action_version is not null then
      raise exception 'This Coh draft no longer exists. Resume and try again.';
    end if;
    insert into public.household_actions (
      household_id,
      source_kind,
      source_id,
      kind,
      title,
      details,
      status,
      missing_fields,
      proposed_payload,
      assigned_person_id,
      assigned_user_id,
      starts_at,
      ends_at,
      due_at,
      location,
      recurrence_rule,
      reminder_minutes,
      follow_up_at,
      idempotency_key,
      proposal_hash,
      proposal_request_id,
      created_by
    ) values (
      conversation.household_id,
      'coh',
      conversation.id,
      proposed_kind,
      trim(proposed_title),
      proposed_details,
      next_status,
      coalesce(proposed_missing_fields, '{}'::text[]),
      coalesce(input_proposed_payload, '{}'::jsonb),
      assignee.id,
      assignee.linked_user_id,
      proposed_starts_at,
      proposed_ends_at,
      proposed_due_at,
      proposed_location,
      proposed_recurrence_rule,
      proposed_reminder_minutes,
      proposed_follow_up_at,
      'coh:' || conversation.id::text,
      calculated_hash,
      target_request,
      auth.uid()
    )
    returning * into updated_action;

    insert into public.household_action_events (
      action_id, household_id, actor_user_id, event_type, to_status, metadata
    ) values (
      updated_action.id, updated_action.household_id, auth.uid(), 'created',
      updated_action.status,
      jsonb_build_object(
        'source', 'coh',
        'conversationId', conversation.id,
        'requestId', target_request,
        'proposalHash', calculated_hash
      )
    );
  end if;

  update public.assistant_requests set
    proposal_action_id = updated_action.id,
    proposal_action_version = updated_action.version,
    proposal_hash = updated_action.proposal_hash,
    proposal_snapshot = to_jsonb(updated_action),
    updated_at = now()
  where id = request_row.id
    and lease_token = request_lease_token
    and status = 'processing'
    and proposal_action_id is null;
  if not found then
    raise exception 'The Coh request was already applied. Resume before retrying.';
  end if;

  update public.assistant_conversations set
    active_action_id = updated_action.id,
    closed_at = null,
    updated_at = now()
  where id = conversation.id;

  return updated_action;
end;
$$;

create or replace function public.confirm_coh_action(
  target_conversation uuid,
  target_request uuid,
  request_lease_token uuid,
  target_action uuid,
  expected_version integer,
  expected_proposal_hash text
)
returns public.household_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.assistant_conversations%rowtype;
  action public.household_actions%rowtype;
  request_row public.assistant_requests%rowtype;
begin
  select * into conversation
  from public.assistant_conversations
  where id = target_conversation and user_id = auth.uid()
  for update;
  if conversation.id is null then raise exception 'Conversation not found.'; end if;
  if not public.is_household_member(conversation.household_id) then
    raise exception 'Household access denied.';
  end if;
  select * into request_row
  from public.assistant_requests
  where user_id = auth.uid()
    and request_id = target_request
    and conversation_id = conversation.id
    and operation = 'confirm'
  for update;
  if request_row.id is null
    or request_row.status <> 'processing'
    or request_row.lease_token is distinct from request_lease_token
    or request_row.lease_expires_at <= now() then
    raise exception 'The Coh request lease expired. Retry safely.';
  end if;

  select * into action
  from public.household_actions
  where id = target_action
    and household_id = conversation.household_id
    and source_kind = 'coh'
    and source_id = conversation.id
  for update;
  if action.id is null then raise exception 'Coh action not found.'; end if;
  if expected_version is null
    or expected_proposal_hash is null
    or action.proposal_hash is null
    or action.proposal_hash is distinct from expected_proposal_hash then
    raise exception 'This Coh proposal changed. Resume before confirming.';
  end if;

  -- A retry after a lost response is safe only for the exact request that
  -- executed this exact proposal. The first execution, marker, destination,
  -- and conversation close all commit in this function's transaction.
  if action.target_id is not null
    and action.confirmation_request_id = target_request then
    return action;
  end if;
  if conversation.active_action_id is distinct from target_action then
    raise exception 'This is not the active Coh proposal. Resume before confirming.';
  end if;
  if expected_version is distinct from action.version then
    raise exception 'This Coh proposal changed on another device. Resume before confirming.';
  end if;
  if action.status <> 'pending_approval'
    or cardinality(action.missing_fields) > 0 then
    raise exception 'This Coh proposal is not ready for confirmation.';
  end if;

  perform set_config('app.coh_action_id', action.id::text, true);
  update public.household_actions set
    confirmation_request_id = target_request
  where id = action.id
  returning * into action;
  action := public.approve_and_execute_household_action(action.id, action.version);
  update public.assistant_conversations set
    active_action_id = null,
    state = '{}'::jsonb,
    closed_at = now(),
    updated_at = now()
  where id = conversation.id;
  return action;
end;
$$;

create or replace function public.cancel_coh_action(
  target_conversation uuid,
  target_request uuid,
  request_lease_token uuid,
  target_action uuid,
  expected_version integer,
  expected_proposal_hash text
)
returns public.household_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.assistant_conversations%rowtype;
  action public.household_actions%rowtype;
  request_row public.assistant_requests%rowtype;
begin
  select * into conversation
  from public.assistant_conversations
  where id = target_conversation and user_id = auth.uid()
  for update;
  if conversation.id is null then raise exception 'Conversation not found.'; end if;
  if not public.is_household_member(conversation.household_id) then
    raise exception 'Household access denied.';
  end if;
  select * into request_row
  from public.assistant_requests
  where user_id = auth.uid()
    and request_id = target_request
    and conversation_id = conversation.id
    and operation = 'cancel'
  for update;
  if request_row.id is null
    or request_row.status <> 'processing'
    or request_row.lease_token is distinct from request_lease_token
    or request_row.lease_expires_at <= now() then
    raise exception 'The Coh request lease expired. Retry safely.';
  end if;

  select * into action
  from public.household_actions
  where id = target_action
    and household_id = conversation.household_id
    and source_kind = 'coh'
    and source_id = conversation.id
  for update;
  if action.id is null then raise exception 'Coh action not found.'; end if;
  if expected_version is null
    or expected_proposal_hash is null
    or action.proposal_hash is null
    or action.proposal_hash is distinct from expected_proposal_hash then
    raise exception 'This Coh proposal changed. Resume before canceling.';
  end if;
  if action.status = 'canceled'
    and action.cancellation_request_id = target_request then
    return action;
  end if;
  if conversation.active_action_id is distinct from target_action then
    raise exception 'This is not the active Coh proposal. Resume before canceling.';
  end if;
  if expected_version is distinct from action.version then
    raise exception 'This Coh proposal changed. Resume before canceling.';
  end if;
  if action.status not in ('draft', 'needs_details', 'pending_approval', 'failed') then
    raise exception 'Executed actions must be changed from their destination.';
  end if;

  perform set_config('app.coh_action_id', action.id::text, true);
  update public.household_actions set
    cancellation_request_id = target_request
  where id = action.id
  returning * into action;
  action := public.transition_household_action(
    action.id,
    'canceled',
    action.version,
    'Canceled from the private Coh workspace'
  );
  update public.assistant_conversations set
    active_action_id = null,
    state = '{}'::jsonb,
    closed_at = now(),
    updated_at = now()
  where id = conversation.id;
  return action;
end;
$$;

revoke all on function public.claim_assistant_request(uuid, uuid, uuid, text, text)
  from public;
revoke all on function public.complete_assistant_request(uuid, uuid, jsonb)
  from public;
revoke all on function public.fail_assistant_request(uuid, uuid, jsonb, text, boolean)
  from public;
revoke all on function public.propose_coh_action(
  uuid, uuid, uuid, integer, text, text, text, text[], jsonb, uuid,
  timestamptz, timestamptz, timestamptz, text, text, integer, timestamptz
) from public;
revoke all on function public.confirm_coh_action(uuid, uuid, uuid, uuid, integer, text)
  from public;
revoke all on function public.cancel_coh_action(uuid, uuid, uuid, uuid, integer, text)
  from public;

grant execute on function public.claim_assistant_request(uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function public.complete_assistant_request(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.fail_assistant_request(uuid, uuid, jsonb, text, boolean)
  to authenticated;
grant execute on function public.propose_coh_action(
  uuid, uuid, uuid, integer, text, text, text, text[], jsonb, uuid,
  timestamptz, timestamptz, timestamptz, text, text, integer, timestamptz
) to authenticated;
grant execute on function public.confirm_coh_action(uuid, uuid, uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.cancel_coh_action(uuid, uuid, uuid, uuid, integer, text)
  to authenticated;

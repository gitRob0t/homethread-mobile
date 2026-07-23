-- Coho closed-loop household operations.
-- Every captured item becomes a durable, auditable household action that can be
-- clarified, approved, assigned, executed, notified, completed, and resurfaced.

create table public.household_actions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_kind text not null default 'manual'
    check (source_kind in ('coh', 'family_inbox', 'share', 'manual', 'calendar', 'automation')),
  source_id uuid,
  kind text not null
    check (kind in ('event', 'task', 'chore', 'note', 'follow_up', 'grocery', 'meal')),
  title text not null check (char_length(title) between 1 and 240),
  details text,
  status text not null default 'draft'
    check (status in (
      'draft',
      'needs_details',
      'pending_approval',
      'approved',
      'scheduled',
      'in_progress',
      'completed',
      'canceled',
      'failed'
    )),
  missing_fields text[] not null default '{}',
  proposed_payload jsonb not null default '{}'::jsonb,
  assigned_person_id uuid references public.household_people(id) on delete set null,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  location text,
  recurrence_rule text,
  reminder_minutes integer check (
    reminder_minutes is null or reminder_minutes between 0 and 525600
  ),
  follow_up_at timestamptz,
  target_table text check (
    target_table is null or target_table in (
      'events',
      'chores',
      'notes',
      'event_follow_ups',
      'grocery_items',
      'meal_plans'
    )
  ),
  target_id uuid,
  idempotency_key text not null,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, idempotency_key),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table public.household_action_events (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.household_actions(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (
    event_type in (
      'created',
      'clarified',
      'corrected',
      'approved',
      'assigned',
      'executed',
      'accepted',
      'completed',
      'reopened',
      'canceled',
      'failed',
      'notification_queued'
    )
  ),
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.inbound_attachments (
  id uuid primary key default gen_random_uuid(),
  inbound_item_id uuid not null references public.inbound_items(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  provider_attachment_id text,
  filename text not null check (char_length(filename) between 1 and 300),
  content_type text not null,
  byte_size bigint not null default 0 check (byte_size >= 0),
  sha256 text,
  storage_path text,
  status text not null default 'metadata'
    check (status in ('metadata', 'quarantined', 'stored', 'processed', 'rejected', 'failed')),
  extracted_text text,
  processing_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique nulls not distinct (inbound_item_id, provider_attachment_id)
);

create table public.inbox_extractions (
  id uuid primary key default gen_random_uuid(),
  inbound_item_id uuid not null references public.inbound_items(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  extraction_version integer not null default 1,
  model text not null,
  prompt_version text not null,
  status text not null default 'processing'
    check (status in ('processing', 'needs_details', 'ready', 'failed', 'superseded')),
  summary text,
  category text,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  missing_questions text[] not null default '{}',
  proposals jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (inbound_item_id, extraction_version)
);

alter table public.inbound_items
  drop constraint if exists inbound_items_status_check;
alter table public.inbound_items
  add constraint inbound_items_status_check check (
    status in (
      'queued',
      'processing',
      'needs_review',
      'needs_details',
      'ready',
      'approved',
      'executing',
      'imported',
      'rejected',
      'failed'
    )
  ),
  add column if not exists extraction_status text not null default 'queued'
    check (extraction_status in ('queued', 'processing', 'needs_details', 'ready', 'failed')),
  add column if not exists extraction_version integer not null default 0,
  add column if not exists content_fingerprint text,
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  action_id uuid references public.household_actions(id) on delete cascade,
  inbound_item_id uuid references public.inbound_items(id) on delete cascade,
  category text not null check (
    category in (
      'assignment',
      'reminder',
      'completion',
      'family_message',
      'family_inbox',
      'daily',
      'week_ahead',
      'follow_up',
      'automation',
      'system'
    )
  ),
  channel text not null default 'push' check (channel in ('push', 'email')),
  title text not null,
  body text not null,
  deep_link text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'opened', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  dedupe_key text not null unique,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz
);

create table public.notification_receipts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notification_outbox(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  receipt_type text not null check (receipt_type in ('delivered', 'opened', 'dismissed')),
  device_token_id uuid references public.device_push_tokens(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (notification_id, user_id, receipt_type)
);

create table public.briefing_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  briefing_type text not null check (briefing_type in ('daily', 'week_ahead', 'follow_up')),
  local_date date not null,
  timezone text not null,
  title text not null,
  summary text not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (household_id, user_id, briefing_type, local_date)
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  enabled boolean not null default true,
  trigger_type text not null check (
    trigger_type in (
      'schedule',
      'event_completed',
      'action_overdue',
      'location',
      'calendar_change',
      'inbox_received'
    )
  ),
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  action_template jsonb not null default '{}'::jsonb,
  timezone text not null default 'UTC',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  trigger_type text not null,
  trigger_context jsonb not null default '{}'::jsonb,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'skipped', 'failed')),
  action_id uuid references public.household_actions(id) on delete set null,
  dedupe_key text not null unique,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- OAuth tokens are intentionally isolated from all authenticated table access.
-- Only service-role Edge Functions may read or write this table.
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  provider_account_id text not null,
  provider_email text,
  display_name text,
  scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'reauthorize', 'paused', 'disconnected', 'error')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  selected_calendars jsonb not null default '[]'::jsonb,
  default_write_calendar_id text,
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_account_id)
);

create table public.calendar_oauth_states (
  state_hash text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  code_verifier_ciphertext text not null,
  redirect_uri text not null,
  return_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);

create table public.calendar_sync_cursors (
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  provider_calendar_id text not null,
  cursor text,
  window_start timestamptz,
  window_end timestamptz,
  webhook_channel_id text,
  webhook_resource_id text,
  webhook_secret_ciphertext text,
  webhook_expires_at timestamptz,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (connection_id, provider_calendar_id)
);

create table public.calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  provider_calendar_id text not null,
  provider_event_id text not null,
  provider_etag text,
  provider_updated_at timestamptz,
  local_version integer not null default 1,
  sync_direction text not null default 'inbound'
    check (sync_direction in ('inbound', 'outbound', 'two_way')),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connection_id, provider_calendar_id, provider_event_id),
  unique (connection_id, event_id)
);

create table public.calendar_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  provider_event_id text,
  local_payload jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'kept_local', 'kept_provider', 'merged', 'ignored')),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.member_onboarding_state (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  profile_completed boolean not null default false,
  notifications_completed boolean not null default false,
  calendar_completed boolean not null default false,
  tour_completed boolean not null default false,
  first_action_completed boolean not null default false,
  last_active_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.app_events (
  id bigint generated always as identity primary key,
  household_id uuid references public.households(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null check (char_length(event_name) between 1 and 100),
  severity text not null default 'info' check (severity in ('debug', 'info', 'warning', 'error')),
  correlation_id text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.assistant_conversations
  add column if not exists active_action_id uuid references public.household_actions(id) on delete set null,
  add column if not exists prompt_version text not null default 'coh-v2';

alter table public.events
  add column if not exists assigned_person_id uuid references public.household_people(id) on delete set null,
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists recurrence_rule text,
  add column if not exists recurrence jsonb,
  add column if not exists status text not null default 'confirmed'
    check (status in ('tentative', 'confirmed', 'canceled')),
  add column if not exists source_action_id uuid references public.household_actions(id) on delete set null,
  add column if not exists source_calendar_id text,
  add column if not exists provider_etag text,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists revision integer not null default 1;

alter table public.chores
  add column if not exists assigned_person_id uuid references public.household_people(id) on delete set null,
  add column if not exists source_action_id uuid references public.household_actions(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists completion_note text,
  add column if not exists requires_verification boolean not null default false,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz;

alter table public.event_follow_ups
  add column if not exists assigned_person_id uuid references public.household_people(id) on delete set null,
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists source_action_id uuid references public.household_actions(id) on delete set null;

alter table public.grocery_items
  add column if not exists source_action_id uuid references public.household_actions(id) on delete set null;

alter table public.meal_plans
  add column if not exists source_action_id uuid references public.household_actions(id) on delete set null;

alter table public.invitations
  add column if not exists invited_name text,
  add column if not exists delivery_status text not null default 'created'
    check (delivery_status in ('created', 'sent', 'failed')),
  add column if not exists last_delivery_error text,
  add column if not exists accepted_at timestamptz;

alter table public.device_push_tokens
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists app_version text,
  add column if not exists last_opened_at timestamptz;

alter table public.household_actions enable row level security;
alter table public.household_action_events enable row level security;
alter table public.inbound_attachments enable row level security;
alter table public.inbox_extractions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_receipts enable row level security;
alter table public.briefing_snapshots enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_oauth_states enable row level security;
alter table public.calendar_sync_cursors enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.calendar_sync_conflicts enable row level security;
alter table public.member_onboarding_state enable row level security;
alter table public.app_events enable row level security;

create policy "members read household actions"
on public.household_actions for select using (public.is_household_member(household_id));
create policy "members create household actions"
on public.household_actions for insert with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
);
create policy "members read action history"
on public.household_action_events for select using (public.is_household_member(household_id));
create policy "members read inbound attachments"
on public.inbound_attachments for select using (public.is_household_member(household_id));
create policy "members read inbox extractions"
on public.inbox_extractions for select using (public.is_household_member(household_id));
create policy "users read own notification outbox"
on public.notification_outbox for select using (recipient_user_id = auth.uid());
create policy "users create notification receipts"
on public.notification_receipts for insert with check (user_id = auth.uid());
create policy "users read own notification receipts"
on public.notification_receipts for select using (user_id = auth.uid());
create policy "users read own briefing snapshots"
on public.briefing_snapshots for select using (
  user_id = auth.uid() and public.is_household_member(household_id)
);
create policy "members read automation rules"
on public.automation_rules for select using (public.is_household_member(household_id));
create policy "admins create automation rules"
on public.automation_rules for insert with check (
  public.is_household_admin(household_id) and created_by = auth.uid()
);
create policy "admins update automation rules"
on public.automation_rules for update using (public.is_household_admin(household_id))
with check (public.is_household_admin(household_id));
create policy "admins delete automation rules"
on public.automation_rules for delete using (public.is_household_admin(household_id));
create policy "members read automation runs"
on public.automation_runs for select using (public.is_household_member(household_id));
create policy "members read calendar event links"
on public.calendar_event_links for select using (public.is_household_member(household_id));
create policy "members read calendar conflicts"
on public.calendar_sync_conflicts for select using (public.is_household_member(household_id));
create policy "users resolve calendar conflicts"
on public.calendar_sync_conflicts for update using (
  public.is_household_member(household_id)
) with check (
  public.is_household_member(household_id) and resolved_by = auth.uid()
);
create policy "users manage own onboarding"
on public.member_onboarding_state for all using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy "members read household onboarding"
on public.member_onboarding_state for select using (public.is_household_member(household_id));
create policy "members record app events"
on public.app_events for insert with check (
  user_id = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
);
create policy "users read own app errors"
on public.app_events for select using (user_id = auth.uid());

create or replace function public.action_transition_allowed(current_status text, next_status text)
returns boolean language sql immutable
as $$
  select case current_status
    when 'draft' then next_status in ('needs_details', 'pending_approval', 'canceled', 'failed')
    when 'needs_details' then next_status in ('pending_approval', 'canceled', 'failed')
    when 'pending_approval' then next_status in ('needs_details', 'approved', 'canceled', 'failed')
    when 'approved' then next_status in ('scheduled', 'in_progress', 'completed', 'canceled', 'failed')
    when 'scheduled' then next_status in ('in_progress', 'completed', 'canceled', 'failed')
    when 'in_progress' then next_status in ('completed', 'canceled', 'failed')
    when 'completed' then next_status in ('in_progress')
    when 'failed' then next_status in ('needs_details', 'pending_approval', 'approved', 'canceled')
    else false
  end;
$$;

create or replace function public.queue_action_notification(
  target_action public.household_actions,
  notification_category text,
  recipient uuid,
  notification_title text,
  notification_body text
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  notification_link text;
begin
  if recipient is null then return; end if;
  notification_link := 'coho://action/' || target_action.id::text;
  insert into public.notification_outbox (
    household_id,
    recipient_user_id,
    action_id,
    category,
    title,
    body,
    deep_link,
    payload,
    dedupe_key
  ) values (
    target_action.household_id,
    recipient,
    target_action.id,
    notification_category,
    notification_title,
    notification_body,
    notification_link,
    jsonb_build_object(
      'screen', 'Action',
      'actionId', target_action.id,
      'kind', target_action.kind,
      'deepLink', notification_link
    ),
    target_action.id::text || ':' || notification_category || ':' || recipient::text ||
      ':' || target_action.version::text
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function public.transition_household_action(
  target_action uuid,
  next_status text,
  expected_version integer default null,
  reason text default null
)
returns public.household_actions
language plpgsql security definer set search_path = public
as $$
declare
  current_action public.household_actions%rowtype;
  updated_action public.household_actions%rowtype;
  member_role public.household_role;
  event_name text;
begin
  select * into current_action
  from public.household_actions
  where id = target_action
  for update;
  if current_action.id is null then raise exception 'Action not found.'; end if;

  select role into member_role
  from public.household_members
  where household_id = current_action.household_id and user_id = auth.uid();
  if member_role is null then raise exception 'Household access denied.'; end if;
  if expected_version is not null and expected_version <> current_action.version then
    raise exception 'This item changed on another device. Refresh and try again.';
  end if;
  if not public.action_transition_allowed(current_action.status, next_status) then
    raise exception 'Invalid action transition from % to %.', current_action.status, next_status;
  end if;
  if next_status = 'approved' and member_role = 'child' then
    raise exception 'An adult family member must approve this action.';
  end if;
  if next_status = 'completed'
    and member_role not in ('owner', 'admin')
    and current_action.assigned_user_id is not null
    and current_action.assigned_user_id <> auth.uid() then
    raise exception 'Only the assignee or an adult administrator can complete this action.';
  end if;

  event_name := case next_status
    when 'needs_details' then 'clarified'
    when 'approved' then 'approved'
    when 'scheduled' then 'executed'
    when 'in_progress' then case when current_action.status = 'completed' then 'reopened' else 'accepted' end
    when 'completed' then 'completed'
    when 'canceled' then 'canceled'
    when 'failed' then 'failed'
    else 'corrected'
  end;

  update public.household_actions set
    status = next_status,
    approved_by = case when next_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when next_status = 'approved' then now() else approved_at end,
    completed_by = case
      when next_status = 'completed' then auth.uid()
      when next_status = 'in_progress' then null
      else completed_by
    end,
    completed_at = case
      when next_status = 'completed' then now()
      when next_status = 'in_progress' then null
      else completed_at
    end,
    version = version + 1,
    updated_at = now()
  where id = current_action.id
  returning * into updated_action;

  insert into public.household_action_events (
    action_id,
    household_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) values (
    updated_action.id,
    updated_action.household_id,
    auth.uid(),
    event_name,
    current_action.status,
    next_status,
    case when reason is null then '{}'::jsonb else jsonb_build_object('reason', reason) end
  );

  if next_status in ('approved', 'in_progress', 'completed') then
    insert into public.member_onboarding_state (
      household_id,
      user_id,
      first_action_completed,
      last_active_at,
      updated_at
    ) values (
      updated_action.household_id,
      auth.uid(),
      true,
      now(),
      now()
    )
    on conflict (household_id, user_id) do update set
      first_action_completed = true,
      last_active_at = now(),
      updated_at = now();
  end if;

  if next_status = 'approved' and updated_action.assigned_user_id is not null then
    perform public.queue_action_notification(
      updated_action,
      'assignment',
      updated_action.assigned_user_id,
      'New family assignment',
      updated_action.title
    );
  elsif next_status = 'completed'
    and updated_action.created_by is not null
    and updated_action.created_by <> auth.uid() then
    perform public.queue_action_notification(
      updated_action,
      'completion',
      updated_action.created_by,
      'Completed',
      updated_action.title
    );
  end if;
  return updated_action;
end;
$$;

create or replace function public.execute_household_action(target_action uuid)
returns public.household_actions
language plpgsql security definer set search_path = public
as $$
declare
  action public.household_actions%rowtype;
  created_id uuid;
  creator uuid;
  next_status text;
  reward_type_value text;
  reward_value_value numeric;
  item_payload jsonb;
  first_created_id uuid;
begin
  select * into action from public.household_actions where id = target_action for update;
  if action.id is null then raise exception 'Action not found.'; end if;
  if not public.is_household_member(action.household_id) then
    raise exception 'Household access denied.';
  end if;
  if action.target_id is not null then return action; end if;
  if action.status <> 'approved' then raise exception 'Approve this action before executing it.'; end if;

  creator := coalesce(action.created_by, auth.uid());
  if action.kind = 'event' then
    if action.starts_at is null then raise exception 'The event needs a date and time.'; end if;
    insert into public.events (
      household_id,
      title,
      details,
      starts_at,
      ends_at,
      location,
      created_by,
      provider,
      provider_event_id,
      assigned_person_id,
      assigned_user_id,
      recurrence_rule,
      source_action_id
    ) values (
      action.household_id,
      action.title,
      action.details,
      action.starts_at,
      action.ends_at,
      action.location,
      creator,
      'coho',
      'action:' || action.id::text,
      action.assigned_person_id,
      action.assigned_user_id,
      action.recurrence_rule,
      action.id
    ) returning id into created_id;
    next_status := 'scheduled';
    action.target_table := 'events';
  elsif action.kind in ('task', 'chore') then
    reward_type_value := coalesce(action.proposed_payload ->> 'reward_type', 'points');
    if reward_type_value not in ('points', 'game_time', 'vbucks', 'allowance', 'custom') then
      reward_type_value := 'points';
    end if;
    reward_value_value := greatest(
      0,
      coalesce((action.proposed_payload ->> 'reward_value')::numeric, 10)
    );
    insert into public.chores (
      household_id,
      title,
      details,
      assigned_to,
      assigned_person_id,
      due_at,
      recurrence_rule,
      created_by,
      reward_type,
      reward_value,
      reward_label,
      source_action_id
    ) values (
      action.household_id,
      action.title,
      action.details,
      action.assigned_user_id,
      action.assigned_person_id,
      action.due_at,
      action.recurrence_rule,
      creator,
      reward_type_value,
      reward_value_value,
      action.proposed_payload ->> 'reward_label',
      action.id
    ) returning id into created_id;
    next_status := 'in_progress';
    action.target_table := 'chores';
  elsif action.kind = 'note' then
    insert into public.notes (
      household_id,
      title,
      body,
      pinned,
      created_by,
      updated_by
    ) values (
      action.household_id,
      action.title,
      coalesce(action.details, ''),
      coalesce((action.proposed_payload ->> 'pinned')::boolean, false),
      creator,
      creator
    ) returning id into created_id;
    next_status := 'completed';
    action.target_table := 'notes';
  elsif action.kind = 'follow_up' then
    if nullif(action.proposed_payload ->> 'event_id', '') is null then
      raise exception 'The follow-up needs an event.';
    end if;
    insert into public.event_follow_ups (
      household_id,
      event_id,
      note,
      due_at,
      created_by,
      assigned_person_id,
      assigned_user_id,
      source_action_id
    ) values (
      action.household_id,
      (action.proposed_payload ->> 'event_id')::uuid,
      action.details,
      action.due_at,
      creator,
      action.assigned_person_id,
      action.assigned_user_id,
      action.id
    )
    on conflict (event_id) do update set
      note = excluded.note,
      due_at = excluded.due_at,
      status = 'open',
      completed_by = null,
      completed_at = null,
      assigned_person_id = excluded.assigned_person_id,
      assigned_user_id = excluded.assigned_user_id,
      source_action_id = excluded.source_action_id,
      updated_at = now()
    returning id into created_id;
    next_status := 'in_progress';
    action.target_table := 'event_follow_ups';
  elsif action.kind = 'grocery' then
    if jsonb_array_length(coalesce(action.proposed_payload -> 'grocery_items', '[]'::jsonb)) = 0 then
      raise exception 'The grocery action needs at least one item.';
    end if;
    for item_payload in
      select value from jsonb_array_elements(action.proposed_payload -> 'grocery_items')
    loop
      insert into public.grocery_items (
        household_id,
        name,
        quantity,
        category,
        added_by,
        source_action_id
      ) values (
        action.household_id,
        item_payload ->> 'name',
        nullif(item_payload ->> 'quantity', ''),
        coalesce(nullif(item_payload ->> 'category', ''), 'Other'),
        creator,
        action.id
      ) returning id into created_id;
      first_created_id := coalesce(first_created_id, created_id);
    end loop;
    created_id := first_created_id;
    next_status := 'completed';
    action.target_table := 'grocery_items';
  elsif action.kind = 'meal' then
    if jsonb_array_length(coalesce(action.proposed_payload -> 'meals', '[]'::jsonb)) = 0 then
      raise exception 'The meal action needs at least one planned meal.';
    end if;
    for item_payload in
      select value from jsonb_array_elements(action.proposed_payload -> 'meals')
    loop
      insert into public.meal_plans (
        household_id,
        meal_date,
        meal_type,
        title,
        notes,
        created_by,
        updated_by,
        source_action_id
      ) values (
        action.household_id,
        (item_payload ->> 'date')::date,
        coalesce(nullif(item_payload ->> 'meal_type', ''), 'dinner'),
        item_payload ->> 'title',
        nullif(item_payload ->> 'notes', ''),
        creator,
        creator,
        action.id
      )
      on conflict (household_id, meal_date, meal_type) do update set
        title = excluded.title,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        source_action_id = excluded.source_action_id,
        updated_at = now()
      returning id into created_id;
      first_created_id := coalesce(first_created_id, created_id);
    end loop;
    created_id := first_created_id;
    next_status := 'completed';
    action.target_table := 'meal_plans';
  else
    raise exception 'This action type is executed by its dedicated household service.';
  end if;

  update public.household_actions set
    status = next_status,
    target_table = action.target_table,
    target_id = created_id,
    executed_at = now(),
    completed_at = case when next_status = 'completed' then now() else completed_at end,
    completed_by = case when next_status = 'completed' then auth.uid() else completed_by end,
    version = version + 1,
    updated_at = now()
  where id = action.id
  returning * into action;

  insert into public.household_action_events (
    action_id,
    household_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) values (
    action.id,
    action.household_id,
    auth.uid(),
    'executed',
    'approved',
    action.status,
    jsonb_build_object('targetTable', action.target_table, 'targetId', created_id)
  );

  insert into public.member_onboarding_state (
    household_id,
    user_id,
    first_action_completed,
    last_active_at,
    updated_at
  ) values (
    action.household_id,
    auth.uid(),
    true,
    now(),
    now()
  )
  on conflict (household_id, user_id) do update set
    first_action_completed = true,
    last_active_at = now(),
    updated_at = now();

  if action.reminder_minutes is not null
    and coalesce(action.starts_at, action.due_at) is not null then
    insert into public.notification_outbox (
      household_id,
      recipient_user_id,
      action_id,
      category,
      title,
      body,
      deep_link,
      payload,
      scheduled_for,
      dedupe_key
    ) values (
      action.household_id,
      coalesce(action.assigned_user_id, creator),
      action.id,
      'reminder',
      action.title,
      case
        when action.kind = 'event' then 'This family event is coming up.'
        else 'This family assignment is due soon.'
      end,
      'coho://action/' || action.id::text,
      jsonb_build_object(
        'screen', 'Action',
        'actionId', action.id,
        'kind', action.kind,
        'deepLink', 'coho://action/' || action.id::text
      ),
      greatest(
        now(),
        coalesce(action.starts_at, action.due_at) -
          make_interval(mins => action.reminder_minutes)
      ),
      action.id::text || ':reminder:' ||
        coalesce(action.assigned_user_id, creator)::text || ':' || action.version::text
    )
    on conflict (dedupe_key) do nothing;
  end if;

  if action.follow_up_at is not null then
    insert into public.notification_outbox (
      household_id,
      recipient_user_id,
      action_id,
      category,
      title,
      body,
      deep_link,
      payload,
      scheduled_for,
      dedupe_key
    ) values (
      action.household_id,
      coalesce(action.created_by, creator),
      action.id,
      'follow_up',
      'Follow up: ' || action.title,
      'Coh resurfaced this so it does not fall through the cracks.',
      'coho://action/' || action.id::text,
      jsonb_build_object(
        'screen', 'Action',
        'actionId', action.id,
        'kind', action.kind,
        'deepLink', 'coho://action/' || action.id::text
      ),
      greatest(now(), action.follow_up_at),
      action.id::text || ':follow_up:' ||
        coalesce(action.created_by, creator)::text || ':' || action.version::text
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return action;
end;
$$;

create or replace function public.approve_and_execute_household_action(
  target_action uuid,
  expected_version integer default null
)
returns public.household_actions
language plpgsql security definer set search_path = public
as $$
declare approved public.household_actions%rowtype;
begin
  approved := public.transition_household_action(
    target_action,
    'approved',
    expected_version,
    'Approved by a family member'
  );
  return public.execute_household_action(approved.id);
end;
$$;

create or replace function public.correct_household_action(
  target_action uuid,
  expected_version integer,
  patch jsonb
)
returns public.household_actions
language plpgsql security definer set search_path = public
as $$
declare
  action public.household_actions%rowtype;
  updated_action public.household_actions%rowtype;
begin
  select * into action from public.household_actions where id = target_action for update;
  if action.id is null then raise exception 'Action not found.'; end if;
  if not public.is_household_member(action.household_id) then
    raise exception 'Household access denied.';
  end if;
  if expected_version <> action.version then
    raise exception 'This item changed on another device. Refresh and try again.';
  end if;
  if action.status not in ('draft', 'needs_details', 'pending_approval', 'failed') then
    raise exception 'Executed actions must be corrected from their event or task.';
  end if;

  update public.household_actions set
    title = coalesce(nullif(trim(patch ->> 'title'), ''), title),
    details = case when patch ? 'details' then nullif(trim(patch ->> 'details'), '') else details end,
    starts_at = case when patch ? 'starts_at' then nullif(patch ->> 'starts_at', '')::timestamptz else starts_at end,
    ends_at = case when patch ? 'ends_at' then nullif(patch ->> 'ends_at', '')::timestamptz else ends_at end,
    due_at = case when patch ? 'due_at' then nullif(patch ->> 'due_at', '')::timestamptz else due_at end,
    location = case when patch ? 'location' then nullif(trim(patch ->> 'location'), '') else location end,
    reminder_minutes = case when patch ? 'reminder_minutes' then (patch ->> 'reminder_minutes')::integer else reminder_minutes end,
    recurrence_rule = case when patch ? 'recurrence_rule' then nullif(trim(patch ->> 'recurrence_rule'), '') else recurrence_rule end,
    assigned_person_id = case
      when patch ? 'assigned_person_id' then (
        select person.id
        from public.household_people person
        where person.id = nullif(patch ->> 'assigned_person_id', '')::uuid
          and person.household_id = action.household_id
      )
      else assigned_person_id
    end,
    assigned_user_id = case
      when patch ? 'assigned_person_id' then (
        select person.linked_user_id
        from public.household_people person
        where person.id = nullif(patch ->> 'assigned_person_id', '')::uuid
          and person.household_id = action.household_id
      )
      else assigned_user_id
    end,
    missing_fields = case
      when patch ? 'missing_fields'
        then array(select jsonb_array_elements_text(patch -> 'missing_fields'))
      else missing_fields
    end,
    proposed_payload = proposed_payload || coalesce(patch -> 'proposed_payload', '{}'::jsonb),
    status = case
      when coalesce(jsonb_array_length(patch -> 'missing_fields'), cardinality(missing_fields)) = 0
        then 'pending_approval'
      else 'needs_details'
    end,
    version = version + 1,
    updated_at = now()
  where id = action.id
  returning * into updated_action;

  insert into public.household_action_events (
    action_id,
    household_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) values (
    updated_action.id,
    updated_action.household_id,
    auth.uid(),
    'corrected',
    action.status,
    updated_action.status,
    jsonb_build_object('fields', coalesce(
      (select jsonb_agg(key) from jsonb_object_keys(patch) as keys(key)),
      '[]'::jsonb
    ))
  );
  return updated_action;
end;
$$;

create or replace function public.list_calendar_connections(target_household uuid)
returns table (
  id uuid,
  provider text,
  provider_email text,
  display_name text,
  status text,
  selected_calendars jsonb,
  default_write_calendar_id text,
  sync_enabled boolean,
  last_synced_at timestamptz,
  last_error text
)
language sql security definer stable set search_path = public
as $$
  select
    connection.id,
    connection.provider,
    connection.provider_email,
    connection.display_name,
    connection.status,
    connection.selected_calendars,
    connection.default_write_calendar_id,
    connection.sync_enabled,
    connection.last_synced_at,
    connection.last_error
  from public.calendar_connections connection
  where connection.household_id = target_household
    and connection.user_id = auth.uid()
    and public.is_household_member(target_household)
  order by connection.created_at;
$$;

create or replace function public.record_notification_opened(
  target_notification uuid,
  receipt_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.notification_outbox
    where id = target_notification and recipient_user_id = auth.uid()
  ) then raise exception 'Notification access denied.'; end if;
  insert into public.notification_receipts (
    notification_id,
    user_id,
    receipt_type,
    metadata
  ) values (
    target_notification,
    auth.uid(),
    'opened',
    coalesce(receipt_metadata, '{}'::jsonb)
  ) on conflict (notification_id, user_id, receipt_type) do nothing;
  update public.notification_outbox
  set status = 'opened', opened_at = coalesce(opened_at, now())
  where id = target_notification;
end;
$$;

create or replace function public.record_member_active(target_household uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_household_member(target_household) then
    raise exception 'Household access denied.';
  end if;
  insert into public.member_onboarding_state (household_id, user_id, last_active_at, updated_at)
  values (target_household, auth.uid(), now(), now())
  on conflict (household_id, user_id) do update set
    last_active_at = now(),
    updated_at = now();
  update public.device_push_tokens
  set last_opened_at = now(), last_seen_at = now()
  where user_id = auth.uid() and household_id = target_household;
end;
$$;

create or replace function public.accept_household_invitation(raw_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  invite public.invitations%rowtype;
  signed_in_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  profile_ready boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in before accepting this household invitation.';
  end if;

  select * into invite
  from public.invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
  for update;

  if invite.id is null or invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception 'Invitation is invalid, expired, or has already been used.';
  end if;
  if lower(invite.email) <> signed_in_email then
    raise exception 'Sign in with the email address that received this household invitation.';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;

  select nullif(trim(display_name), '') is not null into profile_ready
  from public.profiles
  where id = auth.uid();

  insert into public.member_onboarding_state (
    household_id,
    user_id,
    profile_completed,
    last_active_at,
    updated_at
  ) values (
    invite.household_id,
    auth.uid(),
    coalesce(profile_ready, false),
    now(),
    now()
  )
  on conflict (household_id, user_id) do update set
    profile_completed = excluded.profile_completed,
    last_active_at = now(),
    updated_at = now();

  update public.invitations
  set status = 'accepted',
      accepted_at = now()
  where id = invite.id;

  insert into public.app_events (
    household_id,
    user_id,
    event_name,
    properties
  ) values (
    invite.household_id,
    auth.uid(),
    'household_invitation_accepted',
    jsonb_build_object('invitation_id', invite.id, 'role', invite.role)
  );

  return invite.household_id;
end;
$$;

revoke all on function public.accept_household_invitation(text) from public;
grant execute on function public.accept_household_invitation(text) to authenticated;

create or replace function public.set_household_chore_completed(
  target_chore uuid,
  is_completed boolean
)
returns public.chores
language plpgsql security definer set search_path = public
as $$
declare
  chore public.chores%rowtype;
  updated_chore public.chores%rowtype;
  member_role public.household_role;
  action public.household_actions%rowtype;
begin
  select * into chore from public.chores where id = target_chore for update;
  if chore.id is null then raise exception 'Chore not found.'; end if;
  select role into member_role
  from public.household_members
  where household_id = chore.household_id and user_id = auth.uid();
  if member_role is null then raise exception 'Household access denied.'; end if;
  if chore.assigned_to is not null
    and chore.assigned_to <> auth.uid()
    and member_role not in ('owner', 'admin') then
    raise exception 'Only the assignee or an adult administrator can complete this chore.';
  end if;

  update public.chores set
    status = case when is_completed then 'completed'::public.chore_status else 'open'::public.chore_status end,
    completed_at = case when is_completed then now() else null end,
    completed_by = case when is_completed then auth.uid() else null end,
    updated_at = now()
  where id = chore.id
  returning * into updated_chore;

  if chore.source_action_id is not null then
    select * into action
    from public.household_actions
    where id = chore.source_action_id;
    if action.id is not null then
      perform public.transition_household_action(
        action.id,
        case when is_completed then 'completed' else 'in_progress' end,
        action.version,
        case when is_completed then 'Completed from the Chores screen' else 'Reopened from the Chores screen' end
      );
    end if;
  elsif is_completed and chore.created_by <> auth.uid() then
    insert into public.notification_outbox (
      household_id,
      recipient_user_id,
      category,
      title,
      body,
      deep_link,
      payload,
      dedupe_key
    ) values (
      chore.household_id,
      chore.created_by,
      'completion',
      'Chore completed',
      chore.title,
      'coho://chore/' || chore.id::text,
      jsonb_build_object(
        'screen', 'Chores',
        'choreId', chore.id,
        'deepLink', 'coho://chore/' || chore.id::text
      ),
      'chore:' || chore.id::text || ':completed:' ||
        extract(epoch from updated_chore.completed_at)::bigint::text
    );
  end if;
  return updated_chore;
end;
$$;

create or replace function public.claim_notification_batch(batch_size integer default 100)
returns setof public.notification_outbox
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimable as (
    select id
    from public.notification_outbox
    where status in ('queued', 'failed')
      and scheduled_for <= now()
      and next_attempt_at <= now()
      and (expires_at is null or expires_at > now())
      and attempts < max_attempts
    order by scheduled_for, created_at
    for update skip locked
    limit least(greatest(batch_size, 1), 500)
  )
  update public.notification_outbox target set
    status = 'sending',
    attempts = target.attempts + 1
  from claimable
  where target.id = claimable.id
  returning target.*;
end;
$$;

create or replace function public.queue_family_message_notifications()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notification_outbox (
    household_id,
    recipient_user_id,
    category,
    title,
    body,
    deep_link,
    payload,
    dedupe_key
  )
  select
    new.household_id,
    member.user_id,
    'family_message',
    'New family message',
    left(new.body, 180),
    'coho://message/' || new.id::text,
    jsonb_build_object(
      'screen', 'Chat',
      'messageId', new.id,
      'deepLink', 'coho://message/' || new.id::text
    ),
    'message:' || new.id::text || ':' || member.user_id::text
  from public.household_members member
  where member.household_id = new.household_id
    and member.user_id <> new.sender_id
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists queue_family_message_notifications on public.messages;
create trigger queue_family_message_notifications
  after insert on public.messages
  for each row execute function public.queue_family_message_notifications();

create or replace function public.queue_direct_chore_assignment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.source_action_id is null
    and new.assigned_to is not null
    and (
      tg_op = 'INSERT'
      or old.assigned_to is distinct from new.assigned_to
    ) then
    insert into public.notification_outbox (
      household_id,
      recipient_user_id,
      category,
      title,
      body,
      deep_link,
      payload,
      dedupe_key
    ) values (
      new.household_id,
      new.assigned_to,
      'assignment',
      'New family assignment',
      new.title,
      'coho://chore/' || new.id::text,
      jsonb_build_object(
        'screen', 'Chores',
        'choreId', new.id,
        'kind', 'chore',
        'deepLink', 'coho://chore/' || new.id::text
      ),
      'chore:' || new.id::text || ':assigned:' || new.assigned_to::text
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists queue_direct_chore_assignment on public.chores;
create trigger queue_direct_chore_assignment
  after insert or update of assigned_to on public.chores
  for each row execute function public.queue_direct_chore_assignment();

revoke all on function public.action_transition_allowed(text, text) from public;
revoke all on function public.queue_action_notification(public.household_actions, text, uuid, text, text) from public;
revoke all on function public.transition_household_action(uuid, text, integer, text) from public;
revoke all on function public.execute_household_action(uuid) from public;
revoke all on function public.approve_and_execute_household_action(uuid, integer) from public;
revoke all on function public.correct_household_action(uuid, integer, jsonb) from public;
revoke all on function public.list_calendar_connections(uuid) from public;
revoke all on function public.record_notification_opened(uuid, jsonb) from public;
revoke all on function public.record_member_active(uuid) from public;
revoke all on function public.set_household_chore_completed(uuid, boolean) from public;
revoke all on function public.claim_notification_batch(integer) from public;
revoke all on function public.queue_family_message_notifications() from public;
revoke all on function public.queue_direct_chore_assignment() from public;
grant execute on function public.transition_household_action(uuid, text, integer, text) to authenticated;
grant execute on function public.execute_household_action(uuid) to authenticated;
grant execute on function public.approve_and_execute_household_action(uuid, integer) to authenticated;
grant execute on function public.correct_household_action(uuid, integer, jsonb) to authenticated;
grant execute on function public.list_calendar_connections(uuid) to authenticated;
grant execute on function public.record_notification_opened(uuid, jsonb) to authenticated;
grant execute on function public.record_member_active(uuid) to authenticated;
grant execute on function public.set_household_chore_completed(uuid, boolean) to authenticated;
grant execute on function public.claim_notification_batch(integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-inbox',
  'family-inbox',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'text/calendar',
    'audio/m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "household members read reviewed inbox attachments"
on storage.objects for select to authenticated using (
  bucket_id = 'family-inbox'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);
create policy "household members upload deliberate inbox items"
on storage.objects for insert to authenticated with check (
  bucket_id = 'family-inbox'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

create index household_actions_household_status_idx
  on public.household_actions(household_id, status, due_at, starts_at);
create index household_actions_assignment_idx
  on public.household_actions(assigned_user_id, status, updated_at desc);
create index household_actions_source_idx
  on public.household_actions(source_kind, source_id);
create index household_action_events_action_idx
  on public.household_action_events(action_id, occurred_at);
create index inbound_attachments_item_idx
  on public.inbound_attachments(inbound_item_id, status);
create index inbox_extractions_item_idx
  on public.inbox_extractions(inbound_item_id, extraction_version desc);
create index notification_outbox_dispatch_idx
  on public.notification_outbox(status, next_attempt_at, scheduled_for);
create index briefing_snapshots_user_idx
  on public.briefing_snapshots(user_id, local_date desc, briefing_type);
create index automation_rules_next_run_idx
  on public.automation_rules(enabled, next_run_at);
create index automation_runs_rule_idx
  on public.automation_runs(rule_id, started_at desc);
create index calendar_connections_sync_idx
  on public.calendar_connections(status, sync_enabled, last_synced_at);
create index calendar_event_links_event_idx
  on public.calendar_event_links(household_id, event_id);
create index calendar_conflicts_household_idx
  on public.calendar_sync_conflicts(household_id, status, created_at desc);
create index app_events_correlation_idx
  on public.app_events(correlation_id, created_at desc);

create unique index events_source_action_idx
  on public.events(source_action_id) where source_action_id is not null;
create unique index chores_source_action_idx
  on public.chores(source_action_id) where source_action_id is not null;
create unique index follow_ups_source_action_idx
  on public.event_follow_ups(source_action_id) where source_action_id is not null;
create index grocery_items_source_action_idx
  on public.grocery_items(source_action_id) where source_action_id is not null;
create index meal_plans_source_action_idx
  on public.meal_plans(source_action_id) where source_action_id is not null;
create unique index inbound_items_fingerprint_idx
  on public.inbound_items(household_id, content_fingerprint)
  where content_fingerprint is not null;

alter publication supabase_realtime add table public.household_actions;
alter publication supabase_realtime add table public.household_action_events;
alter publication supabase_realtime add table public.inbox_extractions;
alter publication supabase_realtime add table public.notification_outbox;
alter publication supabase_realtime add table public.briefing_snapshots;
alter publication supabase_realtime add table public.automation_rules;
alter publication supabase_realtime add table public.automation_runs;
alter publication supabase_realtime add table public.calendar_event_links;
alter publication supabase_realtime add table public.calendar_sync_conflicts;

-- Account deletion must be able to remove the auth/profile row without
-- destroying shared household records. Creator attribution becomes anonymous,
-- while user-owned sessions, tokens, locations, and memberships still cascade.
alter table public.households alter column created_by drop not null;
alter table public.invitations alter column invited_by drop not null;
alter table public.events alter column created_by drop not null;
alter table public.chores alter column created_by drop not null;
alter table public.notes alter column created_by drop not null;
alter table public.notes alter column updated_by drop not null;
alter table public.messages alter column sender_id drop not null;
alter table public.household_inboxes alter column created_by drop not null;
alter table public.family_places alter column created_by drop not null;
alter table public.grocery_items alter column added_by drop not null;
alter table public.meal_plans alter column created_by drop not null;
alter table public.meal_plans alter column updated_by drop not null;
alter table public.household_people alter column created_by drop not null;
alter table public.event_follow_ups alter column created_by drop not null;
alter table public.household_inbox_sender_rules alter column created_by drop not null;
alter table public.travel_spaces alter column created_by drop not null;
alter table public.travel_space_invitations alter column invited_by drop not null;
alter table public.travel_events alter column created_by drop not null;
alter table public.automation_rules alter column created_by drop not null;

alter table public.households drop constraint if exists households_created_by_fkey;
alter table public.households add constraint households_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.invitations drop constraint if exists invitations_invited_by_fkey;
alter table public.invitations add constraint invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;
alter table public.events drop constraint if exists events_created_by_fkey;
alter table public.events add constraint events_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.chores drop constraint if exists chores_assigned_to_fkey;
alter table public.chores add constraint chores_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;
alter table public.chores drop constraint if exists chores_created_by_fkey;
alter table public.chores add constraint chores_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.notes drop constraint if exists notes_created_by_fkey;
alter table public.notes add constraint notes_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.notes drop constraint if exists notes_updated_by_fkey;
alter table public.notes add constraint notes_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete set null;
alter table public.household_inboxes drop constraint if exists household_inboxes_created_by_fkey;
alter table public.household_inboxes add constraint household_inboxes_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.inbound_items drop constraint if exists inbound_items_reviewed_by_fkey;
alter table public.inbound_items add constraint inbound_items_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;
alter table public.family_places drop constraint if exists family_places_created_by_fkey;
alter table public.family_places add constraint family_places_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.grocery_items drop constraint if exists grocery_items_added_by_fkey;
alter table public.grocery_items add constraint grocery_items_added_by_fkey
  foreign key (added_by) references public.profiles(id) on delete set null;
alter table public.grocery_items drop constraint if exists grocery_items_checked_by_fkey;
alter table public.grocery_items add constraint grocery_items_checked_by_fkey
  foreign key (checked_by) references public.profiles(id) on delete set null;
alter table public.meal_plans drop constraint if exists meal_plans_created_by_fkey;
alter table public.meal_plans add constraint meal_plans_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.meal_plans drop constraint if exists meal_plans_updated_by_fkey;
alter table public.meal_plans add constraint meal_plans_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;
alter table public.household_people drop constraint if exists household_people_created_by_fkey;
alter table public.household_people add constraint household_people_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.event_follow_ups drop constraint if exists event_follow_ups_created_by_fkey;
alter table public.event_follow_ups add constraint event_follow_ups_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.event_follow_ups drop constraint if exists event_follow_ups_completed_by_fkey;
alter table public.event_follow_ups add constraint event_follow_ups_completed_by_fkey
  foreign key (completed_by) references public.profiles(id) on delete set null;
alter table public.household_inbox_sender_rules drop constraint if exists household_inbox_sender_rules_created_by_fkey;
alter table public.household_inbox_sender_rules add constraint household_inbox_sender_rules_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.travel_spaces drop constraint if exists travel_spaces_created_by_fkey;
alter table public.travel_spaces add constraint travel_spaces_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.travel_space_invitations drop constraint if exists travel_space_invitations_invited_by_fkey;
alter table public.travel_space_invitations add constraint travel_space_invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;
alter table public.travel_events drop constraint if exists travel_events_created_by_fkey;
alter table public.travel_events add constraint travel_events_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.automation_rules drop constraint if exists automation_rules_created_by_fkey;
alter table public.automation_rules add constraint automation_rules_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  household_id uuid references public.households(id) on delete set null,
  request_type text not null check (request_type in ('export', 'account_deletion')),
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'completed', 'failed', 'canceled')),
  export_path text,
  export_expires_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.data_subject_requests enable row level security;
create policy "users read own privacy requests"
on public.data_subject_requests for select using (user_id = auth.uid());
create index data_subject_requests_user_idx
  on public.data_subject_requests(user_id, requested_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'privacy-exports',
  'privacy-exports',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

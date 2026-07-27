-- Direct mailbox OAuth and incremental-sync foundation.
--
-- Token-bearing tables are intentionally isolated from authenticated clients.
-- Only trusted service-role Edge Functions may read or write them. The mobile
-- app receives a sanitized summary through list_mailbox_connections().

create table public.mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid unique references public.household_email_sources(id) on delete set null,
  provider text not null check (provider in ('google', 'outlook')),
  provider_account_id text not null
    check (char_length(trim(provider_account_id)) between 1 and 500),
  provider_email text,
  display_name text check (display_name is null or char_length(display_name) <= 160),
  scopes text[] not null default '{}',
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'active',
        'syncing',
        'reauthorize',
        'paused',
        'disconnected',
        'error'
      )
    ),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  selected_folders jsonb not null default '[]'::jsonb
    check (jsonb_typeof(selected_folders) = 'array'),
  sync_policy jsonb not null default
    '{"mode":"inbox","lookbackDays":0,"autoAction":"review","includeAttachments":true}'::jsonb
    check (jsonb_typeof(sync_policy) = 'object'),
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_account_id),
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id)
    on delete cascade,
  check (
    provider_email is null
    or (
      provider_email = lower(trim(provider_email))
      and provider_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    )
  )
);

comment on table public.mailbox_connections is
  'Service-role-only mailbox OAuth grants and encrypted provider tokens.';
comment on column public.mailbox_connections.sync_policy is
  'Consent and ingestion policy only; raw provider data must never be stored here.';
comment on column public.mailbox_connections.access_token_ciphertext is
  'Application-encrypted access token. Never expose through a client RPC.';
comment on column public.mailbox_connections.refresh_token_ciphertext is
  'Application-encrypted refresh token. Never expose through a client RPC.';

create table public.mailbox_oauth_states (
  state_hash text primary key
    check (char_length(state_hash) between 32 and 256),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid references public.household_email_sources(id) on delete set null,
  provider text not null check (provider in ('google', 'outlook')),
  requested_scopes text[] not null default '{}',
  code_verifier_ciphertext text not null,
  redirect_uri text not null check (char_length(trim(redirect_uri)) > 0),
  return_uri text not null check (char_length(trim(return_uri)) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  foreign key (household_id, user_id)
    references public.household_members(household_id, user_id)
    on delete cascade,
  check (expires_at > created_at)
);

comment on table public.mailbox_oauth_states is
  'Short-lived, service-role-only PKCE state for mailbox OAuth callbacks.';
comment on column public.mailbox_oauth_states.code_verifier_ciphertext is
  'Application-encrypted PKCE verifier. Never expose to authenticated clients.';

create table public.mailbox_sync_cursors (
  connection_id uuid not null
    references public.mailbox_connections(id) on delete cascade,
  provider_folder_id text not null
    check (char_length(trim(provider_folder_id)) between 1 and 1000),
  cursor text,
  subscription_id text,
  subscription_resource text,
  subscription_client_state_ciphertext text,
  subscription_expires_at timestamptz,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (connection_id, provider_folder_id)
);

comment on table public.mailbox_sync_cursors is
  'Service-role-only Gmail history or Microsoft Graph delta and subscription state.';
comment on column public.mailbox_sync_cursors.cursor is
  'Opaque provider cursor such as a Gmail history ID or Microsoft delta link.';
comment on column public.mailbox_sync_cursors.subscription_client_state_ciphertext is
  'Encrypted webhook client state used to authenticate provider notifications.';

create table public.mailbox_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.mailbox_connections(id) on delete cascade,
  run_type text not null
    check (run_type in ('initial', 'incremental', 'webhook', 'reconcile', 'manual')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')),
  provider_folder_id text,
  correlation_id text,
  cursor_before text,
  cursor_after text,
  messages_scanned integer not null default 0 check (messages_scanned >= 0),
  messages_imported integer not null default 0 check (messages_imported >= 0),
  messages_skipped integer not null default 0 check (messages_skipped >= 0),
  attachments_imported integer not null default 0 check (attachments_imported >= 0),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  check (
    completed_at is null
    or started_at is null
    or completed_at >= started_at
  )
);

comment on table public.mailbox_sync_runs is
  'Service-role-only operational audit for mailbox synchronization; never store raw message bodies.';

alter table public.inbound_items
  add column if not exists mailbox_connection_id uuid
    references public.mailbox_connections(id) on delete set null,
  add column if not exists mailbox_sync_run_id uuid
    references public.mailbox_sync_runs(id) on delete set null,
  add column if not exists provider_folder_id text,
  add column if not exists provider_thread_id text,
  add column if not exists provider_message_id text,
  add column if not exists provider_message_etag text,
  add column if not exists provider_received_at timestamptz,
  add column if not exists provider_sender_authenticated boolean not null default false,
  add column if not exists provider_sender_authentication text;

comment on column public.inbound_items.mailbox_connection_id is
  'Direct mailbox connection that imported this item; null for forwarding, upload, or share ingestion.';
comment on column public.inbound_items.mailbox_sync_run_id is
  'Synchronization run that imported this item.';
comment on column public.inbound_items.provider_message_id is
  'Provider message identifier, unique only within its mailbox connection.';
comment on column public.inbound_items.provider_sender_authenticated is
  'True only when provider-returned authentication results clearly pass DMARC or Microsoft composite authentication.';

create index mailbox_connections_household_user_status_idx
  on public.mailbox_connections (household_id, user_id, status, updated_at desc);

create index mailbox_connections_token_expiry_idx
  on public.mailbox_connections (token_expires_at)
  where sync_enabled
    and status in ('active', 'syncing')
    and token_expires_at is not null;

create index mailbox_oauth_states_unconsumed_expiry_idx
  on public.mailbox_oauth_states (expires_at)
  where consumed_at is null;

create index mailbox_sync_cursors_subscription_expiry_idx
  on public.mailbox_sync_cursors (subscription_expires_at)
  where subscription_id is not null
    and subscription_expires_at is not null;

create unique index mailbox_sync_cursors_subscription_id_idx
  on public.mailbox_sync_cursors (subscription_id)
  where subscription_id is not null;

create index mailbox_sync_runs_connection_created_idx
  on public.mailbox_sync_runs (connection_id, created_at desc);

create index mailbox_sync_runs_pending_idx
  on public.mailbox_sync_runs (created_at)
  where status in ('queued', 'running');

create unique index inbound_items_mailbox_message_dedupe_idx
  on public.inbound_items (mailbox_connection_id, provider_message_id)
  where mailbox_connection_id is not null
    and provider_message_id is not null;

create index inbound_items_mailbox_received_idx
  on public.inbound_items (mailbox_connection_id, provider_received_at desc)
  where mailbox_connection_id is not null;

create index inbound_items_mailbox_thread_idx
  on public.inbound_items (mailbox_connection_id, provider_thread_id)
  where mailbox_connection_id is not null
    and provider_thread_id is not null;

alter table public.mailbox_connections enable row level security;
alter table public.mailbox_oauth_states enable row level security;
alter table public.mailbox_sync_cursors enable row level security;
alter table public.mailbox_sync_runs enable row level security;

-- Deliberately create no client-facing policies on the four tables above.
-- The service role bypasses RLS; authenticated users can only use the sanitized
-- list RPC below.
revoke all on table public.mailbox_connections from anon, authenticated;
revoke all on table public.mailbox_oauth_states from anon, authenticated;
revoke all on table public.mailbox_sync_cursors from anon, authenticated;
revoke all on table public.mailbox_sync_runs from anon, authenticated;

grant all on table public.mailbox_connections to service_role;
grant all on table public.mailbox_oauth_states to service_role;
grant all on table public.mailbox_sync_cursors to service_role;
grant all on table public.mailbox_sync_runs to service_role;

create or replace function public.list_mailbox_connections(target_household uuid)
returns table (
  id uuid,
  source_id uuid,
  provider text,
  provider_email text,
  display_name text,
  status text,
  selected_folders jsonb,
  sync_policy jsonb,
  sync_enabled boolean,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    connection.id,
    connection.source_id,
    connection.provider,
    connection.provider_email,
    connection.display_name,
    connection.status,
    connection.selected_folders,
    connection.sync_policy,
    connection.sync_enabled,
    connection.last_synced_at,
    connection.last_error,
    connection.created_at,
    connection.updated_at
  from public.mailbox_connections connection
  where connection.household_id = target_household
    and connection.user_id = auth.uid()
    and public.is_household_member(target_household)
  order by connection.created_at;
$$;

comment on function public.list_mailbox_connections(uuid) is
  'Returns sanitized mailbox connection metadata for the signed-in user only.';

revoke all on function public.list_mailbox_connections(uuid) from public;
revoke all on function public.list_mailbox_connections(uuid) from anon;
grant execute on function public.list_mailbox_connections(uuid) to authenticated;

-- Direct mailbox extraction can contain private medical, school, travel, and
-- financial details. Keep raw summaries and unapproved proposed actions
-- visible only to adult household administrators. Once an inbox action has
-- actually been approved, ordinary household visibility resumes.
drop policy if exists "members read inbox extractions"
  on public.inbox_extractions;
drop policy if exists "adult admins read inbox extractions"
  on public.inbox_extractions;
create policy "adult admins read inbox extractions"
  on public.inbox_extractions
  for select
  to authenticated
  using (public.is_household_admin(household_id));

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
      source_kind <> 'family_inbox'
      or approved_at is not null
      or status in ('approved', 'scheduled', 'in_progress', 'completed')
      or public.is_household_admin(household_id)
    )
  );

-- Family Inbox proposals are private approval artifacts. Keep direct inserts
-- and every mutation path (including older SECURITY DEFINER RPCs) restricted
-- to adult household administrators until approval makes the action visible.
drop policy if exists "members create household actions"
  on public.household_actions;
create policy "members create household actions"
  on public.household_actions
  for insert
  to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = auth.uid()
    and (
      source_kind <> 'family_inbox'
      or public.is_household_admin(household_id)
    )
  );

create or replace function public.guard_private_family_inbox_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_kind = 'family_inbox'
    and old.approved_at is null
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_household_admin(old.household_id) then
    raise exception 'Only an adult household administrator can review this Family Inbox action.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_private_family_inbox_action
  on public.household_actions;
create trigger guard_private_family_inbox_action
  before update or delete on public.household_actions
  for each row execute function public.guard_private_family_inbox_action();

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
          action.source_kind <> 'family_inbox'
          or action.approved_at is not null
          or action.status in ('approved', 'scheduled', 'in_progress', 'completed')
          or public.is_household_admin(action.household_id)
        )
    )
  );

-- Any pre-release experimental value is neutralized. Direct mailbox always
-- enters the explicit Family Inbox review queue in this release.
update public.mailbox_connections
set
  sync_policy = jsonb_set(
    coalesce(sync_policy, '{}'::jsonb),
    '{autoAction}',
    '"review"'::jsonb,
    true
  ),
  updated_at = now()
where coalesce(sync_policy ->> 'autoAction', '') <> 'review';

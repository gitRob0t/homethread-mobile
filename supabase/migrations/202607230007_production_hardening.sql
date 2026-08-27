-- Production hardening that is safe to apply to projects where the closed-loop
-- migration was deployed before its second-user and privacy revisions landed.

drop policy if exists "members read household onboarding"
  on public.member_onboarding_state;
create policy "members read household onboarding"
on public.member_onboarding_state for select
using (public.is_household_member(household_id));

create or replace function public.mark_action_onboarding_progress()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.actor_user_id is not null
    and new.event_type in ('approved', 'accepted', 'executed', 'completed') then
    insert into public.member_onboarding_state (
      household_id,
      user_id,
      first_action_completed,
      last_active_at,
      updated_at
    ) values (
      new.household_id,
      new.actor_user_id,
      true,
      now(),
      now()
    )
    on conflict (household_id, user_id) do update set
      first_action_completed = true,
      last_active_at = now(),
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists mark_action_onboarding_progress
  on public.household_action_events;
create trigger mark_action_onboarding_progress
  after insert on public.household_action_events
  for each row execute function public.mark_action_onboarding_progress();

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

-- Shared household content survives account deletion, but creator attribution
-- becomes anonymous. User-owned credentials, memberships, locations, and
-- private assistant history continue to cascade from the profile.
do $$
declare
  relation record;
begin
  for relation in
    select * from (values
      ('households', 'created_by', 'households_created_by_fkey'),
      ('invitations', 'invited_by', 'invitations_invited_by_fkey'),
      ('events', 'created_by', 'events_created_by_fkey'),
      ('chores', 'assigned_to', 'chores_assigned_to_fkey'),
      ('chores', 'created_by', 'chores_created_by_fkey'),
      ('notes', 'created_by', 'notes_created_by_fkey'),
      ('notes', 'updated_by', 'notes_updated_by_fkey'),
      ('messages', 'sender_id', 'messages_sender_id_fkey'),
      ('household_inboxes', 'created_by', 'household_inboxes_created_by_fkey'),
      ('inbound_items', 'reviewed_by', 'inbound_items_reviewed_by_fkey'),
      ('family_places', 'created_by', 'family_places_created_by_fkey'),
      ('grocery_items', 'added_by', 'grocery_items_added_by_fkey'),
      ('grocery_items', 'checked_by', 'grocery_items_checked_by_fkey'),
      ('meal_plans', 'created_by', 'meal_plans_created_by_fkey'),
      ('meal_plans', 'updated_by', 'meal_plans_updated_by_fkey'),
      ('household_people', 'created_by', 'household_people_created_by_fkey'),
      ('event_follow_ups', 'created_by', 'event_follow_ups_created_by_fkey'),
      ('event_follow_ups', 'completed_by', 'event_follow_ups_completed_by_fkey'),
      ('household_inbox_sender_rules', 'created_by', 'household_inbox_sender_rules_created_by_fkey'),
      ('travel_spaces', 'created_by', 'travel_spaces_created_by_fkey'),
      ('travel_space_invitations', 'invited_by', 'travel_space_invitations_invited_by_fkey'),
      ('travel_events', 'created_by', 'travel_events_created_by_fkey'),
      ('automation_rules', 'created_by', 'automation_rules_created_by_fkey')
    ) as mappings(table_name, column_name, constraint_name)
  loop
    execute format(
      'alter table public.%I alter column %I drop not null',
      relation.table_name,
      relation.column_name
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      relation.table_name,
      relation.constraint_name
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
      relation.table_name,
      relation.constraint_name,
      relation.column_name
    );
  end loop;
end;
$$;

create table if not exists public.data_subject_requests (
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
drop policy if exists "users read own privacy requests"
  on public.data_subject_requests;
create policy "users read own privacy requests"
on public.data_subject_requests for select
using (user_id = auth.uid());
create index if not exists data_subject_requests_user_idx
  on public.data_subject_requests(user_id, requested_at desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
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

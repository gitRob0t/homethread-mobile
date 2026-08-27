-- Coho household OS: consented location, shared food planning, and
-- privacy-scoped travel spaces for friends and extended family.

create table public.member_locations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  precision text not null default 'approximate'
    check (precision in ('approximate', 'precise')),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, household_id)
);

create table public.place_activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  place_id uuid not null references public.family_places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('enter', 'exit')),
  occurred_at timestamptz not null default now()
);

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  quantity text,
  category text not null default 'Other',
  checked boolean not null default false,
  added_by uuid not null references public.profiles(id),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meal_date date not null,
  meal_type text not null default 'dinner'
    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  recipe_url text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, meal_date, meal_type)
);

create table public.household_people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  linked_user_id uuid references public.profiles(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  date_of_birth date,
  bio text,
  role text not null default 'Family member'
    check (role in ('Adult admin', 'Family member', 'Child')),
  avatar_url text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, linked_user_id)
);

alter table public.notification_preferences
  add column if not exists week_ahead boolean not null default true,
  add column if not exists follow_up boolean not null default true,
  add column if not exists push_delivery boolean not null default true,
  add column if not exists email_copy boolean not null default false,
  add column if not exists week_ahead_weekday smallint not null default 0
    check (week_ahead_weekday between 0 and 6),
  add column if not exists week_ahead_time time not null default '18:00',
  add column if not exists follow_up_weekday smallint not null default 5
    check (follow_up_weekday between 0 and 6),
  add column if not exists follow_up_time time not null default '17:00';

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  expo_push_token text not null unique check (expo_push_token ~ '^ExponentPushToken|^ExpoPushToken'),
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.briefing_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  briefing_type text not null check (briefing_type in ('daily', 'week_ahead', 'follow_up')),
  local_date date not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider_response jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, household_id, briefing_type, local_date)
);

create table public.event_follow_ups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  note text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'completed')),
  created_by uuid not null references public.profiles(id),
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

alter table public.household_inboxes
  add column if not exists display_name text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inbound_items
  add column if not exists provider_event_id text,
  add column if not exists provider_email_id text,
  add column if not exists message_id text,
  add column if not exists recipient text,
  add column if not exists body_text text,
  add column if not exists body_html_present boolean not null default false,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists review_notes text;

create table public.household_inbox_sender_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  inbox_id uuid not null references public.household_inboxes(id) on delete cascade,
  sender_address text not null check (sender_address = lower(sender_address)),
  trusted boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inbox_id, sender_address)
);

create table public.travel_spaces (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  destination text,
  starts_on date,
  ends_on date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.travel_space_members (
  travel_space_id uuid not null references public.travel_spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'guest' check (role in ('host', 'planner', 'guest')),
  joined_at timestamptz not null default now(),
  primary key (travel_space_id, user_id)
);

create table public.travel_space_invitations (
  id uuid primary key default gen_random_uuid(),
  travel_space_id uuid not null references public.travel_spaces(id) on delete cascade,
  email text not null,
  role text not null default 'guest' check (role in ('planner', 'guest')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table public.travel_events (
  id uuid primary key default gen_random_uuid(),
  travel_space_id uuid not null references public.travel_spaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  reservation_url text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_locations enable row level security;
alter table public.place_activity enable row level security;
alter table public.grocery_items enable row level security;
alter table public.meal_plans enable row level security;
alter table public.household_people enable row level security;
alter table public.device_push_tokens enable row level security;
alter table public.briefing_deliveries enable row level security;
alter table public.event_follow_ups enable row level security;
alter table public.household_inbox_sender_rules enable row level security;
alter table public.travel_spaces enable row level security;
alter table public.travel_space_members enable row level security;
alter table public.travel_space_invitations enable row level security;
alter table public.travel_events enable row level security;

create or replace function public.is_travel_space_member(target_space uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.travel_space_members
    where travel_space_id = target_space and user_id = auth.uid()
  );
$$;

create policy "members read consented household locations"
on public.member_locations for select using (
  user_id = auth.uid()
  or (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.member_location_settings settings
      where settings.user_id = member_locations.user_id
        and settings.household_id = member_locations.household_id
        and settings.sharing_enabled
    )
  )
);
create policy "users manage own household location"
on public.member_locations for all using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.is_household_member(household_id)
  and exists (
    select 1 from public.member_location_settings settings
    where settings.user_id = auth.uid()
      and settings.household_id = member_locations.household_id
      and settings.sharing_enabled
  )
);

create policy "members read consented place activity"
on public.place_activity for select using (
  user_id = auth.uid()
  or (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.member_location_settings settings
      where settings.user_id = place_activity.user_id
        and settings.household_id = place_activity.household_id
        and settings.sharing_enabled
    )
  )
);
create policy "users record own place activity"
on public.place_activity for insert with check (
  user_id = auth.uid() and public.is_household_member(household_id)
);

create policy "members manage shared groceries"
on public.grocery_items for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));
create policy "members manage shared meal plans"
on public.meal_plans for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members read household people"
on public.household_people for select using (public.is_household_member(household_id));
create policy "admins create household people"
on public.household_people for insert with check (
  public.is_household_admin(household_id) and created_by = auth.uid()
);
create policy "admins or linked users update household people"
on public.household_people for update using (
  public.is_household_admin(household_id) or linked_user_id = auth.uid()
) with check (
  public.is_household_admin(household_id) or linked_user_id = auth.uid()
);
create policy "admins delete household people"
on public.household_people for delete using (public.is_household_admin(household_id));
create policy "users manage own push devices"
on public.device_push_tokens for all using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (household_id is null or public.is_household_member(household_id))
);
create policy "users read own briefing deliveries"
on public.briefing_deliveries for select using (user_id = auth.uid());
create policy "members manage event follow ups"
on public.event_follow_ups for all using (
  public.is_household_member(household_id)
) with check (
  public.is_household_member(household_id)
);
create policy "members read household inbox sender rules"
on public.household_inbox_sender_rules for select using (
  public.is_household_member(household_id)
);
create policy "admins manage household inbox sender rules"
on public.household_inbox_sender_rules for all using (
  public.is_household_admin(household_id)
) with check (
  public.is_household_admin(household_id) and created_by = auth.uid()
);

create or replace function public.reserve_household_inbox(
  target_household uuid,
  requested_alias text,
  requested_display_name text default null
)
returns table(inbox_id uuid, inbox_alias text, inbox_domain text, inbox_status text)
language plpgsql security definer set search_path = public
as $$
declare
  normalized_alias text := lower(trim(requested_alias));
  saved public.household_inboxes%rowtype;
begin
  if not public.is_household_admin(target_household) then
    raise exception 'Only household administrators can reserve the family inbox.';
  end if;
  if normalized_alias !~ '^[a-z0-9][a-z0-9-]{2,48}$' then
    raise exception 'Use 3–49 lowercase letters, numbers, or hyphens.';
  end if;

  insert into public.household_inboxes (
    household_id,
    alias,
    display_name,
    created_by,
    updated_at
  ) values (
    target_household,
    normalized_alias,
    nullif(trim(requested_display_name), ''),
    auth.uid(),
    now()
  )
  on conflict (household_id) do update set
    alias = excluded.alias,
    display_name = excluded.display_name,
    updated_at = now()
  returning * into saved;

  return query select saved.id, saved.alias, saved.domain, saved.status;
exception
  when unique_violation then
    raise exception 'That family address is already taken. Try another.';
end;
$$;

create or replace function public.sync_household_person()
returns trigger language plpgsql security definer set search_path = public
as $$
declare profile_name text;
begin
  select display_name into profile_name from public.profiles where id = new.user_id;
  insert into public.household_people (
    household_id, linked_user_id, display_name, role, created_by
  ) values (
    new.household_id,
    new.user_id,
    coalesce(profile_name, 'Family member'),
    case
      when new.role in ('owner', 'admin') then 'Adult admin'
      when new.role = 'child' then 'Child'
      else 'Family member'
    end,
    new.user_id
  )
  on conflict (household_id, linked_user_id) do update set
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_household_person_on_membership on public.household_members;
create trigger sync_household_person_on_membership
  after insert or update of role on public.household_members
  for each row execute procedure public.sync_household_person();

insert into public.household_people (
  household_id, linked_user_id, display_name, role, created_by
)
select
  members.household_id,
  members.user_id,
  profiles.display_name,
  case
    when members.role in ('owner', 'admin') then 'Adult admin'
    when members.role = 'child' then 'Child'
    else 'Family member'
  end,
  members.user_id
from public.household_members members
join public.profiles profiles on profiles.id = members.user_id
on conflict (household_id, linked_user_id) do nothing;

create or replace function public.can_manage_household_person(target_person uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.household_people person
    where person.id = target_person
      and (
        person.linked_user_id = auth.uid()
        or public.is_household_admin(person.household_id)
      )
  );
$$;

create policy "travel members read spaces"
on public.travel_spaces for select using (public.is_travel_space_member(id));
create policy "users create travel spaces"
on public.travel_spaces for insert with check (created_by = auth.uid());
create policy "hosts update travel spaces"
on public.travel_spaces for update using (
  exists (
    select 1 from public.travel_space_members
    where travel_space_id = id and user_id = auth.uid() and role in ('host', 'planner')
  )
);
create policy "hosts delete travel spaces"
on public.travel_spaces for delete using (
  exists (
    select 1 from public.travel_space_members
    where travel_space_id = id and user_id = auth.uid() and role = 'host'
  )
);
create policy "travel members read membership"
on public.travel_space_members for select using (public.is_travel_space_member(travel_space_id));
create policy "travel members read invitations"
on public.travel_space_invitations for select using (public.is_travel_space_member(travel_space_id));
create policy "travel members manage events"
on public.travel_events for all using (public.is_travel_space_member(travel_space_id))
with check (public.is_travel_space_member(travel_space_id));

create or replace function public.create_travel_space(
  space_title text,
  space_destination text default null,
  space_starts_on date default null,
  space_ends_on date default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  if nullif(trim(space_title), '') is null then
    raise exception 'A trip name is required.';
  end if;
  insert into public.travel_spaces (title, destination, starts_on, ends_on, created_by)
  values (
    trim(space_title),
    nullif(trim(space_destination), ''),
    space_starts_on,
    space_ends_on,
    auth.uid()
  ) returning id into new_id;
  insert into public.travel_space_members (travel_space_id, user_id, role)
  values (new_id, auth.uid(), 'host');
  return new_id;
end;
$$;

create or replace function public.create_travel_space_invitation(
  target_space uuid,
  target_email text,
  target_role text default 'guest'
)
returns table(invitation_id uuid, invitation_token text)
language plpgsql security definer set search_path = public
as $$
declare
  raw_token text := encode(gen_random_bytes(24), 'hex');
  new_id uuid;
begin
  if not exists (
    select 1 from public.travel_space_members
    where travel_space_id = target_space
      and user_id = auth.uid()
      and role in ('host', 'planner')
  ) then
    raise exception 'Only trip hosts and planners can invite guests.';
  end if;
  if nullif(trim(target_email), '') is null then
    raise exception 'An email address is required.';
  end if;
  if target_role not in ('planner', 'guest') then
    raise exception 'Invalid trip role.';
  end if;
  insert into public.travel_space_invitations (
    travel_space_id, email, role, token_hash, invited_by
  ) values (
    target_space,
    lower(trim(target_email)),
    target_role,
    encode(digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  ) returning id into new_id;
  return query select new_id, raw_token;
end;
$$;

create or replace function public.accept_travel_space_invitation(raw_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare invite public.travel_space_invitations%rowtype;
begin
  select * into invite from public.travel_space_invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and status = 'pending' and expires_at > now();
  if invite.id is null then
    raise exception 'Trip invitation is invalid or expired.';
  end if;
  if lower(invite.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Sign in with the email address that received this trip invitation.';
  end if;
  insert into public.travel_space_members (travel_space_id, user_id, role)
  values (invite.travel_space_id, auth.uid(), invite.role)
  on conflict (travel_space_id, user_id) do update set role = excluded.role;
  update public.travel_space_invitations
  set status = 'accepted' where id = invite.id;
  return invite.travel_space_id;
end;
$$;

create or replace function public.accept_household_invitation(raw_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare invite public.invitations%rowtype;
begin
  select * into invite from public.invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and status = 'pending' and expires_at > now();
  if invite.id is null then
    raise exception 'Invitation is invalid or expired.';
  end if;
  if lower(invite.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Sign in with the email address that received this household invitation.';
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;
  update public.invitations set status = 'accepted' where id = invite.id;
  return invite.household_id;
end;
$$;

revoke all on function public.is_travel_space_member(uuid) from public;
revoke all on function public.can_manage_household_person(uuid) from public;
revoke all on function public.reserve_household_inbox(uuid, text, text) from public;
revoke all on function public.create_travel_space(text, text, date, date) from public;
revoke all on function public.create_travel_space_invitation(uuid, text, text) from public;
revoke all on function public.accept_travel_space_invitation(text) from public;
grant execute on function public.is_travel_space_member(uuid) to authenticated;
grant execute on function public.can_manage_household_person(uuid) to authenticated;
grant execute on function public.reserve_household_inbox(uuid, text, text) to authenticated;
grant execute on function public.create_travel_space(text, text, date, date) to authenticated;
grant execute on function public.create_travel_space_invitation(uuid, text, text) to authenticated;
grant execute on function public.accept_travel_space_invitation(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-avatars',
  'family-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "household members read family avatars"
on storage.objects for select to authenticated using (
  bucket_id = 'family-avatars'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);
create policy "authorized people upload family avatars"
on storage.objects for insert to authenticated with check (
  bucket_id = 'family-avatars'
  and public.can_manage_household_person(((storage.foldername(name))[2])::uuid)
);
create policy "authorized people update family avatars"
on storage.objects for update to authenticated using (
  bucket_id = 'family-avatars'
  and public.can_manage_household_person(((storage.foldername(name))[2])::uuid)
) with check (
  bucket_id = 'family-avatars'
  and public.can_manage_household_person(((storage.foldername(name))[2])::uuid)
);
create policy "authorized people delete family avatars"
on storage.objects for delete to authenticated using (
  bucket_id = 'family-avatars'
  and public.can_manage_household_person(((storage.foldername(name))[2])::uuid)
);

create index member_locations_household_updated_idx
  on public.member_locations(household_id, updated_at desc);
create index place_activity_household_occurred_idx
  on public.place_activity(household_id, occurred_at desc);
create index grocery_items_household_checked_idx
  on public.grocery_items(household_id, checked, created_at);
create index meal_plans_household_date_idx
  on public.meal_plans(household_id, meal_date);
create index household_people_household_idx
  on public.household_people(household_id, created_at);
create index device_push_tokens_user_idx
  on public.device_push_tokens(user_id, enabled, last_seen_at desc);
create index briefing_deliveries_date_idx
  on public.briefing_deliveries(local_date, briefing_type);
create index event_follow_ups_household_status_idx
  on public.event_follow_ups(household_id, status, due_at);
create unique index inbound_items_provider_email_idx
  on public.inbound_items(provider_email_id)
  where provider_email_id is not null;
create unique index inbound_items_provider_event_idx
  on public.inbound_items(provider_event_id)
  where provider_event_id is not null;
create index inbox_sender_rules_household_idx
  on public.household_inbox_sender_rules(household_id, sender_address);
create index travel_space_members_user_idx
  on public.travel_space_members(user_id, joined_at desc);
create index travel_events_space_starts_idx
  on public.travel_events(travel_space_id, starts_at);

alter table public.assistant_actions
  drop constraint if exists assistant_actions_action_type_check;
alter table public.assistant_actions
  add constraint assistant_actions_action_type_check
  check (action_type in (
    'create_event',
    'create_chore',
    'create_note',
    'add_grocery_items',
    'create_meal_plan'
  ));

alter publication supabase_realtime add table public.member_locations;
alter publication supabase_realtime add table public.place_activity;
alter publication supabase_realtime add table public.grocery_items;
alter publication supabase_realtime add table public.meal_plans;
alter publication supabase_realtime add table public.event_follow_ups;
alter publication supabase_realtime add table public.inbound_items;
alter publication supabase_realtime add table public.travel_events;

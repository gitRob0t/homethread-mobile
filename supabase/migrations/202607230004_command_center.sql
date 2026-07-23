-- Coho command-center foundations: richer profiles, chore rewards,
-- consent-first location, household inboxes, and shareable invitations.

alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists bio text;

alter table public.chores
  add column if not exists reward_type text not null default 'points'
    check (reward_type in ('points', 'game_time', 'vbucks', 'allowance', 'custom')),
  add column if not exists reward_value numeric(10, 2) not null default 10 check (reward_value >= 0),
  add column if not exists reward_label text;

create table public.household_inboxes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households(id) on delete cascade,
  alias text not null unique check (alias ~ '^[a-z0-9][a-z0-9-]{2,48}$'),
  domain text not null default 'inbox.coho.ai',
  status text not null default 'reserved' check (status in ('reserved', 'active', 'paused')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.inbound_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  inbox_id uuid not null references public.household_inboxes(id) on delete cascade,
  source text not null default 'email' check (source in ('email', 'forward', 'upload', 'share')),
  sender text,
  subject text,
  body_preview text,
  received_at timestamptz not null default now(),
  extracted_data jsonb not null default '{}'::jsonb,
  status text not null default 'needs_review' check (status in ('needs_review', 'approved', 'rejected', 'imported', 'failed')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_event_id uuid references public.events(id) on delete set null
);

create table public.member_location_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  sharing_enabled boolean not null default false,
  precision text not null default 'approximate' check (precision in ('approximate', 'precise')),
  place_alerts_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, household_id)
);

create table public.family_places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null default 200 check (radius_meters between 50 and 5000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.household_inboxes enable row level security;
alter table public.inbound_items enable row level security;
alter table public.member_location_settings enable row level security;
alter table public.family_places enable row level security;

create policy "members read household inbox"
on public.household_inboxes for select using (public.is_household_member(household_id));
create policy "admins manage household inbox"
on public.household_inboxes for all using (public.is_household_admin(household_id))
with check (public.is_household_admin(household_id) and created_by = auth.uid());

create policy "members read inbound review queue"
on public.inbound_items for select using (public.is_household_member(household_id));
create policy "admins review inbound items"
on public.inbound_items for update using (public.is_household_admin(household_id))
with check (public.is_household_admin(household_id));

create policy "members read opted-in location settings"
on public.member_location_settings for select using (
  public.is_household_member(household_id) and (user_id = auth.uid() or sharing_enabled)
);
create policy "users manage own location consent"
on public.member_location_settings for all using (user_id = auth.uid())
with check (user_id = auth.uid() and public.is_household_member(household_id));

create policy "members read family places"
on public.family_places for select using (public.is_household_member(household_id));
create policy "admins manage family places"
on public.family_places for all using (public.is_household_admin(household_id))
with check (public.is_household_admin(household_id) and created_by = auth.uid());

create index inbound_items_household_received_idx on public.inbound_items(household_id, received_at desc);
create index family_places_household_idx on public.family_places(household_id);

create or replace function public.create_household_invitation(
  target_household uuid,
  target_email text,
  target_role public.household_role default 'member'
)
returns table(invitation_id uuid, invitation_token text)
language plpgsql security definer set search_path = public
as $$
declare
  raw_token text := encode(gen_random_bytes(24), 'hex');
  new_id uuid;
begin
  if not public.is_household_admin(target_household) then
    raise exception 'Only household administrators can invite members.';
  end if;
  if nullif(trim(target_email), '') is null then
    raise exception 'An email address is required.';
  end if;

  insert into public.invitations (household_id, email, role, token_hash, invited_by)
  values (
    target_household,
    lower(trim(target_email)),
    target_role,
    encode(digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  ) returning id into new_id;

  return query select new_id, raw_token;
end;
$$;

create or replace function public.accept_household_invitation(raw_token text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  invite public.invitations%rowtype;
begin
  select * into invite from public.invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and status = 'pending' and expires_at > now();
  if invite.id is null then raise exception 'Invitation is invalid or expired.'; end if;

  insert into public.household_members (household_id, user_id, role)
  values (invite.household_id, auth.uid(), invite.role)
  on conflict (household_id, user_id) do update set role = excluded.role;
  update public.invitations set status = 'accepted' where id = invite.id;
  return invite.household_id;
end;
$$;

revoke all on function public.create_household_invitation(uuid, text, public.household_role) from public;
revoke all on function public.accept_household_invitation(text) from public;
grant execute on function public.create_household_invitation(uuid, text, public.household_role) to authenticated;
grant execute on function public.accept_household_invitation(text) to authenticated;

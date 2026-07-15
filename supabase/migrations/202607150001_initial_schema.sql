-- HomeThread production foundation
create extension if not exists pgcrypto;

create type public.household_role as enum ('owner', 'admin', 'member', 'child');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.chore_status as enum ('open', 'completed', 'skipped');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.household_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role public.household_role not null default 'member',
  token_hash text not null unique,
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  details text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  created_by uuid not null references public.profiles(id),
  provider text,
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (household_id, provider, provider_event_id)
);

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  details text,
  assigned_to uuid references public.profiles(id),
  due_at timestamptz,
  recurrence_rule text,
  status public.chore_status not null default 'open',
  completed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '',
  pinned boolean not null default false,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  daily_recap boolean not null default true,
  event_reminders boolean not null default true,
  chore_reminders boolean not null default true,
  messages boolean not null default true,
  recap_time time not null default '07:00',
  timezone text not null default 'America/New_York',
  updated_at timestamptz not null default now()
);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.household_members
  where household_id = target_household and user_id = auth.uid()
); $$;

create or replace function public.is_household_admin(target_household uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.household_members
  where household_id = target_household
    and user_id = auth.uid()
    and role in ('owner', 'admin')
); $$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;
alter table public.events enable row level security;
alter table public.chores enable row level security;
alter table public.notes enable row level security;
alter table public.messages enable row level security;
alter table public.notification_preferences enable row level security;

create policy "users read own profile" on public.profiles for select using (id = auth.uid());
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "members read household profiles" on public.profiles for select using (
  exists (
    select 1 from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

create policy "members read households" on public.households for select using (public.is_household_member(id));
create policy "authenticated create households" on public.households for insert to authenticated with check (created_by = auth.uid());
create policy "admins update households" on public.households for update using (public.is_household_admin(id));

create policy "members read memberships" on public.household_members for select using (public.is_household_member(household_id));
create policy "admins manage memberships" on public.household_members for all using (public.is_household_admin(household_id)) with check (public.is_household_admin(household_id));

create policy "admins read invitations" on public.invitations for select using (public.is_household_admin(household_id));
create policy "admins create invitations" on public.invitations for insert with check (public.is_household_admin(household_id) and invited_by = auth.uid());
create policy "admins update invitations" on public.invitations for update using (public.is_household_admin(household_id));

create policy "members manage events" on public.events for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "members manage chores" on public.chores for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "members manage notes" on public.notes for all using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "members read messages" on public.messages for select using (public.is_household_member(household_id));
create policy "members send messages" on public.messages for insert with check (public.is_household_member(household_id) and sender_id = auth.uid());
create policy "senders edit messages" on public.messages for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy "users manage preferences" on public.notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index events_household_starts_idx on public.events(household_id, starts_at);
create index chores_household_due_idx on public.chores(household_id, due_at);
create index notes_household_updated_idx on public.notes(household_id, updated_at desc);
create index messages_household_created_idx on public.messages(household_id, created_at desc);

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.chores;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.messages;

-- Universal email-source setup for the Family Inbox.
--
-- This table intentionally stores no mailbox passwords or OAuth tokens. It lets a
-- household register the addresses that will forward relevant mail into its Coho
-- inbox. Direct provider OAuth/IMAP connections can build on the same source record
-- later without weakening the forwarding path that works with every mail host.

create table if not exists public.household_email_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email_address text not null,
  provider text not null default 'custom'
    check (provider in ('google', 'microsoft', 'icloud', 'yahoo', 'custom')),
  connection_method text not null default 'forwarding'
    check (connection_method in ('forwarding', 'oauth', 'imap')),
  status text not null default 'setup_required'
    check (status in ('setup_required', 'active', 'paused', 'needs_attention')),
  created_by uuid references public.profiles(id) on delete set null,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, email_address),
  check (
    email_address = lower(trim(email_address))
    and email_address ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  )
);

create index if not exists household_email_sources_household_status_idx
  on public.household_email_sources (household_id, status, updated_at desc);

alter table public.household_email_sources enable row level security;

drop policy if exists "members read household email sources"
  on public.household_email_sources;
create policy "members read household email sources"
  on public.household_email_sources for select
  using (public.is_household_member(household_id));

drop policy if exists "admins manage household email sources"
  on public.household_email_sources;
create policy "admins manage household email sources"
  on public.household_email_sources for all
  using (public.is_household_admin(household_id))
  with check (
    public.is_household_admin(household_id)
    and (created_by is null or created_by = auth.uid())
  );

-- Once a forwarded message arrives from a registered address, mark that source as
-- verified by real traffic. This preserves the product distinction between
-- "instructions created" and an actually working email source.
create or replace function public.activate_household_email_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_sender text := lower(trim(coalesce(new.sender, '')));
begin
  if normalized_sender <> '' then
    update public.household_email_sources
      set status = 'active',
          last_received_at = coalesce(new.received_at, now()),
          updated_at = now()
    where household_id = new.household_id
      and email_address = normalized_sender
      and connection_method = 'forwarding';
  end if;
  return new;
end;
$$;

drop trigger if exists activate_household_email_source_after_inbound
  on public.inbound_items;
create trigger activate_household_email_source_after_inbound
  after insert on public.inbound_items
  for each row execute function public.activate_household_email_source();

revoke all on function public.activate_household_email_source() from public;
revoke all on function public.activate_household_email_source() from anon;
revoke all on function public.activate_household_email_source() from authenticated;

-- Release corrections for event deduplication and Family Inbox privacy.
--
-- Local and Coh-created events do not have a provider event identifier. They
-- must not collide with one another. Imported events retain provider-level
-- deduplication once a provider_event_id exists.

alter table public.events
  drop constraint if exists events_household_id_provider_provider_event_id_key;

-- Be defensive if an older environment generated a non-default name for the
-- original UNIQUE NULLS NOT DISTINCT constraint.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.events'::regclass
      and constraint_row.contype = 'u'
      and regexp_replace(
        pg_get_constraintdef(constraint_row.oid),
        '[[:space:]]+',
        '',
        'g'
      ) = 'UNIQUENULLSNOTDISTINCT(household_id,provider,provider_event_id)'
  loop
    execute format(
      'alter table public.events drop constraint %I',
      legacy_constraint.conname
    );
  end loop;
end;
$$;

drop index if exists public.events_provider_event_dedupe_idx;
create unique index events_provider_event_dedupe_idx
  on public.events (household_id, provider, provider_event_id)
  where provider_event_id is not null;

-- A forwarded message's sender is normally the original sender, not the
-- forwarding mailbox. Matching sender to a registered household address is
-- therefore unreliable and can also be spoofed. Source verification must be
-- completed by a trusted provider callback or an explicit server-side flow.
drop trigger if exists activate_household_email_source_after_inbound
  on public.inbound_items;
drop function if exists public.activate_household_email_source();

-- Raw email bodies and attachment metadata may contain sensitive adult,
-- medical, school, or financial information. Household members can continue
-- to consume approved actions and calendar events, but only adult household
-- administrators may read the raw review queue.
drop policy if exists "members read inbound review queue"
  on public.inbound_items;
drop policy if exists "adult admins read inbound review queue"
  on public.inbound_items;
create policy "adult admins read inbound review queue"
  on public.inbound_items
  for select
  to authenticated
  using (public.is_household_admin(household_id));

drop policy if exists "members read inbound attachments"
  on public.inbound_attachments;
drop policy if exists "adult admins read inbound attachments"
  on public.inbound_attachments;
create policy "adult admins read inbound attachments"
  on public.inbound_attachments
  for select
  to authenticated
  using (public.is_household_admin(household_id));

-- Match storage access to the attachment metadata policy so a non-admin cannot
-- bypass table RLS by requesting a known object path directly.
drop policy if exists "household members read reviewed inbox attachments"
  on storage.objects;
drop policy if exists "household admins read reviewed inbox attachments"
  on storage.objects;
create policy "household admins read reviewed inbox attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'family-inbox'
    and public.is_household_admin(((storage.foldername(name))[1])::uuid)
  );

-- No authenticated insert policy is added for inbound_items or
-- inbound_attachments. Trusted ingestion continues through the service role,
-- which bypasses RLS; deliberate household uploads retain their existing
-- private-storage insert policy.

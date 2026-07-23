-- Production chore scheduling: reminders, durable recurrence, and deduplicated
-- follow-on occurrences. Direct chores now receive the same notification
-- behavior as Coh-created household actions.

alter table public.chores
  add column if not exists reminder_minutes integer
    check (reminder_minutes is null or reminder_minutes between 0 and 525600),
  add column if not exists series_id uuid,
  add column if not exists next_occurrence_id uuid
    references public.chores(id) on delete set null,
  add column if not exists occurrence_number integer not null default 1
    check (occurrence_number > 0);

update public.chores
set series_id = id
where series_id is null;

create unique index if not exists chores_series_due_unique_idx
  on public.chores(series_id, due_at)
  where series_id is not null and due_at is not null and recurrence_rule is not null;

create or replace function public.ensure_chore_series()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.series_id is null then
    new.series_id := new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_chore_series on public.chores;
create trigger ensure_chore_series
  before insert on public.chores
  for each row execute function public.ensure_chore_series();

create or replace function public.queue_chore_due_reminder()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  recipient uuid;
begin
  update public.notification_outbox
  set status = 'canceled'
  where dedupe_key like 'chore:' || new.id::text || ':reminder:%'
    and status in ('queued', 'failed');

  recipient := coalesce(new.assigned_to, new.created_by);
  if new.status = 'open'
    and recipient is not null
    and new.due_at is not null
    and new.reminder_minutes is not null
    and new.due_at >= now() - interval '1 day' then
    insert into public.notification_outbox (
      household_id,
      recipient_user_id,
      category,
      title,
      body,
      deep_link,
      payload,
      scheduled_for,
      expires_at,
      dedupe_key
    ) values (
      new.household_id,
      recipient,
      'reminder',
      new.title,
      'This family chore is due soon.',
      'coho://chore/' || new.id::text,
      jsonb_build_object(
        'screen', 'Chores',
        'choreId', new.id,
        'kind', 'chore',
        'deepLink', 'coho://chore/' || new.id::text
      ),
      greatest(now(), new.due_at - make_interval(mins => new.reminder_minutes)),
      new.due_at + interval '1 day',
      'chore:' || new.id::text || ':reminder:' || recipient::text || ':' ||
        extract(epoch from new.due_at)::bigint::text || ':' || new.reminder_minutes::text
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists queue_chore_due_reminder on public.chores;
create trigger queue_chore_due_reminder
  after insert or update of title, due_at, reminder_minutes, assigned_to, status on public.chores
  for each row execute function public.queue_chore_due_reminder();

create or replace function public.create_next_recurring_chore()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  next_due timestamptz;
  base_due timestamptz;
  created_occurrence uuid;
begin
  if old.status = 'completed'
    or new.status <> 'completed'
    or new.recurrence_rule is null
    or new.due_at is null
    or new.next_occurrence_id is not null then
    return new;
  end if;

  base_due := greatest(new.due_at, now());
  case new.recurrence_rule
    when 'FREQ=DAILY' then next_due := base_due + interval '1 day';
    when 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' then
      next_due := base_due + interval '1 day';
      while extract(isodow from next_due) in (6, 7) loop
        next_due := next_due + interval '1 day';
      end loop;
    when 'FREQ=WEEKLY' then next_due := base_due + interval '7 days';
    when 'FREQ=WEEKLY;INTERVAL=2' then next_due := base_due + interval '14 days';
    when 'FREQ=MONTHLY' then next_due := base_due + interval '1 month';
    else
      return new;
  end case;

  insert into public.chores (
    household_id,
    title,
    details,
    assigned_to,
    assigned_person_id,
    due_at,
    recurrence_rule,
    reminder_minutes,
    status,
    created_by,
    reward_type,
    reward_value,
    reward_label,
    requires_verification,
    series_id,
    occurrence_number
  ) values (
    new.household_id,
    new.title,
    new.details,
    new.assigned_to,
    new.assigned_person_id,
    next_due,
    new.recurrence_rule,
    new.reminder_minutes,
    'open',
    new.created_by,
    new.reward_type,
    new.reward_value,
    new.reward_label,
    new.requires_verification,
    coalesce(new.series_id, new.id),
    new.occurrence_number + 1
  )
  on conflict do nothing
  returning id into created_occurrence;

  if created_occurrence is null then
    select id into created_occurrence
    from public.chores
    where series_id = coalesce(new.series_id, new.id)
      and due_at = next_due
    limit 1;
  end if;

  if created_occurrence is not null then
    update public.chores
    set next_occurrence_id = created_occurrence,
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists create_next_recurring_chore on public.chores;
create trigger create_next_recurring_chore
  after update of status on public.chores
  for each row execute function public.create_next_recurring_chore();

revoke all on function public.ensure_chore_series() from public;
revoke all on function public.queue_chore_due_reminder() from public;
revoke all on function public.create_next_recurring_chore() from public;

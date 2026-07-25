-- Production family administration and per-member navigation preferences.

create table if not exists public.member_ui_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  more_menu_order text[] not null default '{}'::text[],
  more_menu_hidden text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.member_ui_preferences enable row level security;

drop policy if exists "users manage own ui preferences" on public.member_ui_preferences;
create policy "users manage own ui preferences"
on public.member_ui_preferences for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.remove_household_member(
  target_household uuid,
  target_user uuid
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  member_role public.household_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in before managing family members.';
  end if;
  if not public.is_household_admin(target_household) then
    raise exception 'Only a household administrator can remove family members.';
  end if;
  if target_user = auth.uid() then
    raise exception 'Use account settings to leave a household.';
  end if;

  select role into member_role
  from public.household_members
  where household_id = target_household
    and user_id = target_user
  for update;

  if member_role is null then
    raise exception 'That family member is no longer in this household.';
  end if;
  if member_role = 'owner' then
    raise exception 'Transfer household ownership before removing the owner.';
  end if;

  delete from public.member_location_settings
  where household_id = target_household and user_id = target_user;
  delete from public.member_locations
  where household_id = target_household and user_id = target_user;
  delete from public.device_push_tokens
  where household_id = target_household and user_id = target_user;
  delete from public.member_onboarding_state
  where household_id = target_household and user_id = target_user;
  delete from public.household_members
  where household_id = target_household and user_id = target_user;
  delete from public.household_people
  where household_id = target_household and linked_user_id = target_user;

  insert into public.app_events (
    household_id,
    user_id,
    event_name,
    properties
  ) values (
    target_household,
    auth.uid(),
    'household_member_removed',
    jsonb_build_object('removed_user_id', target_user)
  );

  return 'member_removed';
end;
$$;

create or replace function public.delete_household_person(target_person uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  person public.household_people%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before managing family profiles.';
  end if;

  select * into person
  from public.household_people
  where id = target_person
  for update;

  if person.id is null then
    raise exception 'That family profile no longer exists.';
  end if;
  if not public.is_household_admin(person.household_id) then
    raise exception 'Only a household administrator can delete family profiles.';
  end if;
  if person.linked_user_id is not null then
    raise exception 'Remove this signed-in family member from the household instead.';
  end if;

  delete from public.household_people where id = target_person;

  insert into public.app_events (
    household_id,
    user_id,
    event_name,
    properties
  ) values (
    person.household_id,
    auth.uid(),
    'household_profile_deleted',
    jsonb_build_object('person_id', target_person, 'display_name', person.display_name)
  );

  return 'profile_deleted';
end;
$$;

create or replace function public.revoke_household_invitation(target_invitation uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  invite public.invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before managing invitations.';
  end if;

  select * into invite
  from public.invitations
  where id = target_invitation
  for update;

  if invite.id is null then
    raise exception 'That invitation no longer exists.';
  end if;
  if not public.is_household_admin(invite.household_id) then
    raise exception 'Only a household administrator can cancel invitations.';
  end if;

  update public.invitations
  set status = 'revoked'
  where id = target_invitation and status = 'pending';

  return 'invitation_revoked';
end;
$$;

revoke all on function public.remove_household_member(uuid, uuid) from public;
revoke all on function public.delete_household_person(uuid) from public;
revoke all on function public.revoke_household_invitation(uuid) from public;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.delete_household_person(uuid) to authenticated;
grant execute on function public.revoke_household_invitation(uuid) to authenticated;

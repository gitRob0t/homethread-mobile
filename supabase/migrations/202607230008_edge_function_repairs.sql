-- Repair invitation token functions on hosted Supabase projects where pgcrypto
-- is installed in the `extensions` schema. Security-definer functions must
-- resolve those functions explicitly instead of assuming they live in public.

create or replace function public.create_household_invitation(
  target_household uuid,
  target_email text,
  target_role public.household_role default 'member'
)
returns table(invitation_id uuid, invitation_token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(24), 'hex');
  new_id uuid;
  normalized_email text := lower(trim(target_email));
begin
  if auth.uid() is null then
    raise exception 'Sign in before inviting a family member.';
  end if;
  if not public.is_household_admin(target_household) then
    raise exception 'Only household administrators can invite members.';
  end if;
  if normalized_email is null
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'A valid email address is required.';
  end if;

  update public.invitations
  set status = 'revoked'
  where household_id = target_household
    and lower(email) = normalized_email
    and status = 'pending';

  insert into public.invitations (
    household_id,
    email,
    role,
    token_hash,
    invited_by
  ) values (
    target_household,
    normalized_email,
    target_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  ) returning id into new_id;

  return query select new_id, raw_token;
end;
$$;

create or replace function public.accept_household_invitation(raw_token text)
returns uuid
language plpgsql security definer set search_path = public, extensions
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
  where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
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

create or replace function public.create_travel_space_invitation(
  target_space uuid,
  target_email text,
  target_role text default 'guest'
)
returns table(invitation_id uuid, invitation_token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(24), 'hex');
  new_id uuid;
  normalized_email text := lower(trim(target_email));
begin
  if auth.uid() is null then
    raise exception 'Sign in before inviting a trip guest.';
  end if;
  if not exists (
    select 1 from public.travel_space_members
    where travel_space_id = target_space
      and user_id = auth.uid()
      and role in ('host', 'planner')
  ) then
    raise exception 'Only trip hosts and planners can invite guests.';
  end if;
  if normalized_email is null
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'A valid email address is required.';
  end if;
  if target_role not in ('planner', 'guest') then
    raise exception 'Invalid trip role.';
  end if;

  update public.travel_space_invitations
  set status = 'revoked'
  where travel_space_id = target_space
    and lower(email) = normalized_email
    and status = 'pending';

  insert into public.travel_space_invitations (
    travel_space_id,
    email,
    role,
    token_hash,
    invited_by
  ) values (
    target_space,
    normalized_email,
    target_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid()
  ) returning id into new_id;

  return query select new_id, raw_token;
end;
$$;

create or replace function public.accept_travel_space_invitation(raw_token text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  invite public.travel_space_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before accepting this trip invitation.';
  end if;

  select * into invite
  from public.travel_space_invitations
  where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
  for update;

  if invite.id is null or invite.status <> 'pending' or invite.expires_at <= now() then
    raise exception 'Trip invitation is invalid, expired, or has already been used.';
  end if;
  if lower(invite.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Sign in with the email address that received this trip invitation.';
  end if;

  insert into public.travel_space_members (travel_space_id, user_id, role)
  values (invite.travel_space_id, auth.uid(), invite.role)
  on conflict (travel_space_id, user_id) do update set role = excluded.role;

  update public.travel_space_invitations
  set status = 'accepted'
  where id = invite.id;

  return invite.travel_space_id;
end;
$$;

revoke all on function public.create_household_invitation(uuid, text, public.household_role) from public;
revoke all on function public.accept_household_invitation(text) from public;
revoke all on function public.create_travel_space_invitation(uuid, text, text) from public;
revoke all on function public.accept_travel_space_invitation(text) from public;

grant execute on function public.create_household_invitation(uuid, text, public.household_role) to authenticated;
grant execute on function public.accept_household_invitation(text) to authenticated;
grant execute on function public.create_travel_space_invitation(uuid, text, text) to authenticated;
grant execute on function public.accept_travel_space_invitation(text) to authenticated;

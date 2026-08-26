-- SECURITY DEFINER functions run with their owner's privileges, so they must
-- never inherit Supabase's broad anonymous function-execution default.
-- Authenticated and service-role grants are intentionally left unchanged;
-- those roles are used by the mobile app, RLS helpers, and Edge Functions.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

do $$
declare
  function_signature text;
begin
  for function_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      routine.proname,
      pg_get_function_identity_arguments(routine.oid)
    )
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prosecdef
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      function_signature
    );
  end loop;
end;
$$;

-- This pure transition helper does not need schema lookup. Pinning its search
-- path removes the remaining mutable-search-path advisor finding.
alter function public.action_transition_allowed(text, text)
  set search_path = pg_catalog;

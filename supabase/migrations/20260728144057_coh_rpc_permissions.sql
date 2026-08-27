-- Coh mutation RPCs are callable only by signed-in users (and the service role).
-- Supabase's Data API may add explicit anon EXECUTE grants even when PUBLIC
-- has been revoked, so revoke both roles after every CREATE OR REPLACE.

revoke all on function public.claim_assistant_request(uuid, uuid, uuid, text, text)
  from public, anon;
revoke all on function public.complete_assistant_request(uuid, uuid, jsonb)
  from public, anon;
revoke all on function public.fail_assistant_request(uuid, uuid, jsonb, text, boolean)
  from public, anon;
revoke all on function public.propose_coh_action(
  uuid, uuid, uuid, integer, text, text, text, text[], jsonb, uuid,
  timestamptz, timestamptz, timestamptz, text, text, integer, timestamptz
) from public, anon;
revoke all on function public.confirm_coh_action(uuid, uuid, uuid, uuid, integer, text)
  from public, anon;
revoke all on function public.cancel_coh_action(uuid, uuid, uuid, uuid, integer, text)
  from public, anon;

grant execute on function public.claim_assistant_request(uuid, uuid, uuid, text, text)
  to authenticated, service_role;
grant execute on function public.complete_assistant_request(uuid, uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.fail_assistant_request(uuid, uuid, jsonb, text, boolean)
  to authenticated, service_role;
grant execute on function public.propose_coh_action(
  uuid, uuid, uuid, integer, text, text, text, text[], jsonb, uuid,
  timestamptz, timestamptz, timestamptz, text, text, integer, timestamptz
) to authenticated, service_role;
grant execute on function public.confirm_coh_action(uuid, uuid, uuid, uuid, integer, text)
  to authenticated, service_role;
grant execute on function public.cancel_coh_action(uuid, uuid, uuid, uuid, integer, text)
  to authenticated, service_role;

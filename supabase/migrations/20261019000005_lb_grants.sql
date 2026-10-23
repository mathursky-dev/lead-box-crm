-- Functions get EXECUTE for PUBLIC by default; close that and re-grant
-- user-facing RPCs to authenticated only.
alter function lb__closed(text) set search_path = public;
alter function lb__status_rank(text) set search_path = public;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'lb\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('lb_apply_status','lb_claim_outbox','lb_mark_send_result','lb_ingest_inbound',
        'lb_run_reminders','lb_rate_limit','lb__assign','lb__auto_allocate','lb__set_status','lb__notify',
        'lb__refresh_next_followup','lb_audit','lb__seed_company') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

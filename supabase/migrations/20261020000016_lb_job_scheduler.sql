-- Durable scheduler: every minute the database calls the app's job endpoint
-- (outbox drain, webhook replay). The token is generated here and never leaves
-- the database except in this call; the endpoint checks it via the service role.
create extension if not exists pg_net;

insert into lb_settings (key, value) values ('jobs_token', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;
insert into lb_settings (key, value) values ('app_url', 'https://crm.leadboxs.in')
on conflict (key) do update set value = excluded.value;

create or replace function lb__call_jobs() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text := (select value from lb_settings where key = 'app_url');
        v_tok text := (select value from lb_settings where key = 'jobs_token');
begin
  if v_url is null or v_tok is null then return; end if;
  -- Only call when there is work: queued sends, unprocessed webhooks or media to fetch.
  if exists (select 1 from lb_messages where status = 'queued' and next_attempt_at <= now())
     or exists (select 1 from lb_messages where status = 'sending' and locked_at < now() - interval '5 minutes')
     or exists (select 1 from lb_webhook_events where processed_at is null and attempts < 10 and received_at < now() - interval '1 minute')
     or exists (select 1 from lb_messages where direction = 'in' and media_status = 'failed' and created_at > now() - interval '2 days') then
    perform net.http_post(url := v_url || '/api/jobs/run', headers := jsonb_build_object('Authorization', 'Bearer ' || v_tok, 'Content-Type', 'application/json'),
                          body := '{}'::jsonb, timeout_milliseconds := 55000);
  end if;
end $$;
revoke execute on function lb__call_jobs() from public, anon, authenticated;

select cron.schedule('lb-call-jobs', '* * * * *', 'select public.lb__call_jobs()');

-- Nightly WhatsApp summary to the company owner.
--
-- Every night (default 9 PM IST) each company's admins (or the people the admin picks)
-- get today's numbers: new leads (top sources), won leads + sales value, lost, payments
-- received, open tasks and follow-ups due / overdue, unread chats.
-- It is sent as an in-app notification (+ phone push) and as WhatsApp through the
-- staff alert queue (lb_alert_queue, kind 'owner_summary'), which the app's job
-- runner already sends.
--
--   lb_owner_summary_settings  per company: on/off, hour, recipients, number, template
--   lb__owner_summary(company, day)   the numbers + ready text (service role only)
--   lb_owner_summary_preview()        today's summary for the signed-in admin's company
--   lb_run_owner_summaries()          pg_cron 'lb-owner-summary' every 10 minutes
--
-- Needs 20261102000050_lb_followup_alerts_leaderboard.sql (lb_alert_queue) and
-- 20261102000053_lb_quotes_payments.sql (lb_payment_links).
-- Idempotent: safe to run more than once.

create table if not exists public.lb_owner_summary_settings (
  company_id uuid primary key default public.lb_my_company() references public.lb_companies(id) on delete cascade,
  enabled boolean not null default true,
  send_hour smallint not null default 21 check (send_hour between 0 and 23),
  -- Empty = every active company admin.
  recipients uuid[] not null default '{}',
  -- Null = the number set in Follow-up alerts, else the company's first connected number.
  wa_number_id uuid references public.lb_wa_numbers(id) on delete set null,
  -- Approved Utility template for Cloud API numbers. Body: {{1}} = name, {{2}} = summary (one line).
  wa_template text check (wa_template is null or wa_template ~ '^[a-z0-9_]{1,120}$'),
  wa_template_lang text not null default 'en',
  last_sent_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);
alter table public.lb_owner_summary_settings enable row level security;
revoke all on public.lb_owner_summary_settings from anon;
grant select, insert, update on public.lb_owner_summary_settings to authenticated;
drop policy if exists lb_owner_summary_read on public.lb_owner_summary_settings;
drop policy if exists lb_owner_summary_insert on public.lb_owner_summary_settings;
drop policy if exists lb_owner_summary_update on public.lb_owner_summary_settings;
drop policy if exists lb_paid on public.lb_owner_summary_settings;
create policy lb_owner_summary_read on public.lb_owner_summary_settings for select to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_owner_summary_insert on public.lb_owner_summary_settings for insert to authenticated
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_owner_summary_update on public.lb_owner_summary_settings for update to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id))
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_paid on public.lb_owner_summary_settings as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Indian digit grouping: 1234567 -> 12,34,567
create or replace function public.lb__inr_in(p numeric) returns text
language sql immutable set search_path = public as $$
  select '₹' || to_char(round(coalesce(p, 0)), 'FM99,99,99,99,99,990')
$$;

create or replace function public.lb__owner_summary(p_company uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := (p_day::timestamp at time zone 'Asia/Kolkata');
  v_end timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Kolkata');
  v_new int; v_sources text; v_won int; v_won_value numeric; v_lost int;
  v_paid numeric; v_paid_n int; v_tasks int; v_tasks_over int; v_fu int; v_fu_over int; v_unread int;
  v_name text; v_text text; v_line text;
begin
  select name into v_name from lb_companies where id = p_company;

  select count(*) into v_new from lb_leads
  where company_id = p_company and deleted_at is null and created_at >= v_start and created_at < v_end;

  select string_agg(n || ' ' || c, ', ' order by c desc, n) into v_sources from (
    select coalesce(s.name, 'Other') n, count(*) c
    from lb_leads l left join lb_sources s on s.id = l.source_id
    where l.company_id = p_company and l.deleted_at is null and l.created_at >= v_start and l.created_at < v_end
    group by 1 order by 2 desc, 1 limit 3) x;

  select count(*) filter (where status_category = 'won'),
         coalesce(sum(coalesce(won_value, expected_value, 0)) filter (where status_category = 'won'), 0),
         count(*) filter (where status_category = 'lost')
    into v_won, v_won_value, v_lost
  from lb_leads
  where company_id = p_company and deleted_at is null and closed_at >= v_start and closed_at < v_end;

  select coalesce(sum(amount_paid), 0), count(*) into v_paid, v_paid_n from lb_payment_links
  where company_id = p_company and amount_paid > 0 and paid_at >= v_start and paid_at < v_end;

  select count(*), count(*) filter (where due_at < v_start) into v_tasks, v_tasks_over from lb_tasks
  where company_id = p_company and status not in ('completed','cancelled') and (due_at is null or due_at < v_end);

  select count(*), count(*) filter (where f.due_at < now()) into v_fu, v_fu_over
  from lb_followups f join lb_leads l on l.id = f.lead_id
  where f.company_id = p_company and f.status = 'pending' and f.due_at < v_end and l.deleted_at is null;

  select count(*) into v_unread from lb_conversations
  where company_id = p_company and coalesce(unread_count, 0) > 0;

  v_text := '📊 *' || coalesce(v_name, 'Your business') || '* · ' || to_char(p_day, 'Dy DD Mon') || E'\n'
    || '🆕 New leads: ' || v_new || coalesce(' (' || v_sources || ')', '') || E'\n'
    || '🏆 Won: ' || v_won || ' · Sales ' || lb__inr_in(v_won_value) || E'\n'
    || '💰 Payments received: ' || lb__inr_in(v_paid) || case when v_paid_n > 0 then ' (' || v_paid_n || ')' else '' end || E'\n'
    || '❌ Lost: ' || v_lost || E'\n'
    || '📋 Pending tasks: ' || v_tasks || case when v_tasks_over > 0 then ' (' || v_tasks_over || ' overdue)' else '' end || E'\n'
    || '📞 Follow-ups due: ' || v_fu || case when v_fu_over > 0 then ' (' || v_fu_over || ' missed)' else '' end || E'\n'
    || '💬 Unread chats: ' || v_unread;
  -- Template variables cannot have new lines.
  v_line := to_char(p_day, 'DD Mon') || ': new leads ' || v_new || ', won ' || v_won || ' (' || lb__inr_in(v_won_value) || ')'
    || ', payments ' || lb__inr_in(v_paid) || ', lost ' || v_lost || ', pending tasks ' || v_tasks
    || ', follow-ups due ' || v_fu || ', unread chats ' || v_unread;

  return jsonb_build_object(
    'day', p_day, 'company', v_name,
    'new_leads', v_new, 'top_sources', coalesce(v_sources, ''),
    'won', v_won, 'sales', v_won_value, 'lost', v_lost,
    'payments', v_paid, 'payments_count', v_paid_n,
    'pending_tasks', v_tasks, 'overdue_tasks', v_tasks_over,
    'followups_due', v_fu, 'followups_missed', v_fu_over, 'unread_chats', v_unread,
    'text', v_text, 'line', v_line);
end $$;
revoke all on function public.lb__owner_summary(uuid, date) from public, anon, authenticated;
grant execute on function public.lb__owner_summary(uuid, date) to service_role;

-- Today's summary for the signed-in admin's company (Daily summary page preview).
create or replace function public.lb_owner_summary_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := lb_my_company();
begin
  if v_co is null or not lb_is_admin_of(v_co) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return lb__owner_summary(v_co, (now() at time zone 'Asia/Kolkata')::date);
end $$;
revoke all on function public.lb_owner_summary_preview() from public, anon;
grant execute on function public.lb_owner_summary_preview() to authenticated, service_role;

-- Who gets it: the picked users, else every active company admin.
create or replace function public.lb__owner_summary_recipients(p_company uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from lb_profiles p
  left join lb_owner_summary_settings s on s.company_id = p_company
  where p.company_id = p_company and p.is_active and p.role <> 'super_admin'
    and (case when coalesce(cardinality(s.recipients), 0) > 0 then p.id = any(s.recipients) else p.role = 'company_admin' end)
$$;
revoke all on function public.lb__owner_summary_recipients(uuid) from public, anon, authenticated;

-- Queue one company's summary for one day (in-app + push via lb_notifications trigger,
-- WhatsApp via lb_alert_queue when a number is available). p_only = one user (test send).
create or replace function public.lb__queue_owner_summary(p_company uuid, p_day date, p_only uuid default null, p_key text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare d jsonb; u uuid; n int := 0; v_key text := coalesce(p_key, 'os:' || p_company || ':' || p_day); v_has_number boolean;
begin
  d := lb__owner_summary(p_company, p_day);
  select exists (select 1 from lb_wa_numbers w where w.company_id = p_company and w.is_active) into v_has_number;
  for u in
    select x from lb__owner_summary_recipients(p_company) x where p_only is null
    union select p_only where p_only is not null
  loop
    perform lb__notify(p_company, u, 'owner_summary', 'Daily summary · ' || to_char(p_day, 'DD Mon'),
      d->>'text', '/analytics', v_key || ':' || u);
    if v_has_number and exists (select 1 from lb_profiles where id = u and coalesce(trim(phone), '') <> '') then
      insert into lb_alert_queue (company_id, user_id, channel, kind, title, body, link, dedupe_key)
      values (p_company, u, 'whatsapp', 'owner_summary', 'Daily summary · ' || to_char(p_day, 'DD Mon'), d->>'text', '/analytics', 'wa:' || v_key || ':' || u)
      on conflict (dedupe_key) do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb__queue_owner_summary(uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function public.lb__queue_owner_summary(uuid, date, uuid, text) to service_role;

-- Every 10 minutes: companies whose send hour (IST) has come and that have not had today's summary.
create or replace function public.lb_run_owner_summaries() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  c record; n int := 0;
begin
  for c in
    select co.id from lb_companies co
    left join lb_owner_summary_settings s on s.company_id = co.id
    where coalesce(co.is_active, true) and not coalesce(co.is_demo, false)
      and coalesce(s.enabled, true)
      and extract(hour from v_now) >= coalesce(s.send_hour, 21)
      and (s.last_sent_on is null or s.last_sent_on < v_today)
      and lb_company_entitled(co.id)
    limit 200
  loop
    begin
      insert into lb_owner_summary_settings (company_id, last_sent_on) values (c.id, v_today)
      on conflict (company_id) do update set last_sent_on = excluded.last_sent_on;
      perform lb__queue_owner_summary(c.id, v_today);
      n := n + 1;
    exception when others then
      raise warning 'owner summary failed for %: %', c.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.lb_run_owner_summaries() from public, anon, authenticated;
grant execute on function public.lb_run_owner_summaries() to service_role;

select cron.unschedule('lb-owner-summary') where exists (select 1 from cron.job where jobname = 'lb-owner-summary');
select cron.schedule('lb-owner-summary', '*/10 * * * *', 'select public.lb_run_owner_summaries()');


-- ===================================================================== public API: gaps
-- Keys can expire; new scope leads.update (change status / owner / notes / follow-ups).
alter table public.lb_api_keys add column if not exists expires_at timestamptz;

-- PATCH /api/v1/leads/{id}. p: status (name), reason, won_value, owner_email (or null to unassign),
-- priority, expected_value, note, followup_at (+ followup_note). Returns the lead payload.
create or replace function public.lb_api_update_lead(p_key uuid, p_lead uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lb_api_keys; l lb_leads; v_status uuid; v_owner uuid; v_changes jsonb := '{}'; v_due timestamptz;
begin
  select * into k from lb_api_keys where id = p_key and revoked_at is null and (expires_at is null or expires_at > now());
  if k.id is null then raise exception 'API key revoked or expired'; end if;
  if not ('leads.update' = any(k.scopes)) then raise exception 'API key has no leads.update permission'; end if;
  select * into l from lb_leads where id = p_lead and company_id = k.company_id and deleted_at is null;
  if l.id is null then raise exception 'Lead not found' using errcode = 'P0002'; end if;

  if p ? 'priority' then
    if (p->>'priority') not in ('low','normal','high','urgent') then raise exception 'priority must be low, normal, high or urgent'; end if;
    update lb_leads set priority = p->>'priority', updated_at = now() where id = l.id;
    v_changes := v_changes || jsonb_build_object('priority', p->>'priority');
  end if;
  if p ? 'expected_value' then
    if jsonb_typeof(p->'expected_value') not in ('number','null') or (p->>'expected_value')::numeric < 0 then raise exception 'expected_value must be a number'; end if;
    update lb_leads set expected_value = (p->>'expected_value')::numeric, updated_at = now() where id = l.id;
    v_changes := v_changes || jsonb_build_object('expected_value', p->'expected_value');
  end if;
  if v_changes <> '{}' then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (l.company_id, l.id, l.owner_id, 'field_update', v_changes || jsonb_build_object('via', 'api', 'key', k.name));
  end if;

  if p ? 'owner_email' then
    if jsonb_typeof(p->'owner_email') = 'null' or trim(p->>'owner_email') = '' then v_owner := null;
    else
      select id into v_owner from lb_profiles
      where company_id = k.company_id and is_active and role <> 'super_admin' and lower(email) = lower(trim(p->>'owner_email'));
      if v_owner is null then raise exception 'owner_email: no active user with this email'; end if;
    end if;
    perform lb__assign(l.id, v_owner, null, 'Changed via API (' || k.name || ')');
  end if;

  if nullif(trim(p->>'status'), '') is not null then
    select id into v_status from lb_lead_statuses
    where company_id = k.company_id and is_active and lower(name) = lower(trim(p->>'status')) limit 1;
    if v_status is null then raise exception 'status: unknown status name (see GET /api/v1/meta)'; end if;
    if p ? 'won_value' and jsonb_typeof(p->'won_value') <> 'number' then raise exception 'won_value must be a number'; end if;
    perform lb__set_status(l.id, v_status, null, nullif(trim(p->>'reason'), ''), (p->>'won_value')::numeric, false);
  end if;

  if nullif(trim(p->>'note'), '') is not null then
    if length(p->>'note') > 5000 then raise exception 'note: 5000 characters at most'; end if;
    insert into lb_notes (company_id, customer_id, lead_id, author_id, body) values (l.company_id, l.customer_id, l.id, null, 'API (' || k.name || '): ' || (p->>'note'));
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (l.company_id, l.id, l.owner_id, 'note', jsonb_build_object('body', left('API (' || k.name || '): ' || (p->>'note'), 2000)));
    update lb_leads set last_activity_at = now() where id = l.id;
  end if;

  if nullif(trim(p->>'followup_at'), '') is not null then
    begin v_due := (p->>'followup_at')::timestamptz; exception when others then raise exception 'followup_at: use an ISO time like 2026-11-05T10:30:00+05:30'; end;
    if v_due < now() - interval '5 minutes' then raise exception 'followup_at must be in the future'; end if;
    select * into l from lb_leads where id = l.id;
    if l.owner_id is null then raise exception 'followup_at: assign the lead first (owner_email)'; end if;
    insert into lb_followups (company_id, lead_id, assigned_to, due_at, note)
    values (l.company_id, l.id, l.owner_id, v_due, left(nullif(trim(p->>'followup_note'), ''), 1000));
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (l.company_id, l.id, l.owner_id, 'followup_created', jsonb_build_object('due_at', v_due, 'note', p->>'followup_note', 'via', 'api'));
    perform lb__refresh_next_followup(l.id);
  end if;

  return lb__lead_payload(l.id);
end $$;
revoke all on function public.lb_api_update_lead(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_api_update_lead(uuid, uuid, jsonb) to service_role;

-- lb_api_ingest_lead: also refuse expired keys.
do $$ declare def text := pg_get_functiondef('public.lb_api_ingest_lead(uuid, jsonb)'::regprocedure);
  old text := 'where id = p_key and revoked_at is null;';
begin
  if position('expires_at' in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'patch target not found in lb_api_ingest_lead'; end if;
  execute replace(def, old, 'where id = p_key and revoked_at is null and (expires_at is null or expires_at > now());');
end $$;
revoke all on function public.lb_api_ingest_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_api_ingest_lead(uuid, jsonb) to service_role;

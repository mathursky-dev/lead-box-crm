-- Follow-up alerts + agent leaderboard & targets.
--
-- 1. Missed follow-up alerts: when a pending follow-up is still open N minutes
--    (default 30) after its due time, the assignee gets an in-app alert, a phone
--    push (if they turned on notifications) and optionally a WhatsApp message from
--    a company business number.
-- 2. Daily missed list: every day at the chosen IST hour, each admin and team
--    leader gets the count of missed follow-ups by agent (in-app + push + WhatsApp).
-- 3. Push: any lb_notifications row (except chat messages) is queued as a web push
--    for users who subscribed. The app's /api/jobs/run sends the queue.
-- 4. Monthly targets per user and lb_leaderboard(): leads, won, revenue,
--    conversion %, follow-ups done/missed and median first-reply time.
--
-- Everything is scoped to lb_my_company() (a Super Admin sees the switched company).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------- settings
create table if not exists public.lb_alert_settings (
  company_id uuid primary key default public.lb_my_company() references public.lb_companies(id) on delete cascade,
  missed_enabled boolean not null default true,
  missed_after_min integer not null default 30 check (missed_after_min between 0 and 1440),
  manager_list_enabled boolean not null default true,
  manager_list_hour smallint not null default 9 check (manager_list_hour between 0 and 23),
  push_enabled boolean not null default true,
  wa_enabled boolean not null default false,
  wa_number_id uuid references public.lb_wa_numbers(id) on delete set null,
  -- Approved template used outside the 24h window. Body variables: {{1}} = name, {{2}} = alert text.
  wa_template text,
  wa_template_lang text not null default 'en',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);
alter table public.lb_alert_settings enable row level security;
revoke all on public.lb_alert_settings from anon;
grant select, insert, update on public.lb_alert_settings to authenticated;
drop policy if exists lb_alert_settings_read on public.lb_alert_settings;
drop policy if exists lb_alert_settings_write on public.lb_alert_settings;
drop policy if exists lb_alert_settings_update on public.lb_alert_settings;
drop policy if exists lb_paid on public.lb_alert_settings;
create policy lb_alert_settings_read on public.lb_alert_settings for select to authenticated
  using (company_id = public.lb_my_company());
create policy lb_alert_settings_write on public.lb_alert_settings for insert to authenticated
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_alert_settings_update on public.lb_alert_settings for update to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id))
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_paid on public.lb_alert_settings as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- ---------------------------------------------------------------- push subscriptions (one per browser/phone)
create table if not exists public.lb_push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.lb_profiles(id) on delete cascade,
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  failures integer not null default 0,
  last_ok_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lb_push_subs_user on public.lb_push_subs (user_id);
alter table public.lb_push_subs enable row level security;
revoke all on public.lb_push_subs from anon;
grant select, insert, update, delete on public.lb_push_subs to authenticated;
drop policy if exists lb_push_subs_own on public.lb_push_subs;
create policy lb_push_subs_own on public.lb_push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- outgoing alert queue (push + WhatsApp)
create table if not exists public.lb_alert_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  channel text not null check (channel in ('push','whatsapp')),
  kind text not null default 'alert',
  title text not null,
  body text,
  link text,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0,
  error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists lb_alert_queue_due on public.lb_alert_queue (next_attempt_at) where status = 'queued';
create index if not exists lb_alert_queue_company on public.lb_alert_queue (company_id, created_at desc);
alter table public.lb_alert_queue enable row level security;
revoke all on public.lb_alert_queue from anon, authenticated;
grant select on public.lb_alert_queue to authenticated;
drop policy if exists lb_alert_queue_read on public.lb_alert_queue;
create policy lb_alert_queue_read on public.lb_alert_queue for select to authenticated
  using (company_id = public.lb_my_company() and (user_id = auth.uid() or public.lb_is_admin_of(company_id)));

-- Queue a WhatsApp alert for a user if the company turned WhatsApp alerts on and the user has a phone.
create or replace function public.lb__queue_wa_alert(p_company uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into lb_alert_queue (company_id, user_id, channel, kind, title, body, link, dedupe_key)
  select p_company, p_user, 'whatsapp', p_kind, p_title, p_body, p_link, p_key
  from lb_alert_settings s join lb_profiles u on u.id = p_user and u.is_active and coalesce(trim(u.phone), '') <> ''
  where s.company_id = p_company and s.wa_enabled and s.wa_number_id is not null
  on conflict (dedupe_key) do nothing
$$;

-- Every new notification (except chat messages) becomes a push for users with a subscription.
create or replace function public.lb__notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type in ('message') then return new; end if;
  if not exists (select 1 from lb_push_subs where user_id = new.user_id) then return new; end if;
  if not coalesce((select push_enabled from lb_alert_settings where company_id = new.company_id), true) then return new; end if;
  insert into lb_alert_queue (company_id, user_id, channel, kind, title, body, link, dedupe_key)
  values (new.company_id, new.user_id, 'push', new.type, new.title, new.body, new.link, 'push:' || new.id)
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
drop trigger if exists lb_notifications_push on public.lb_notifications;
create trigger lb_notifications_push after insert on public.lb_notifications
  for each row execute function public.lb__notification_push();

-- ---------------------------------------------------------------- missed follow-ups
alter table public.lb_followups add column if not exists missed_alerted_at timestamptz;
create index if not exists lb_followups_missed_scan on public.lb_followups (due_at)
  where status = 'pending' and missed_alerted_at is null;

-- Rescheduling a follow-up re-arms its missed alert.
create or replace function public.lb__followup_rearm() returns trigger
language plpgsql as $$
begin
  if new.due_at is distinct from old.due_at then new.missed_alerted_at := null; end if;
  return new;
end $$;
drop trigger if exists lb_followups_rearm on public.lb_followups;
create trigger lb_followups_rearm before update of due_at on public.lb_followups
  for each row execute function public.lb__followup_rearm();

create or replace function public.lb_run_followup_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record; co record; m record; n_missed int := 0; n_lists int := 0;
        v_title text; v_body text; v_day text; v_cut timestamptz; v_total int; v_lines text;
begin
  -- 1. Each follow-up still open X minutes after it was due → alert its assignee (once).
  --    Only follow-ups due in the last 24 hours, so old backlog never floods anyone.
  for f in
    select fu.id, fu.company_id, fu.assigned_to, fu.due_at, fu.note, fu.lead_id, l.lead_no,
           coalesce(cu.name, cu.wa_profile_name, cu.phone_e164) as cname
    from lb_followups fu
    join lb_leads l on l.id = fu.lead_id
    join lb_customers cu on cu.id = l.customer_id
    join lb_companies c on c.id = fu.company_id and c.is_active
    left join lb_alert_settings s on s.company_id = fu.company_id
    where fu.status = 'pending' and fu.missed_alerted_at is null and fu.assigned_to is not null
      and coalesce(s.missed_enabled, true)
      and fu.due_at < now() - make_interval(mins => coalesce(s.missed_after_min, 30))
      and fu.due_at > now() - interval '24 hours'
      and l.deleted_at is null and not lb__closed(l.status_category)
    order by fu.due_at
    limit 500
    for update of fu skip locked
  loop
    v_title := 'Missed follow-up: LB-' || f.lead_no || ' · ' || coalesce(f.cname, 'customer');
    v_body := 'Was due ' || to_char(f.due_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || coalesce(' · ' || nullif(trim(f.note), ''), '');
    perform lb__notify(f.company_id, f.assigned_to, 'followup_missed', v_title, v_body, '/leads/' || f.lead_id, 'fum:' || f.id);
    perform lb__queue_wa_alert(f.company_id, f.assigned_to, 'followup_missed', v_title, v_body, '/leads/' || f.lead_id, 'wa:fum:' || f.id);
    update lb_followups set missed_alerted_at = now() where id = f.id;
    n_missed := n_missed + 1;
  end loop;

  -- 2. Daily missed list to admins and team leaders at the chosen IST hour.
  v_day := to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD');
  v_cut := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; -- today 00:00 IST
  for co in
    select c.id from lb_companies c left join lb_alert_settings s on s.company_id = c.id
    where c.is_active and coalesce(s.manager_list_enabled, true)
      and extract(hour from now() at time zone 'Asia/Kolkata') = coalesce(s.manager_list_hour, 9)
  loop
    for m in
      select p.id, p.role from lb_profiles p
      where p.company_id = co.id and p.is_active and p.role in ('super_admin','company_admin','team_leader')
        and not exists (select 1 from lb_notifications x where x.dedupe_key = 'fml:' || p.id || ':' || v_day)
    loop
      with scope as (
        select u.id, u.full_name from lb_profiles u
        where u.company_id = co.id
          and (m.role <> 'team_leader' or u.id = m.id or u.team_id = any(lb_team_ids_for(m.id)))
      ), per as (
        select coalesce(sc.full_name, 'Unassigned') as name, count(*) as n
        from lb_followups fu
        join lb_leads l on l.id = fu.lead_id and l.deleted_at is null and not lb__closed(l.status_category)
        left join scope sc on sc.id = fu.assigned_to
        where fu.company_id = co.id and fu.status = 'pending' and fu.due_at < v_cut
          and (sc.id is not null or (fu.assigned_to is null and m.role <> 'team_leader'))
        group by 1
      )
      select coalesce(sum(n), 0)::int,
             string_agg(name || ' ' || n, ' · ' order by n desc, name)
      into v_total, v_lines from per;
      if v_total > 0 then
        v_title := 'Missed follow-ups: ' || v_total;
        v_body := v_lines;
        perform lb__notify(co.id, m.id, 'followup_missed_list', v_title, v_body, '/followups?tab=overdue&mine=0', 'fml:' || m.id || ':' || v_day);
        perform lb__queue_wa_alert(co.id, m.id, 'followup_missed_list', v_title, v_body, '/followups?tab=overdue&mine=0', 'wa:fml:' || m.id || ':' || v_day);
        n_lists := n_lists + 1;
      else
        -- Remember that today's list was checked, without notifying.
        insert into lb_notifications (company_id, user_id, type, title, body, link, dedupe_key, read_at)
        values (co.id, m.id, 'followup_missed_list', 'No missed follow-ups', 'Your team has no missed follow-ups. Great work!', '/followups', 'fml:' || m.id || ':' || v_day, now())
        on conflict (dedupe_key) do nothing;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('missed', n_missed, 'lists', n_lists);
end $$;

-- ---------------------------------------------------------------- queue claim (service role only)
create or replace function public.lb_claim_alerts(p_limit integer default 20) returns setof public.lb_alert_queue
language sql security definer set search_path = public as $$
  update lb_alert_queue q set status = 'sending', locked_at = now(), attempts = q.attempts + 1
  where q.id in (
    select id from lb_alert_queue
    where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and locked_at < now() - interval '5 minutes')
    order by created_at limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning q.*
$$;

-- The minute job caller also wakes the app when alerts are queued.
do $$ declare def text := pg_get_functiondef('lb__call_jobs()'::regprocedure);
  old text := 'or exists (select 1 from lb_messages where direction = ''in'' and media_status = ''failed''';
begin
  if position('lb_alert_queue' in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'patch target not found in lb__call_jobs'; end if;
  execute replace(def, old, 'or exists (select 1 from lb_alert_queue where status = ''queued'' and next_attempt_at <= now()) ' || old);
end $$;

-- ---------------------------------------------------------------- targets
create table if not exists public.lb_targets (
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  won_target integer check (won_target is null or won_target >= 0),
  value_target numeric(14,2) check (value_target is null or value_target >= 0),
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
create index if not exists lb_targets_company on public.lb_targets (company_id, month);
alter table public.lb_targets enable row level security;
revoke all on public.lb_targets from anon, authenticated;
grant select on public.lb_targets to authenticated;
drop policy if exists lb_targets_read on public.lb_targets;
drop policy if exists lb_paid on public.lb_targets;
create policy lb_targets_read on public.lb_targets for select to authenticated
  using (company_id = public.lb_my_company());
create policy lb_paid on public.lb_targets as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Save targets for one month: p_rows = [{user_id, won_target, value_target}]. Admins: anyone; team leaders: their team.
create or replace function public.lb_set_targets(p_month date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_co uuid := lb_my_company(); v_role text := lb_my_role(); r jsonb; v_user uuid; n int := 0;
        v_month date := date_trunc('month', p_month)::date; v_won int; v_val numeric;
begin
  if v_co is null or not lb_access_ok() then raise exception 'Not allowed'; end if;
  if not (lb_is_admin_of(v_co) or v_role = 'team_leader') then raise exception 'Only admins and team leaders can set targets'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_user := (r->>'user_id')::uuid;
    if not exists (select 1 from lb_profiles where id = v_user and company_id = v_co) then raise exception 'User not in this company'; end if;
    if not lb_is_admin_of(v_co) and not (v_user = any(lb_visible_user_ids())) then raise exception 'You can set targets only for your team'; end if;
    v_won := nullif(r->>'won_target', '')::int;
    v_val := nullif(r->>'value_target', '')::numeric;
    if v_won is null and v_val is null then
      delete from lb_targets where user_id = v_user and month = v_month;
    else
      insert into lb_targets (company_id, user_id, month, won_target, value_target, updated_by, updated_at)
      values (v_co, v_user, v_month, v_won, v_val, auth.uid(), now())
      on conflict (user_id, month) do update set won_target = excluded.won_target, value_target = excluded.value_target,
        updated_by = excluded.updated_by, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- leaderboard
create or replace function public.lb_leaderboard(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := lb_my_company();
        v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
        v_from timestamptz; v_to timestamptz; v_rows jsonb;
begin
  if v_co is null or not lb_access_ok() then raise exception 'Not allowed'; end if;
  v_from := v_month::timestamp at time zone 'Asia/Kolkata';
  v_to := (v_month + interval '1 month')::timestamp at time zone 'Asia/Kolkata';

  with users as (
    select p.id, p.full_name, p.role, t.name as team
    from lb_profiles p left join lb_teams t on t.id = p.team_id
    where p.company_id = v_co and p.is_active and p.role <> 'super_admin'
  ), assigned as (
    select owner_id as uid, count(*) as n from lb_leads
    where company_id = v_co and deleted_at is null and owner_id is not null
      and coalesce(assigned_at, created_at) >= v_from and coalesce(assigned_at, created_at) < v_to
    group by 1
  ), won as (
    select coalesce(converted_owner_id, owner_id) as uid, count(*) as n, coalesce(sum(won_value), 0) as v from lb_leads
    where company_id = v_co and deleted_at is null and status_category = 'won' and converted_at >= v_from and converted_at < v_to
    group by 1
  ), fu as (
    select assigned_to as uid,
           count(*) filter (where status = 'done') as done,
           count(*) filter (where status = 'done' and completed_at <= due_at + interval '1 hour') as on_time,
           count(*) filter (where status = 'pending' and due_at < now()) as missed
    from lb_followups where company_id = v_co and due_at >= v_from and due_at < v_to and assigned_to is not null
    group by 1
  ), msgs as (
    select m.conversation_id, m.direction, m.sent_by, m.created_at,
           count(*) filter (where m.direction = 'out' and m.sent_by is not null)
             over (partition by m.conversation_id order by m.created_at, m.id rows between unbounded preceding and 1 preceding) as run
    from lb_messages m
    where m.company_id = v_co and m.created_at >= v_from - interval '3 days' and m.created_at < v_to
  ), runs as (
    select conversation_id, run, min(created_at) filter (where direction = 'in') as first_in
    from msgs group by 1, 2
  ), replies as (
    select m.sent_by as uid, count(*) as n,
           percentile_cont(0.5) within group (order by extract(epoch from m.created_at - r.first_in) / 60.0) as med
    from msgs m join runs r on r.conversation_id = m.conversation_id and r.run = m.run
    where m.direction = 'out' and m.sent_by is not null and r.first_in is not null
      and m.created_at >= v_from and m.created_at < v_to
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'name', u.full_name, 'role', u.role, 'team', u.team,
      'assigned', coalesce(a.n, 0), 'won', coalesce(w.n, 0), 'won_value', coalesce(w.v, 0),
      'conversion', case when coalesce(a.n, 0) > 0 then round(100.0 * coalesce(w.n, 0) / a.n, 1) end,
      'fu_done', coalesce(f.done, 0), 'fu_on_time', coalesce(f.on_time, 0), 'fu_missed', coalesce(f.missed, 0),
      'replies', coalesce(r.n, 0), 'resp_median_min', round(r.med::numeric, 1),
      'won_target', tg.won_target, 'value_target', tg.value_target)
    order by coalesce(w.v, 0) desc, coalesce(w.n, 0) desc, u.full_name), '[]')
  into v_rows
  from users u
  left join assigned a on a.uid = u.id
  left join won w on w.uid = u.id
  left join fu f on f.uid = u.id
  left join replies r on r.uid = u.id
  left join lb_targets tg on tg.user_id = u.id and tg.month = v_month
  -- Admins only appear when they actually worked leads or have a target.
  where u.role in ('agent','team_leader') or a.n > 0 or w.n > 0 or r.n > 0 or tg.user_id is not null;

  return jsonb_build_object('month', v_month, 'rows', v_rows,
    'can_edit', lb_is_admin_of(v_co) or lb_my_role() = 'team_leader',
    'editable', case when lb_is_admin_of(v_co) then null else to_jsonb(lb_visible_user_ids()) end);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.lb__queue_wa_alert(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lb__notification_push() from public, anon, authenticated;
revoke all on function public.lb__followup_rearm() from public, anon, authenticated;
revoke all on function public.lb_run_followup_alerts() from public, anon, authenticated;
revoke all on function public.lb_claim_alerts(integer) from public, anon, authenticated;
revoke all on function public.lb_set_targets(date, jsonb) from public, anon;
revoke all on function public.lb_leaderboard(date) from public, anon;
grant execute on function public.lb_set_targets(date, jsonb) to authenticated;
grant execute on function public.lb_leaderboard(date) to authenticated;
grant execute on function public.lb_run_followup_alerts() to service_role;
grant execute on function public.lb_claim_alerts(integer) to service_role;
grant all on public.lb_alert_queue, public.lb_push_subs, public.lb_alert_settings, public.lb_targets to service_role;

-- Every minute: missed alerts + daily manager list (the job caller then sends the queue).
select cron.unschedule('lb-followup-alerts') where exists (select 1 from cron.job where jobname = 'lb-followup-alerts');
select cron.schedule('lb-followup-alerts', '* * * * *', 'select public.lb_run_followup_alerts()');

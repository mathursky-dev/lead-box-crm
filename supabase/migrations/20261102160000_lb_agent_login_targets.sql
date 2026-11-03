-- Agent daily login / logout time + monthly targets with progress.
--
-- 1. lb_user_days: one row per user per IST day: first sign-in / first seen, last seen,
--    last sign-out, sign-in count and active time. Filled by
--      - a trigger on lb_login_events (sign-in / sign-out, already logged by the app), and
--      - lb_presence_ping(), called by the open CRM tab every ~2 minutes while it is visible.
--    Active time = sum of gaps between pings that are 10 minutes or less.
-- 2. lb_targets gets calls / follow-ups / field-visit targets next to won leads and revenue.
--    lb_set_targets only changes the target columns sent, so the Leaderboard modal
--    (won + revenue only) keeps the new targets as they are.
-- 3. lb_team_login(from, to) and lb_agent_targets(month): reports for the caller's
--    visible users (admin: company, team leader: team, agent: self).
--
-- Needs: 20261102000050 (lb_targets), 20261102040000 (field force), 20261102080000 (lb_login_events),
--        20261102000046 (lb_calls). Idempotent: safe to run more than once.

-- ---------------------------------------------------------------- daily login
create table if not exists public.lb_user_days (
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  active_sec integer not null default 0 check (active_sec >= 0),
  login_at timestamptz,
  logins integer not null default 0,
  logout_at timestamptz,
  primary key (user_id, day)
);
create index if not exists lb_user_days_company on public.lb_user_days (company_id, day desc);
alter table public.lb_user_days enable row level security;
revoke all on public.lb_user_days from anon, authenticated;
grant select on public.lb_user_days to authenticated;
grant all on public.lb_user_days to service_role;
drop policy if exists lb_user_days_read on public.lb_user_days;
drop policy if exists lb_paid on public.lb_user_days;
create policy lb_user_days_read on public.lb_user_days for select to authenticated
  using (public.lb_can_see_user_row(company_id, user_id));
create policy lb_paid on public.lb_user_days as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- p_kind: 'ping' (CRM open), 'login', 'logout'.
create or replace function public.lb__presence(p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare v_co uuid; v_role text; v_now timestamptz := now();
        v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_user is null then return; end if;
  select company_id, role into v_co, v_role from lb_profiles where id = p_user and is_active;
  if v_co is null or v_role = 'super_admin' then return; end if;
  insert into lb_user_days as d (company_id, user_id, day, first_seen_at, last_seen_at, login_at, logins, logout_at)
  values (v_co, p_user, v_day, v_now, v_now,
          case when p_kind = 'login' then v_now end,
          case when p_kind = 'login' then 1 else 0 end,
          case when p_kind = 'logout' then v_now end)
  on conflict (user_id, day) do update set
    last_seen_at = greatest(d.last_seen_at, v_now),
    active_sec = d.active_sec + case
      when p_kind <> 'login' and d.logout_at is null and v_now > d.last_seen_at and v_now - d.last_seen_at <= interval '10 minutes'
      then extract(epoch from v_now - d.last_seen_at)::int else 0 end,
    login_at = coalesce(d.login_at, case when p_kind = 'login' then v_now end),
    logins = d.logins + case when p_kind = 'login' then 1 else 0 end,
    -- signing in again after a sign-out (or any activity after it) re-opens the day
    logout_at = case when p_kind = 'logout' then v_now when p_kind = 'login' then null
                     when v_now - coalesce(d.logout_at, v_now) > interval '1 minute' then null else d.logout_at end;
end $$;
revoke all on function public.lb__presence(uuid, text) from public, anon, authenticated;

-- Called by the open CRM tab. Cheap: at most one write per user per 45 seconds.
create or replace function public.lb_presence_ping() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if exists (select 1 from lb_user_days where user_id = v_uid and day = (now() at time zone 'Asia/Kolkata')::date
             and last_seen_at > now() - interval '45 seconds' and logout_at is null) then return; end if;
  perform lb__presence(v_uid, 'ping');
end $$;
revoke all on function public.lb_presence_ping() from public, anon;
grant execute on function public.lb_presence_ping() to authenticated;

-- Sign-in / sign-out from lb_login_events (written by the app on password login, OTP step and logout).
create or replace function public.lb__login_event_presence() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null or not new.success then return new; end if;
  if new.method = 'logout' then
    perform lb__presence(new.user_id, 'logout');
  elsif (new.method = 'password' and new.reason is null) or new.method = 'otp' then
    perform lb__presence(new.user_id, 'login');
  end if;
  return new;
exception when others then
  return new; -- never block sign-in
end $$;
revoke all on function public.lb__login_event_presence() from public, anon, authenticated;
drop trigger if exists lb_login_events_presence on public.lb_login_events;
create trigger lb_login_events_presence after insert on public.lb_login_events
  for each row execute function public.lb__login_event_presence();

-- Day-wise login report for the caller's visible users. Includes GPS attendance from the Field app.
create or replace function public.lb_team_login(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := lb_my_company(); v_ids uuid[] := coalesce(lb_visible_user_ids(), '{}');
        v_start timestamptz; v_end timestamptz; v_users jsonb; v_days jsonb;
begin
  if v_co is null or not lb_access_ok() then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid date range'; end if;
  if p_to - p_from > 92 then raise exception 'Choose a range of 92 days or less'; end if;
  v_start := p_from::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.full_name, 'role', p.role, 'team', t.name)
           order by p.full_name), '[]')
  into v_users
  from lb_profiles p left join lb_teams t on t.id = p.team_id
  where p.company_id = v_co and p.id = any(v_ids) and p.is_active and p.role <> 'super_admin';

  with att as (
    select a.user_id, (a.check_in_at at time zone 'Asia/Kolkata')::date as day,
           min(a.check_in_at) as gps_in, max(a.check_out_at) as gps_out,
           bool_or(a.check_out_at is null) as gps_open
    from lb_attendance a
    where a.company_id = v_co and a.user_id = any(v_ids) and a.check_in_at >= v_start and a.check_in_at < v_end
    group by 1, 2
  ), ud as (
    select * from lb_user_days d
    where d.company_id = v_co and d.user_id = any(v_ids) and d.day between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', coalesce(ud.user_id, att.user_id), 'day', coalesce(ud.day, att.day),
      'login_at', coalesce(ud.login_at, ud.first_seen_at), 'first_seen_at', ud.first_seen_at,
      'last_seen_at', ud.last_seen_at, 'logout_at', ud.logout_at, 'logins', coalesce(ud.logins, 0),
      'active_min', round(coalesce(ud.active_sec, 0) / 60.0),
      'gps_in', att.gps_in, 'gps_out', att.gps_out, 'gps_open', coalesce(att.gps_open, false))
    order by coalesce(ud.day, att.day) desc), '[]')
  into v_days
  from ud full join att on att.user_id = ud.user_id and att.day = ud.day;

  return jsonb_build_object('users', v_users, 'days', v_days, 'now', now());
end $$;
revoke all on function public.lb_team_login(date, date) from public, anon;
grant execute on function public.lb_team_login(date, date) to authenticated;

-- ---------------------------------------------------------------- targets
alter table public.lb_targets add column if not exists calls_target integer check (calls_target is null or calls_target >= 0);
alter table public.lb_targets add column if not exists followups_target integer check (followups_target is null or followups_target >= 0);
alter table public.lb_targets add column if not exists visits_target integer check (visits_target is null or visits_target >= 0);

-- p_rows = [{user_id, won_target?, value_target?, calls_target?, followups_target?, visits_target?}].
-- Only the keys sent are changed ("" = no target). A row with no target left is removed.
create or replace function public.lb_set_targets(p_month date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_co uuid := lb_my_company(); v_role text := lb_my_role(); r jsonb; v_user uuid; n int := 0;
        v_month date := date_trunc('month', p_month)::date;
begin
  if v_co is null or not lb_access_ok() then raise exception 'Not allowed'; end if;
  if not (lb_is_admin_of(v_co) or v_role = 'team_leader') then raise exception 'Only admins and team leaders can set targets'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_user := (r->>'user_id')::uuid;
    if not exists (select 1 from lb_profiles where id = v_user and company_id = v_co) then raise exception 'User not in this company'; end if;
    if not lb_is_admin_of(v_co) and not (v_user = any(lb_visible_user_ids())) then raise exception 'You can set targets only for your team'; end if;
    insert into lb_targets as t (company_id, user_id, month, won_target, value_target, calls_target, followups_target, visits_target, updated_by, updated_at)
    values (v_co, v_user, v_month,
      nullif(r->>'won_target', '')::int, nullif(r->>'value_target', '')::numeric,
      nullif(r->>'calls_target', '')::int, nullif(r->>'followups_target', '')::int, nullif(r->>'visits_target', '')::int,
      auth.uid(), now())
    on conflict (user_id, month) do update set
      won_target       = case when r ? 'won_target'       then excluded.won_target       else t.won_target end,
      value_target     = case when r ? 'value_target'     then excluded.value_target     else t.value_target end,
      calls_target     = case when r ? 'calls_target'     then excluded.calls_target     else t.calls_target end,
      followups_target = case when r ? 'followups_target' then excluded.followups_target else t.followups_target end,
      visits_target    = case when r ? 'visits_target'    then excluded.visits_target    else t.visits_target end,
      updated_by = excluded.updated_by, updated_at = now();
    delete from lb_targets where user_id = v_user and month = v_month
      and won_target is null and value_target is null and calls_target is null and followups_target is null and visits_target is null;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_set_targets(date, jsonb) from public, anon;
grant execute on function public.lb_set_targets(date, jsonb) to authenticated;

-- Monthly target progress for the caller's visible users.
create or replace function public.lb_agent_targets(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := lb_my_company(); v_ids uuid[] := coalesce(lb_visible_user_ids(), '{}');
        v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
        v_from timestamptz; v_to timestamptz; v_rows jsonb;
begin
  if v_co is null or not lb_access_ok() then raise exception 'Not allowed'; end if;
  v_from := v_month::timestamp at time zone 'Asia/Kolkata';
  v_to := (v_month + interval '1 month')::timestamp at time zone 'Asia/Kolkata';

  with users as (
    select p.id, p.full_name, p.role, t.name as team
    from lb_profiles p left join lb_teams t on t.id = p.team_id
    where p.company_id = v_co and p.id = any(v_ids) and p.is_active and p.role <> 'super_admin'
  ), won as (
    select coalesce(converted_owner_id, owner_id) as uid, count(*) as n, coalesce(sum(won_value), 0) as v from lb_leads
    where company_id = v_co and deleted_at is null and status_category = 'won' and converted_at >= v_from and converted_at < v_to
    group by 1
  ), calls as (
    select user_id as uid, count(*) filter (where direction = 'outgoing') as made,
           count(*) filter (where duration_sec > 0) as connected, coalesce(sum(duration_sec), 0) as talk_sec
    from lb_calls where company_id = v_co and started_at >= v_from and started_at < v_to
    group by 1
  ), fu as (
    select assigned_to as uid, count(*) as n from lb_followups
    where company_id = v_co and status = 'done' and assigned_to is not null
      and coalesce(completed_at, due_at) >= v_from and coalesce(completed_at, due_at) < v_to
    group by 1
  ), visits as (
    select user_id as uid, count(*) as n from lb_field_visits
    where company_id = v_co and started_at >= v_from and started_at < v_to
    group by 1
  ), days as (
    select user_id as uid, count(*) as n, coalesce(sum(active_sec), 0) as sec from lb_user_days
    where company_id = v_co and day >= v_month and day < (v_month + interval '1 month')::date
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'name', u.full_name, 'role', u.role, 'team', u.team,
      'won', coalesce(w.n, 0), 'won_value', coalesce(w.v, 0),
      'calls', coalesce(c.made, 0), 'calls_connected', coalesce(c.connected, 0), 'talk_min', round(coalesce(c.talk_sec, 0) / 60.0),
      'followups', coalesce(f.n, 0), 'visits', coalesce(v.n, 0),
      'days_active', coalesce(d.n, 0), 'active_min', round(coalesce(d.sec, 0) / 60.0),
      'won_target', tg.won_target, 'value_target', tg.value_target, 'calls_target', tg.calls_target,
      'followups_target', tg.followups_target, 'visits_target', tg.visits_target)
    order by u.full_name), '[]')
  into v_rows
  from users u
  left join won w on w.uid = u.id
  left join calls c on c.uid = u.id
  left join fu f on f.uid = u.id
  left join visits v on v.uid = u.id
  left join days d on d.uid = u.id
  left join lb_targets tg on tg.user_id = u.id and tg.month = v_month
  -- Admins only show when they have a target or did the work themselves.
  where u.role in ('agent','team_leader') or tg.user_id is not null or w.n > 0 or c.made > 0;

  return jsonb_build_object('month', v_month, 'rows', v_rows,
    'can_edit', lb_is_admin_of(v_co) or lb_my_role() = 'team_leader',
    'editable', case when lb_is_admin_of(v_co) then null else to_jsonb(lb_visible_user_ids()) end);
end $$;
revoke all on function public.lb_agent_targets(date) from public, anon;
grant execute on function public.lb_agent_targets(date) to authenticated;

-- Lead allocation by source: each lead source gets its own list of users with a
-- ratio (share of leads) and an optional max leads per day. Replaces the old
-- rule engine (lb_allocation_rules), whose rules had to match number + branch +
-- department + product + source all at once, so WhatsApp leads that carry only a
-- number and source never matched and stayed unassigned.
--
-- "Others" (source_id null) catches leads whose source has no row of its own.
-- Distribution is smooth weighted round-robin: ratio 2:1 gives A,B,A,A,B,A...
-- A user at their max/day for today (IST), switched off, away / off-hours,
-- opted out of auto-allocation or at their open-lead limit is skipped; if everyone is full the
-- lead stays unassigned for manual assignment.
-- Safe to run more than once.

-- ------------------------------------------------------------------ tables
create table if not exists public.lb_alloc_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  source_id uuid references public.lb_sources(id) on delete cascade,  -- null = Others
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique nulls not distinct (company_id, source_id)
);

create table if not exists public.lb_alloc_members (
  id uuid primary key default gen_random_uuid(),
  alloc_id uuid not null references public.lb_alloc_sources(id) on delete cascade,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  ratio integer not null default 1 check (ratio between 1 and 100),
  max_per_day integer check (max_per_day is null or max_per_day between 1 and 10000),
  is_active boolean not null default true,
  rr_weight integer not null default 0,      -- smooth weighted round-robin state
  day date,                                  -- IST day day_count belongs to
  day_count integer not null default 0,
  total_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (alloc_id, user_id)
);
create index if not exists lb_alloc_members_company on public.lb_alloc_members (company_id);

-- Member rows must stay inside the allocation's company and point at a user of it.
create or replace function public.lb__alloc_member_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select a.company_id into new.company_id from lb_alloc_sources a where a.id = new.alloc_id;
  if not exists (select 1 from lb_profiles p where p.id = new.user_id and p.company_id = new.company_id) then
    raise exception 'User must belong to this company';
  end if;
  return new;
end $$;
drop trigger if exists lb_alloc_members_check on public.lb_alloc_members;
create trigger lb_alloc_members_check before insert or update of alloc_id, user_id, company_id on public.lb_alloc_members
  for each row execute function public.lb__alloc_member_check();

create or replace function public.lb__alloc_source_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_id is not null and not exists (select 1 from lb_sources s where s.id = new.source_id and s.company_id = new.company_id) then
    raise exception 'Source must belong to this company';
  end if;
  return new;
end $$;
drop trigger if exists lb_alloc_sources_check on public.lb_alloc_sources;
create trigger lb_alloc_sources_check before insert or update of source_id, company_id on public.lb_alloc_sources
  for each row execute function public.lb__alloc_source_check();

-- ------------------------------------------------------------------ RLS
alter table public.lb_alloc_sources enable row level security;
alter table public.lb_alloc_members enable row level security;
revoke all on public.lb_alloc_sources, public.lb_alloc_members from anon;
grant select, insert, update, delete on public.lb_alloc_sources, public.lb_alloc_members to authenticated;

do $$ declare t text; begin
  foreach t in array array['lb_alloc_sources','lb_alloc_members'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.lb_is_super() or company_id = public.lb_my_company())', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.lb_is_admin_of(company_id))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.lb_is_admin_of(company_id))', t||'_del', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ allocator
-- A user can take auto-allocated leads when active, opted in (Users page),
-- available and inside working hours (top-bar status), and under their
-- open-lead limit. The allocation screen shows which of these blocks someone.
create or replace function public.lb__alloc_user_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.accepts_auto_allocation and lb__agent_available(p.id)
    and (p.allocation_limit is null or lb__open_load(p.id) < p.allocation_limit)
    from lb_profiles p where p.id = p_user), false)
$$;
revoke all on function public.lb__alloc_user_ok(uuid) from public, anon, authenticated;

-- Same signature as before, so every intake path (WhatsApp inbound, Facebook
-- leads, manual/import lb_create_lead, bulk "auto allocate", journeys) uses it.
create or replace function public.lb__auto_allocate(p_lead uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l lb_leads; a lb_alloc_sources; v_auto boolean; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_pick lb_alloc_members; v_sum integer; v_src text;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or l.owner_id is not null or lb__closed(l.status_category) then return l.owner_id; end if;
  select auto_allocate into v_auto from lb_companies where id = l.company_id;
  if not coalesce(v_auto, false) then return null; end if;

  -- The lead's own source row wins (even when switched off); otherwise "Others".
  select * into a from lb_alloc_sources s
  where s.company_id = l.company_id and s.source_id = l.source_id;
  if a.id is null then
    select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.source_id is null;
  end if;
  if a.id is null or not a.is_active then return null; end if;

  -- Lock the allocation's members so concurrent leads take turns correctly.
  perform 1 from lb_alloc_members m where m.alloc_id = a.id for update;

  -- Eligible: switched on here, lb__alloc_user_ok, under today's cap.
  select coalesce(sum(m.ratio), 0) into v_sum
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);
  if v_sum = 0 then return null; end if;

  -- Smooth weighted round-robin: everyone eligible gains their ratio, the
  -- highest takes the lead and pays back the total.
  update lb_alloc_members m set rr_weight = m.rr_weight + m.ratio
  from lb_profiles u
  where u.id = m.user_id and m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);

  select m.* into v_pick
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day)
  order by m.rr_weight desc, m.ratio desc, m.created_at, m.id
  limit 1;

  update lb_alloc_members set
    rr_weight = rr_weight - v_sum,
    day_count = case when day = v_today then day_count + 1 else 1 end,
    day = v_today,
    total_count = total_count + 1
  where id = v_pick.id;

  select coalesce((select name from lb_sources where id = a.source_id), 'Others') into v_src;
  perform lb__assign(p_lead, v_pick.user_id, p_actor, 'Auto allocation: ' || v_src || ' (ratio ' || v_pick.ratio || ')');
  return v_pick.user_id;
end $$;
revoke all on function public.lb__auto_allocate(uuid, uuid) from public, anon, authenticated;

-- Admin button "Assign waiting leads": runs the allocator over this source's
-- unassigned open leads, oldest first, until everyone hits their cap.
create or replace function public.lb_alloc_assign_waiting(p_alloc uuid, p_max integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare a lb_alloc_sources; v_id uuid; n integer := 0;
begin
  select * into a from lb_alloc_sources where id = p_alloc;
  if a.id is null or not lb_is_admin_of(a.company_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not a.is_active then raise exception 'Switch this source on first'; end if;
  for v_id in
    select l.id from lb_leads l
    where l.company_id = a.company_id and l.owner_id is null and not lb__closed(l.status_category)
      and (case when a.source_id is not null then l.source_id = a.source_id
                else not exists (select 1 from lb_alloc_sources s where s.company_id = a.company_id and s.source_id is not null and s.source_id = l.source_id) end)
    order by l.created_at
    limit least(greatest(coalesce(p_max, 500), 1), 2000)
  loop
    if lb__auto_allocate(v_id, auth.uid()) is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_alloc_assign_waiting(uuid, integer) from public, anon;
grant execute on function public.lb_alloc_assign_waiting(uuid, integer) to authenticated;

-- ------------------------------------------------------------------ move old rules
-- Each old rule becomes its source's list (rules without a source become
-- "Others"); every rule user gets ratio 1, no daily cap. Existing rows are kept.
insert into public.lb_alloc_sources (company_id, source_id, is_active)
select distinct r.company_id, r.match_source_id, true
from public.lb_allocation_rules r
where r.is_active and exists (select 1 from public.lb_allocation_rule_users ru where ru.rule_id = r.id)
on conflict (company_id, source_id) do nothing;

insert into public.lb_alloc_members (alloc_id, company_id, user_id, ratio)
select distinct a.id, a.company_id, ru.user_id, 1
from public.lb_allocation_rules r
join public.lb_allocation_rule_users ru on ru.rule_id = r.id
join public.lb_profiles p on p.id = ru.user_id and p.company_id = r.company_id
join public.lb_alloc_sources a on a.company_id = r.company_id and a.source_id is not distinct from r.match_source_id
where r.is_active
on conflict (alloc_id, user_id) do nothing;

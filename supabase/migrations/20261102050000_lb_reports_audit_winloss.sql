-- Report builder, full audit trail, lost reasons + win/loss report.
--
--   1. lb_lost_reasons: per-company master list of Lost / Invalid reasons
--      (Settings → Lost Reasons). Leads still store the reason as text in
--      lb_leads.lost_reason, so old free-text reasons keep working.
--   2. lb_win_loss(from, to): win/loss analysis of leads closed in a period
--      (totals, reasons, sources, owners, products, months). Runs as the
--      caller, so RLS scopes it (agents see their own leads).
--   3. lb_saved_reports: report builder layouts (private or shared in company).
--   4. Audit trail triggers: every change to a lead, a customer's name /
--      phone / email and a user's role / team / access is written to
--      lb_audit_log with old -> new values. The trigger never blocks the
--      change it records (errors are swallowed).
--
-- Company scoped via lb_my_company() (follows the Super Admin switcher).
-- Safe to run more than once.

-- ------------------------------------------------------- 1. lost reasons
create table if not exists public.lb_lost_reasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  category text not null default 'lost' check (category in ('lost','invalid','any')),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists lb_lost_reasons_company on public.lb_lost_reasons (company_id, sort_order);

create or replace function public.lb__seed_lost_reasons(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into lb_lost_reasons (company_id, name, category, sort_order)
  select p_company, r.name, r.cat, r.ord from (values
    ('Price too high', 'lost', 10), ('Bought from competitor', 'lost', 20), ('No budget', 'lost', 30),
    ('Not interested now', 'lost', 40), ('Not reachable', 'lost', 50), ('Went with other option', 'lost', 60),
    ('Location not serviceable', 'lost', 70), ('Just enquiring', 'lost', 80),
    ('Wrong number', 'invalid', 110), ('Duplicate lead', 'invalid', 120), ('Fake / spam', 'invalid', 130)
  ) as r(name, cat, ord)
  on conflict (company_id, name) do nothing
$$;

-- Existing companies get the defaults once (only if they have none yet).
do $$
declare c record;
begin
  for c in select id from public.lb_companies loop
    if not exists (select 1 from public.lb_lost_reasons where company_id = c.id) then
      perform public.lb__seed_lost_reasons(c.id);
    end if;
  end loop;
end $$;

-- New companies get them too.
create or replace function public.lb__seed_lost_reasons_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform lb__seed_lost_reasons(new.id);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists lb_companies_seed_lost_reasons on public.lb_companies;
create trigger lb_companies_seed_lost_reasons after insert on public.lb_companies
  for each row execute function public.lb__seed_lost_reasons_trg();

-- ------------------------------------------------------ 3. saved reports
create table if not exists public.lb_saved_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  spec jsonb not null default '{}',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_saved_reports_company on public.lb_saved_reports (company_id, created_at desc);

-- RLS: read own company rows (saved reports: own or shared). Writes go through
-- server actions with the service role, pinned to the caller's company.
do $$
declare t text;
begin
  foreach t in array array['lb_lost_reasons','lb_saved_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;
create policy lb_lost_reasons_read on public.lb_lost_reasons for select to authenticated
  using (company_id = public.lb_my_company());
create policy lb_saved_reports_read on public.lb_saved_reports for select to authenticated
  using (company_id = public.lb_my_company() and (user_id = auth.uid() or is_shared));

-- ------------------------------------------------------- 2. win / loss
create or replace function public.lb_win_loss(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (
    select l.*, coalesce(nullif(trim(l.lost_reason), ''), 'No reason given') as reason
    from lb_leads l
    where l.company_id = lb_my_company() and l.merged_into is null
      and l.status_category in ('won','lost','invalid')
      and l.closed_at >= p_from and l.closed_at < p_to
  ),
  grp as (
    select k, id, name, won, lost, invalid, won_value, lost_value from (
      select 'source' k, c.source_id::text id, s.name, count(*) filter (where status_category = 'won') won,
             count(*) filter (where status_category = 'lost') lost, count(*) filter (where status_category = 'invalid') invalid,
             coalesce(sum(won_value) filter (where status_category = 'won'), 0) won_value,
             coalesce(sum(expected_value) filter (where status_category = 'lost'), 0) lost_value
      from c left join lb_sources s on s.id = c.source_id group by c.source_id, s.name
      union all
      select 'owner', c.owner_id::text, p.full_name, count(*) filter (where status_category = 'won'),
             count(*) filter (where status_category = 'lost'), count(*) filter (where status_category = 'invalid'),
             coalesce(sum(won_value) filter (where status_category = 'won'), 0),
             coalesce(sum(expected_value) filter (where status_category = 'lost'), 0)
      from c left join lb_profiles p on p.id = c.owner_id group by c.owner_id, p.full_name
      union all
      select 'product', c.product_id::text, pr.name, count(*) filter (where status_category = 'won'),
             count(*) filter (where status_category = 'lost'), count(*) filter (where status_category = 'invalid'),
             coalesce(sum(won_value) filter (where status_category = 'won'), 0),
             coalesce(sum(expected_value) filter (where status_category = 'lost'), 0)
      from c left join lb_products pr on pr.id = c.product_id group by c.product_id, pr.name
      union all
      select 'month', to_char(date_trunc('month', closed_at at time zone 'Asia/Kolkata'), 'YYYY-MM'),
             to_char(date_trunc('month', closed_at at time zone 'Asia/Kolkata'), 'Mon YYYY'),
             count(*) filter (where status_category = 'won'), count(*) filter (where status_category = 'lost'),
             count(*) filter (where status_category = 'invalid'),
             coalesce(sum(won_value) filter (where status_category = 'won'), 0),
             coalesce(sum(expected_value) filter (where status_category = 'lost'), 0)
      from c group by 2, 3
    ) g
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'won', count(*) filter (where status_category = 'won'),
        'lost', count(*) filter (where status_category = 'lost'),
        'invalid', count(*) filter (where status_category = 'invalid'),
        'won_value', coalesce(sum(won_value) filter (where status_category = 'won'), 0),
        'lost_value', coalesce(sum(expected_value) filter (where status_category = 'lost'), 0),
        'avg_days_won', round(avg(extract(epoch from (closed_at - created_at)) / 86400) filter (where status_category = 'won')::numeric, 1),
        'avg_days_lost', round(avg(extract(epoch from (closed_at - created_at)) / 86400) filter (where status_category = 'lost')::numeric, 1))
      from c),
    'open', (select count(*) from lb_leads where company_id = lb_my_company() and merged_into is null
               and status_category not in ('won','lost','invalid')),
    'reasons', coalesce((select jsonb_agg(r order by r.n desc) from (
        select reason, status_category as category, count(*) n, coalesce(sum(expected_value), 0) value
        from c where status_category in ('lost','invalid') group by reason, status_category) r), '[]'),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.k, g.won + g.lost desc) from grp g), '[]')
  )
$$;
revoke all on function public.lb_win_loss(timestamptz, timestamptz) from public, anon;
grant execute on function public.lb_win_loss(timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------- 4. audit trail
-- Who did it: the signed-in user (auth.uid()), or null = System / automation.
create or replace function public.lb__audit_actor() returns uuid
language sql stable security definer set search_path = public as $$
  select id from lb_profiles where id = auth.uid()
$$;

-- Diff of the listed columns: {"col": [old, new], ...}
create or replace function public.lb__audit_diff(o jsonb, n jsonb, cols text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)), '{}')
  from unnest(cols) k where (o -> k) is distinct from (n -> k)
$$;

create or replace function public.lb__audit_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cols text[] := array['status_id','sub_status_id','owner_id','priority','source_id','product_id','team_id','branch_id',
    'department_id','number_id','expected_value','won_value','lost_reason','notes','remark','custom',
    'payment_status','payment_due_amount','deleted_at','merged_into','customer_id'];
  d jsonb; act text;
begin
  if tg_op = 'DELETE' then
    -- Only a person's delete is logged (system clean-ups such as the nightly demo reset are not).
    if lb__audit_actor() is null then return old; end if;
    insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (old.company_id, lb__audit_actor(), 'lead.delete_permanent', 'lead', old.id::text,
            jsonb_build_object('lead_no', old.lead_no));
    return old;
  end if;
  d := lb__audit_diff(to_jsonb(old), to_jsonb(new), cols);
  if d = '{}'::jsonb then return new; end if;
  act := case
    when d ? 'deleted_at' and new.deleted_at is not null then 'lead.delete'
    when d ? 'deleted_at' then 'lead.restore'
    when d ? 'merged_into' then 'lead.merge'
    when d ? 'status_id' then 'lead.status'
    when d ? 'owner_id' then 'lead.assign'
    else 'lead.update' end;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (new.company_id, lb__audit_actor(), act, 'lead', new.id::text,
          jsonb_build_object('lead_no', new.lead_no, 'changes', d));
  return new;
exception when others then
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists lb_leads_audit on public.lb_leads;
create trigger lb_leads_audit after update or delete on public.lb_leads
  for each row execute function public.lb__audit_lead();

create or replace function public.lb__audit_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  d := lb__audit_diff(to_jsonb(old), to_jsonb(new), array['name','phone_e164','email','location']);
  if d <> '{}'::jsonb then
    insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (new.company_id, lb__audit_actor(), 'customer.update', 'customer', new.id::text, jsonb_build_object('changes', d));
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists lb_customers_audit on public.lb_customers;
create trigger lb_customers_audit after update on public.lb_customers
  for each row execute function public.lb__audit_customer();

-- Users: role / placement / access changes. company_id is left out on purpose
-- (it moves with the Super Admin company switcher).
create or replace function public.lb__audit_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if new.company_id is distinct from old.company_id then return new; end if;
  d := lb__audit_diff(to_jsonb(old), to_jsonb(new), array['role','full_name','email','phone','branch_id','department_id',
    'team_id','permissions','is_active','accepts_auto_allocation','allocation_limit','username']);
  if d <> '{}'::jsonb then
    insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (new.company_id, lb__audit_actor(), 'user.change', 'user', new.id::text,
            jsonb_build_object('name', new.full_name, 'changes', d));
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists lb_profiles_audit on public.lb_profiles;
create trigger lb_profiles_audit after update on public.lb_profiles
  for each row execute function public.lb__audit_profile();

revoke all on function public.lb__audit_lead(), public.lb__audit_customer(), public.lb__audit_profile(),
  public.lb__audit_actor(), public.lb__seed_lost_reasons(uuid), public.lb__seed_lost_reasons_trg() from public, anon, authenticated;

create index if not exists lb_audit_log_entity on public.lb_audit_log (company_id, entity, entity_id, created_at desc);

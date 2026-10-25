-- SaaS plans on top of self-serve trial billing (20261023000026).
-- lb_billing.plan stays the access status (trial | paid | internal); the new
-- plan_id says which priced plan a company is on and which limits apply.
-- The platform owner (super_admin) manages plans and companies from /platform
-- through the service role; tenants can only read their own plan.

create table lb_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  description text,
  price_inr integer not null default 0 check (price_inr >= 0),
  per_user boolean not null default true,        -- price × active users, or flat
  period_days integer not null default 365 check (period_days between 1 and 3660),
  trial_days integer not null default 1 check (trial_days between 0 and 90),
  max_users integer check (max_users > 0),        -- null = unlimited
  max_numbers integer check (max_numbers >= 0),
  max_leads_month integer check (max_leads_month > 0),
  features text[] not null default '{nurture,ai,fb_leads}',
  is_public boolean not null default true,        -- offered on signup and billing
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Today's single plan (leadboxs.in/pricing: ₹699/user/month billed yearly).
insert into lb_plans (code, name, description, price_inr, per_user, period_days, trial_days, sort)
values ('starter', 'Starter', 'All CRM features, billed per user per year', 8388, true, 365, 1, 10);

alter table lb_billing
  add column plan_id uuid references lb_plans(id) on delete restrict,
  add column suspended_at timestamptz,
  add column suspended_reason text,
  add column notes text;

update lb_billing set plan_id = (select id from lb_plans where code = 'starter') where plan <> 'internal';

-- Suspended companies lose access exactly like a lapsed trial; data is kept.
create or replace function lb_company_entitled(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select suspended_at is null
      and (plan = 'internal' or trial_ends_at > now() or coalesce(paid_until > now(), false))
    from lb_billing where company_id = p_company), false)
$$;

-- The trial window stays fixed for tenants; only the platform functions below
-- (which set lb.trial_override for their own transaction) may move it.
create or replace function lb__guard_trial() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.trial_ends_at is distinct from old.trial_ends_at
     and coalesce(current_setting('lb.trial_override', true), '') <> 'on' then
    raise exception 'The trial window cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Self-serve signup now takes the chosen plan; its trial_days set the window.
drop function if exists lb_signup(uuid, text, text, text, text, text[]);
create or replace function lb_signup(p_user uuid, p_company text, p_full_name text, p_email text,
  p_phone text, p_identities text[], p_plan uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_slug text; v_plan lb_plans;
begin
  if exists (select 1 from lb_trial_claims where identity = any(p_identities)) then
    raise exception 'trial_used';
  end if;
  select * into v_plan from lb_plans
    where is_active and is_public and (id = p_plan or p_plan is null) order by (id = p_plan) desc nulls last, sort limit 1;
  v_slug := trim(both '-' from regexp_replace(lower(p_company), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(coalesce(nullif(v_slug, ''), 'company'), 40) || '-' || substr(md5(random()::text), 1, 6);
  insert into lb_companies (name, slug) values (p_company, v_slug) returning id into v_company;
  if v_plan.id is not null then
    perform set_config('lb.trial_override', 'on', true);
    update lb_billing set plan_id = v_plan.id, trial_ends_at = now() + make_interval(days => greatest(v_plan.trial_days, 0)),
      updated_at = now() where company_id = v_company;
    perform set_config('lb.trial_override', 'off', true);
  end if;
  insert into lb_trial_claims (identity, company_id) select unnest(p_identities), v_company;
  insert into lb_profiles (id, company_id, role, full_name, email, phone)
    values (p_user, v_company, 'company_admin', p_full_name, lower(p_email), p_phone);
  insert into lb_audit_log (company_id, action, entity, entity_id, data)
    values (v_company, 'signup.trial', 'user', p_user, jsonb_build_object('email', lower(p_email), 'plan', v_plan.code));
  return v_company;
exception when unique_violation then
  raise exception 'trial_used';
end $$;

-- Platform owner adds a company by hand (no trial claim). p_status:
-- 'trial' (plan's trial days, or p_days), 'paid' (p_days of access) or 'internal'.
create or replace function lb_platform_create_company(p_actor uuid, p_user uuid, p_company text, p_full_name text,
  p_email text, p_phone text, p_plan uuid, p_status text, p_days integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_slug text; v_trial integer;
begin
  if p_status not in ('trial','paid','internal') then raise exception 'bad status'; end if;
  select trial_days into v_trial from lb_plans where id = p_plan;
  v_slug := trim(both '-' from regexp_replace(lower(p_company), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(coalesce(nullif(v_slug, ''), 'company'), 40) || '-' || substr(md5(random()::text), 1, 6);
  insert into lb_companies (name, slug) values (p_company, v_slug) returning id into v_company;
  perform set_config('lb.trial_override', 'on', true);
  update lb_billing set
    plan = p_status, plan_id = p_plan,
    trial_ends_at = case when p_status = 'trial' then now() + make_interval(days => coalesce(p_days, v_trial, 1)) else now() end,
    paid_until = case when p_status = 'paid' then now() + make_interval(days => coalesce(p_days, 30)) end,
    updated_at = now()
  where company_id = v_company;
  perform set_config('lb.trial_override', 'off', true);
  insert into lb_profiles (id, company_id, role, full_name, email, phone)
    values (p_user, v_company, 'company_admin', p_full_name, lower(p_email), p_phone);
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (v_company, p_actor, 'platform.company_create', 'company', v_company,
      jsonb_build_object('email', lower(p_email), 'status', p_status, 'days', p_days));
  return v_company;
end $$;

-- Moves the trial end (extend or end it now).
create or replace function lb_platform_set_trial(p_actor uuid, p_company uuid, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lb.trial_override', 'on', true);
  update lb_billing set trial_ends_at = p_ends_at, updated_at = now() where company_id = p_company;
  if not found then raise exception 'company not found'; end if;
  perform set_config('lb.trial_override', 'off', true);
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (p_company, p_actor, 'platform.trial_set', 'company', p_company, jsonb_build_object('ends_at', p_ends_at));
end $$;

-- ------------------------------------------------------------- usage
create or replace function lb_platform_usage() returns table (
  company_id uuid, users integer, numbers integer, leads_month integer, leads_total integer, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*)::int from lb_profiles p where p.company_id = c.id and p.is_active),
    (select count(*)::int from lb_wa_numbers n where n.company_id = c.id),
    (select count(*)::int from lb_leads l where l.company_id = c.id and l.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    (select count(*)::int from lb_leads l where l.company_id = c.id),
    (select max(created_at) from lb_audit_log a where a.company_id = c.id)
  from lb_companies c
$$;

-- ------------------------------------------------------------- limits
-- Users and WhatsApp numbers above the plan limit are refused. Leads are never
-- refused (an incoming lead must not be lost); the panel shows overuse instead.
create or replace function lb__plan_limit(p_company uuid, p_kind text) returns integer
language sql stable security definer set search_path = public as $$
  select case p_kind when 'users' then pl.max_users when 'numbers' then pl.max_numbers end
  from lb_billing b join lb_plans pl on pl.id = b.plan_id
  where b.company_id = p_company and b.plan <> 'internal'
$$;

create or replace function lb__guard_user_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max integer;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active and old.company_id = new.company_id) then return new; end if;
  v_max := lb__plan_limit(new.company_id, 'users');
  if v_max is not null and (select count(*) from lb_profiles where company_id = new.company_id and is_active and id <> new.id) >= v_max then
    raise exception 'Your plan allows % active users. Upgrade the plan or deactivate a user first.', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger lb_profiles_plan_limit before insert or update of is_active, company_id on lb_profiles
  for each row execute function lb__guard_user_limit();

create or replace function lb__guard_number_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max integer;
begin
  v_max := lb__plan_limit(new.company_id, 'numbers');
  if v_max is not null and (select count(*) from lb_wa_numbers where company_id = new.company_id) >= v_max then
    raise exception 'Your plan allows % WhatsApp number(s). Upgrade the plan to add more.', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger lb_wa_numbers_plan_limit before insert on lb_wa_numbers
  for each row execute function lb__guard_number_limit();

-- Feature flags of the caller's plan (internal / no plan = everything).
create or replace function lb_my_features() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select case when b.plan = 'internal' or b.plan_id is null then null else pl.features end
    from lb_billing b left join lb_plans pl on pl.id = b.plan_id where b.company_id = lb__own_company()),
    array['nurture','ai','fb_leads'])
$$;

-- ------------------------------------------------------------- access
alter table lb_plans enable row level security;
revoke all on lb_plans from anon, authenticated;
grant select on lb_plans to authenticated;
create policy lb_plans_read on lb_plans for select to authenticated
  using (lb_is_super() or is_public or id = (select plan_id from lb_billing where company_id = lb__own_company()));

revoke execute on function lb_signup(uuid,text,text,text,text,text[],uuid), lb_platform_create_company(uuid,uuid,text,text,text,text,uuid,text,integer),
  lb_platform_set_trial(uuid,uuid,timestamptz), lb_platform_usage(), lb__plan_limit(uuid,text),
  lb__guard_user_limit(), lb__guard_number_limit(), lb_my_features() from public, anon, authenticated;
grant execute on function lb_signup(uuid,text,text,text,text,text[],uuid), lb_platform_create_company(uuid,uuid,text,text,text,text,uuid,text,integer),
  lb_platform_set_trial(uuid,uuid,timestamptz), lb_platform_usage(), lb__plan_limit(uuid,text) to service_role;
grant execute on function lb_my_features() to authenticated, service_role;

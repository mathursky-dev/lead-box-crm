-- Self-serve signup: every new company gets one 24-hour trial, then needs a
-- paid period. Billing rows are written only by the server (service role) and
-- by triggers; users can read them but never change them. Lapsed companies
-- keep all data — access is blocked, nothing is deleted.

create table lb_billing (
  company_id uuid primary key references lb_companies(id) on delete restrict,
  plan text not null default 'trial' check (plan in ('trial','paid','internal')),
  trial_ends_at timestamptz not null default now() + interval '24 hours',
  paid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who already had a trial (sha256 of normalised email / phone). Never
-- deleted and not tied to the company row, so deleting a company or user
-- does not hand out a second trial.
create table lb_trial_claims (
  identity text primary key,
  company_id uuid,
  created_at timestamptz not null default now()
);

create table lb_payments (
  id text primary key,                 -- provider payment id (idempotency key)
  company_id uuid not null references lb_companies(id) on delete restrict,
  provider text not null,
  amount_paise bigint not null,
  currency text not null,
  seats integer not null,
  period_days integer not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index on lb_payments (company_id, created_at desc);

-- Companies that existed before self-serve signup keep full access.
insert into lb_billing (company_id, plan) select id, 'internal' from lb_companies
on conflict do nothing;

-- New companies start a trial; the clock is the database's, not the client's.
create or replace function lb__start_trial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lb_billing (company_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger lb_companies_trial after insert on lb_companies
  for each row execute function lb__start_trial();

create or replace function lb_company_entitled(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select plan = 'internal' or trial_ends_at > now() or coalesce(paid_until > now(), false)
    from lb_billing where company_id = p_company), false)
$$;

-- True when the caller may use the CRM right now.
create or replace function lb_access_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select lb_is_super() or coalesce(lb_company_entitled(lb_my_company()), false)
$$;

-- Atomic self-serve signup (service role only). Raises 'trial_used' if any
-- identity already had a trial.
create or replace function lb_signup(p_user uuid, p_company text, p_full_name text, p_email text,
  p_phone text, p_identities text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_slug text;
begin
  if exists (select 1 from lb_trial_claims where identity = any(p_identities)) then
    raise exception 'trial_used';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(p_company), '[^a-z0-9]+', '-', 'g'));
  v_slug := left(coalesce(nullif(v_slug, ''), 'company'), 40) || '-' || substr(md5(random()::text), 1, 6);
  insert into lb_companies (name, slug) values (p_company, v_slug) returning id into v_company;
  insert into lb_trial_claims (identity, company_id) select unnest(p_identities), v_company;
  insert into lb_profiles (id, company_id, role, full_name, email, phone)
    values (p_user, v_company, 'company_admin', p_full_name, lower(p_email), p_phone);
  insert into lb_audit_log (company_id, action, entity, entity_id, data)
    values (v_company, 'signup.trial', 'user', p_user, jsonb_build_object('email', lower(p_email)));
  return v_company;
exception when unique_violation then
  raise exception 'trial_used';
end $$;

-- Records a verified payment once and extends access (service role only).
create or replace function lb_record_payment(p_id text, p_company uuid, p_provider text, p_amount_paise bigint,
  p_currency text, p_seats integer, p_days integer, p_raw jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into lb_payments (id, company_id, provider, amount_paise, currency, seats, period_days, raw)
    values (p_id, p_company, p_provider, p_amount_paise, p_currency, p_seats, p_days, p_raw)
    on conflict (id) do nothing;
  if not found then return false; end if;
  update lb_billing set plan = case when plan = 'internal' then plan else 'paid' end,
    paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => p_days),
    updated_at = now()
  where company_id = p_company;
  return true;
end $$;

-- ------------------------------------------------------------- access
alter table lb_billing enable row level security;
alter table lb_trial_claims enable row level security;
alter table lb_payments enable row level security;
revoke all on lb_billing, lb_trial_claims, lb_payments from anon, authenticated;
grant select on lb_billing, lb_payments to authenticated;
create policy lb_billing_read on lb_billing for select to authenticated
  using (lb_is_super() or company_id = lb_my_company());
create policy lb_payments_read on lb_payments for select to authenticated
  using (lb_is_admin_of(company_id));

-- Restrictive gate on every other LEAD BOX table (RLS covers REST and
-- Realtime). Profiles and companies stay readable so sign-in and the billing
-- page work; writing to them is gated too.
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname like 'lb\_%'
      and c.relname not in ('lb_billing','lb_trial_claims','lb_payments')
  loop
    if t in ('lb_profiles','lb_companies') then
      execute format('create policy lb_paid_ins on %I as restrictive for insert to authenticated with check ((select lb_access_ok()))', t);
      execute format('create policy lb_paid_upd on %I as restrictive for update to authenticated using ((select lb_access_ok()))', t);
      execute format('create policy lb_paid_del on %I as restrictive for delete to authenticated using ((select lb_access_ok()))', t);
    else
      execute format('create policy lb_paid on %I as restrictive for all to authenticated using ((select lb_access_ok())) with check ((select lb_access_ok()))', t);
    end if;
  end loop;
end $$;

-- SECURITY DEFINER RPCs skip RLS, so the gate also lives in the access
-- helpers every lb_ policy and RPC already calls. They now resolve the caller
-- through lb__entitled_uid(), so a lapsed user is treated like a signed-out
-- one everywhere (REST, RPC, Realtime) without touching anything outside lb_.
create or replace function lb__entitled_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from lb_profiles p
  where p.id = auth.uid() and (p.role = 'super_admin' or lb_company_entitled(p.company_id))
$$;

-- The caller's own company, even when lapsed (billing page, sign-in).
create or replace function lb__own_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from lb_profiles where id = auth.uid() and is_active
$$;

drop policy if exists lb_billing_read on lb_billing;
create policy lb_billing_read on lb_billing for select to authenticated
  using (lb_is_super() or company_id = lb__own_company());
create policy lb_profiles_read_self on lb_profiles for select to authenticated using (id = auth.uid());
create policy lb_companies_read_own on lb_companies for select to authenticated using (id = lb__own_company());

-- The trial window is fixed once written; trial claims are permanent.
create or replace function lb__guard_trial() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.trial_ends_at is distinct from old.trial_ends_at then
    raise exception 'The trial window cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lb_billing_guard before update on lb_billing for each row execute function lb__guard_trial();

create or replace function lb__guard_claims() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Trial claims are permanent' using errcode = '42501';
end $$;
create trigger lb_trial_claims_guard before update or delete on lb_trial_claims
  for each row execute function lb__guard_claims();

-- Same bodies as before, with auth.uid() -> lb__entitled_uid().
create or replace function lb__me() returns lb_profiles
language plpgsql stable security definer set search_path = public as $$
declare p lb_profiles;
begin
  select * into p from lb_profiles where id = lb__entitled_uid() and is_active;
  if p.id is null then
    if exists (select 1 from lb_profiles where id = auth.uid() and is_active) then
      raise exception 'Your Lead Box trial has ended. Payment is required to continue.' using errcode = '42501';
    end if;
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return p;
end $$;

create or replace function lb_can(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role in ('super_admin','company_admin')
        or p_perm = any(p.permissions)
        or coalesce((select rp.allowed from lb_role_permissions rp
                     where rp.company_id = p.company_id and rp.role = p.role and rp.permission = p_perm),
                    (select case p.role when 'agent' then c.agent_default else c.team_leader_default end
                     from lb_permission_catalog c where c.key = p_perm), false)
    from lb_profiles p where p.id = lb__entitled_uid() and p.is_active), false)
$$;

create or replace function lb_can_see_conversation(p_company uuid, p_team uuid, p_assignee uuid, p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select id, role, company_id into r from lb_profiles where id = lb__entitled_uid() and is_active;
  if r.id is null then return false; end if;
  if r.role = 'super_admin' then return true; end if;
  if r.company_id <> p_company then return false; end if;
  if r.role = 'company_admin' or p_assignee = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_assignee is not null and p_assignee = any(lb_visible_user_ids()))
      or (p_assignee is null and lb_can_use_number(p_number));
  end if;
  return false;
end $$;

create or replace function lb_can_see_lead(p_company uuid, p_team uuid, p_owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select id, role, company_id into r from lb_profiles where id = lb__entitled_uid() and is_active;
  if r.id is null then return false; end if;
  if r.role = 'super_admin' then return true; end if;
  if r.company_id <> p_company then return false; end if;
  if r.role = 'company_admin' or p_owner = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_owner is not null and p_owner = any(lb_visible_user_ids()));
  end if;
  return false;
end $$;

create or replace function lb_can_use_number(p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record; v_company uuid;
begin
  select id, role, company_id into r from lb_profiles where id = lb__entitled_uid() and is_active;
  if r.id is null then return false; end if;
  select company_id into v_company from lb_wa_numbers where id = p_number;
  if r.role = 'super_admin' then return true; end if;
  if v_company is distinct from r.company_id then return false; end if;
  if r.role = 'company_admin' then return true; end if;
  return exists (select 1 from lb_wa_number_users where number_id = p_number and user_id = r.id)
      or exists (select 1 from lb_wa_number_teams where number_id = p_number and team_id = any(lb_team_ids_for(r.id)));
end $$;

create or replace function lb_has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','company_admin') or p_perm = any(permissions)
    from lb_profiles where id = lb__entitled_uid() and is_active), false)
$$;

create or replace function lb_is_admin_of(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' or (role = 'company_admin' and company_id = p_company)
    from lb_profiles where id = lb__entitled_uid() and is_active), false)
$$;

create or replace function lb_my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from lb_profiles where id = lb__entitled_uid() and is_active
$$;

create or replace function lb_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from lb_profiles where id = lb__entitled_uid() and is_active
$$;

create or replace function lb_my_team_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select lb_team_ids_for(lb__entitled_uid())
$$;

create or replace function lb_visible_user_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case
    when p.role in ('super_admin','company_admin') then
      (select coalesce(array_agg(id), '{}') from lb_profiles where company_id = p.company_id)
    when p.role = 'team_leader' then
      (select coalesce(array_agg(id), '{}') from lb_profiles
        where company_id = p.company_id and (id = p.id or team_id = any(lb_team_ids_for(p.id))))
    else array[p.id] end
  from lb_profiles p where p.id = lb__entitled_uid() and p.is_active
$$;

-- TRUNCATE ignores RLS, so no client role may hold it on lb_ tables (public
-- signup would otherwise let any new user wipe every tenant). anon never
-- writes lb_ tables directly.
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'lb\_%'
  loop
    execute format('revoke truncate, references, trigger on %I from anon, authenticated', t);
    execute format('revoke insert, update, delete on %I from anon', t);
  end loop;
end $$;

revoke execute on function lb__start_trial(), lb_company_entitled(uuid), lb_access_ok(), lb__entitled_uid(), lb__own_company(),
  lb_signup(uuid,text,text,text,text,text[]), lb_record_payment(text,uuid,text,bigint,text,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function lb_access_ok(), lb__own_company() to authenticated;
grant execute on function lb__start_trial(), lb_company_entitled(uuid), lb_access_ok(), lb__entitled_uid(), lb__own_company(),
  lb_signup(uuid,text,text,text,text,text[]), lb_record_payment(text,uuid,text,bigint,text,integer,integer,jsonb)
  to service_role;

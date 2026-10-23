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

-- SECURITY DEFINER RPCs skip RLS, so gate them before PostgREST runs them.
-- Only lb_ paths are checked; anything else in this project is untouched.
create or replace function lb_pre_request() returns void
language plpgsql stable security definer set search_path = public as $$
declare p text := coalesce(current_setting('request.path', true), '');
begin
  if auth.role() is distinct from 'authenticated' then return; end if;
  if p !~ '^/(rpc/)?lb_' then return; end if;
  if p ~ '^/(lb_profiles|lb_companies|lb_billing|lb_payments|rpc/lb_my_permissions|rpc/lb_access_ok)$' then return; end if;
  if not lb_access_ok() then
    raise sqlstate 'PT402' using message = 'Your Lead Box trial has ended. Payment is required to continue.';
  end if;
end $$;

do $$ declare v text; begin
  select s into v from pg_db_role_setting d, unnest(d.setconfig) s
    where d.setrole = 'authenticator'::regrole and s like 'pgrst.db_pre_request=%';
  if v is not null and v <> 'pgrst.db_pre_request=public.lb_pre_request' then
    raise exception 'Another PostgREST pre-request hook is configured (%); combine them by hand.', v;
  end if;
end $$;
alter role authenticator set pgrst.db_pre_request = 'public.lb_pre_request';
notify pgrst, 'reload config';

revoke execute on function lb__start_trial(), lb_company_entitled(uuid), lb_access_ok(), lb_pre_request(),
  lb_signup(uuid,text,text,text,text,text[]), lb_record_payment(text,uuid,text,bigint,text,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function lb_access_ok(), lb_pre_request() to authenticated;
grant execute on function lb_pre_request() to anon;
grant execute on function lb__start_trial(), lb_company_entitled(uuid), lb_access_ok(), lb_pre_request(),
  lb_signup(uuid,text,text,text,text,text[]), lb_record_payment(text,uuid,text,bigint,text,integer,integer,jsonb)
  to service_role;

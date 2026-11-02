-- Roles page access + login history + two-factor (OTP) policy + company data export + onboarding wizard.
-- Safe to run more than once. Nothing changes for existing users until an admin changes a setting:
--   * no lb_role_page_access rows  = every page allowed (today's behaviour)
--   * lb_companies.require_2fa     = false by default (2FA stays optional)
--   * existing companies are marked as already onboarded (no wizard for them)

-- 1) Page-wise access per role (Agent / Team Leader). Admins always have full access.
create table if not exists public.lb_role_page_access (
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  role text not null check (role in ('team_leader','agent')),
  page text not null check (page ~ '^[a-z_]{2,40}$'),
  can_view boolean not null default true,
  can_edit boolean not null default true,
  can_delete boolean not null default true,
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, role, page)
);
alter table public.lb_role_page_access enable row level security;
revoke all on public.lb_role_page_access from anon;
drop policy if exists lb_role_page_access_read on public.lb_role_page_access;
create policy lb_role_page_access_read on public.lb_role_page_access for select to authenticated
  using (company_id = public.lb_my_company());
drop policy if exists lb_role_page_access_write on public.lb_role_page_access;
create policy lb_role_page_access_write on public.lb_role_page_access for all to authenticated
  using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));
grant select, insert, update, delete on public.lb_role_page_access to authenticated;

-- Can the signed-in user do p_action ('view'|'edit'|'delete') on page p_page? Missing row = yes.
create or replace function public.lb_page_can(p_page text, p_action text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.role in ('super_admin','company_admin') then true
      else coalesce((select case p_action when 'edit' then a.can_view and a.can_edit
                                          when 'delete' then a.can_view and a.can_delete
                                          else a.can_view end
                     from lb_role_page_access a
                     where a.company_id = p.company_id and a.role = p.role and a.page = p_page), true) end
    from lb_profiles p where p.id = auth.uid() and p.is_active), true)
$$;

-- Pages the signed-in user is blocked from, as {page: {view, edit, delete}}; empty for admins.
create or replace function public.lb_my_page_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(a.page, jsonb_build_object('view', a.can_view, 'edit', a.can_view and a.can_edit, 'delete', a.can_view and a.can_delete)), '{}'::jsonb)
  from lb_profiles p join lb_role_page_access a on a.company_id = p.company_id and a.role = p.role
  where p.id = auth.uid() and p.is_active and p.role in ('agent','team_leader')
$$;
revoke execute on function public.lb_page_can(text, text), public.lb_my_page_access() from public, anon;
grant execute on function public.lb_page_can(text, text), public.lb_my_page_access() to authenticated, service_role;

-- Database backstop for deletes made directly by an Agent / Team Leader (service role and admins pass).
create or replace function public.lb__page_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.lb_page_can(tg_argv[0], 'delete') then
    raise exception 'not_permitted: your role cannot delete here' using errcode = '42501';
  end if;
  return old;
end $$;
do $$ declare t text; pg text; begin
  foreach t in array array['lb_tasks:tasks','lb_documents:documents','lb_quotes:quotes'] loop
    pg := split_part(t, ':', 2); t := split_part(t, ':', 1);
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists lb_page_delete_guard on public.%I', t);
      execute format('create trigger lb_page_delete_guard before delete on public.%I for each row execute function public.lb__page_delete_guard(%L)', t, pg);
    end if;
  end loop;
end $$;

-- 2) Login history (written by the server on every sign-in attempt).
create table if not exists public.lb_login_events (
  id bigserial primary key,
  company_id uuid references public.lb_companies(id) on delete cascade,
  user_id uuid references public.lb_profiles(id) on delete cascade,
  login text,
  success boolean not null,
  method text not null default 'password' check (method in ('password','otp','logout','2fa_setup','2fa_off')),
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists lb_login_events_company_idx on public.lb_login_events (company_id, created_at desc);
create index if not exists lb_login_events_user_idx on public.lb_login_events (user_id, created_at desc);
alter table public.lb_login_events enable row level security;
revoke all on public.lb_login_events from anon, authenticated;
grant select on public.lb_login_events to authenticated;
grant all on public.lb_login_events to service_role;
grant usage on sequence public.lb_login_events_id_seq to service_role;
drop policy if exists lb_login_events_read on public.lb_login_events;
create policy lb_login_events_read on public.lb_login_events for select to authenticated
  using (user_id = auth.uid() or (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id)));

-- 3) Two-factor (authenticator app OTP). Optional per user; admins can make it compulsory for the company.
alter table public.lb_companies add column if not exists require_2fa boolean not null default false;

-- Which users of the admin's company have 2FA switched on (reads auth.mfa_factors).
create or replace function public.lb_company_2fa_status() returns table (user_id uuid, has_2fa boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
  from lb_profiles p
  where p.company_id = public.lb_my_company() and public.lb_is_admin_of(p.company_id)
$$;
revoke execute on function public.lb_company_2fa_status() from public, anon;
grant execute on function public.lb_company_2fa_status() to authenticated, service_role;

-- 4) Onboarding wizard. Existing companies are treated as already set up.
alter table public.lb_companies add column if not exists onboarded_at timestamptz;
alter table public.lb_companies add column if not exists onboarding jsonb not null default '{}'::jsonb;
update public.lb_companies set onboarded_at = coalesce(created_at, now()) where onboarded_at is null and created_at < '2026-11-03';

-- 5) Full company export: list of company tables (service role only; the app strips secret columns).
create or replace function public.lb_export_tables() returns table (table_name text, has_id boolean)
language sql stable security definer set search_path = public as $$
  select c.table_name::text,
         exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'company_id' and c.table_name like 'lb\_%'
  order by 1
$$;
revoke execute on function public.lb_export_tables() from public, anon, authenticated;
grant execute on function public.lb_export_tables() to service_role;

notify pgrst, 'reload schema';

-- Company switcher for the platform Super Admin.
--
-- A super_admin can "open" any company from the top bar. The choice is kept
-- here (one row per super admin, written only through lb_switch_company) and
-- the access helpers return that company as the caller's company. Every RLS
-- policy and RPC already goes through lb_my_company() / lb__me() /
-- lb_visible_user_ids(), so the whole app and database then work inside the
-- chosen company. The super admin's own lb_profiles row never moves, so they
-- never show up in that company's user lists, limits or demo resets.
--
-- Nothing changes for any other role: the helpers only read this table when
-- the caller's role is super_admin.

create table if not exists public.lb_super_context (
  user_id    uuid primary key references public.lb_profiles(id) on delete cascade,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.lb_super_context enable row level security;
revoke all on public.lb_super_context from public, anon, authenticated;

-- Company the caller is working in: own company, or the opened one for a super admin.
create or replace function public.lb__acting_company(p lb_profiles) returns uuid
language sql stable security definer set search_path = public as $$
  select case when p.role = 'super_admin'
    then coalesce((select s.company_id from lb_super_context s where s.user_id = p.id), p.company_id)
    else p.company_id end
$$;

create or replace function public.lb_my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select lb__acting_company(p) from lb_profiles p where p.id = lb__entitled_uid() and p.is_active
$$;

-- Same body as 20261023000026, plus the acting company for a super admin.
create or replace function public.lb__me() returns lb_profiles
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
  p.company_id := lb__acting_company(p);
  return p;
end $$;

create or replace function public.lb_visible_user_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case
    when p.role in ('super_admin','company_admin') then
      (select coalesce(array_agg(id), '{}') from lb_profiles where company_id = lb__acting_company(p))
    when p.role = 'team_leader' then
      (select coalesce(array_agg(id), '{}') from lb_profiles
        where company_id = p.company_id and (id = p.id or team_id = any(lb_team_ids_for(p.id))))
    else array[p.id] end
  from lb_profiles p where p.id = lb__entitled_uid() and p.is_active
$$;

-- Open a company (null or own company = back home). Super Admin only.
create or replace function public.lb_switch_company(p_company uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles;
begin
  select * into me from lb_profiles where id = auth.uid() and is_active;
  if me.id is null or me.role <> 'super_admin' then
    raise exception 'Only the platform Super Admin can switch company' using errcode = '42501';
  end if;
  if p_company is null or p_company = me.company_id then
    delete from lb_super_context where user_id = me.id;
    return me.company_id;
  end if;
  if not exists (select 1 from lb_companies where id = p_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  insert into lb_super_context (user_id, company_id) values (me.id, p_company)
    on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return p_company;
end $$;

revoke execute on function public.lb__acting_company(lb_profiles), public.lb_switch_company(uuid) from public, anon;
grant execute on function public.lb_switch_company(uuid) to authenticated;

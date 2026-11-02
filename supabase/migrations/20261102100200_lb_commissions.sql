-- Agent commission on every won deal.
--
--   1. lb_commission_settings: per company on/off, default % of deal value and/or a
--      flat amount per deal.
--   2. lb_commission_rates: per-agent override (% and/or flat).
--   3. lb_commissions: one row per won lead, for the agent who converted it
--      (converted_owner_id, else owner). Status pending -> approved -> paid,
--      or cancelled if the lead leaves Won / is deleted before approval.
--   4. Trigger on lb_leads keeps it in sync automatically; a backfill RPC adds
--      commissions for deals won before the feature was switched on.
--
-- Approved / paid rows and rows whose amount an admin edited are never changed
-- by the trigger. Reads: admin all, team leader their team, agent own.
-- Writes go through server actions (service role) after an admin check.
-- Safe to run more than once.

create table if not exists public.lb_commission_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  enabled boolean not null default false,
  default_pct numeric(6,3) not null default 0 check (default_pct between 0 and 100),
  flat_per_deal numeric(14,2) not null default 0 check (flat_per_deal >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.lb_commission_rates (
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  pct numeric(6,3) check (pct is null or pct between 0 and 100),
  flat numeric(14,2) check (flat is null or flat >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.lb_commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  lead_id uuid not null unique references public.lb_leads(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  deal_value numeric(14,2) not null default 0,
  pct numeric(6,3) not null default 0,
  flat numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  manual boolean not null default false,      -- amount edited by an admin: trigger leaves it alone
  note text not null default '',
  won_at timestamptz,
  approved_by uuid references public.lb_profiles(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  paid_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_commissions_company on public.lb_commissions (company_id, won_at desc);
create index if not exists lb_commissions_user on public.lb_commissions (company_id, user_id, status);

alter table public.lb_commission_settings enable row level security;
alter table public.lb_commission_rates enable row level security;
alter table public.lb_commissions enable row level security;
revoke all on public.lb_commission_settings from anon, authenticated;
revoke all on public.lb_commission_rates from anon, authenticated;
revoke all on public.lb_commissions from anon;
revoke insert, update, delete on public.lb_commissions from authenticated;
grant select on public.lb_commissions to authenticated;
drop policy if exists lb_commissions_read on public.lb_commissions;
create policy lb_commissions_read on public.lb_commissions for select to authenticated
  using (company_id = public.lb_my_company() and user_id = any(coalesce(public.lb_visible_user_ids(), '{}')));
drop policy if exists lb_paid on public.lb_commissions;
create policy lb_paid on public.lb_commissions as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Recomputes the commission of one lead. Never touches approved/paid/manual rows.
create or replace function public.lb__commission_sync(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l lb_leads; s lb_commission_settings; r lb_commission_rates; c lb_commissions;
        v_user uuid; v_pct numeric; v_flat numeric; v_amt numeric(14,2); v_val numeric(14,2);
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;
  select * into c from lb_commissions where lead_id = p_lead;
  select * into s from lb_commission_settings where company_id = l.company_id;

  -- Not (or no longer) a won deal: cancel a pending commission.
  if l.status_category <> 'won' or l.deleted_at is not null then
    if c.id is not null and c.status = 'pending' then
      update lb_commissions set status = 'cancelled', note = case when note = '' then 'Lead is no longer Won' else note end, updated_at = now() where id = c.id;
    end if;
    return;
  end if;
  if s.company_id is null or not s.enabled then return; end if;
  if c.id is not null and (c.status in ('approved','paid') or c.manual) then return; end if;

  v_user := coalesce(l.converted_owner_id, l.owner_id);
  if v_user is null then return; end if;
  select * into r from lb_commission_rates where company_id = l.company_id and user_id = v_user;
  v_val := coalesce(l.won_value, 0);
  v_pct := coalesce(r.pct, s.default_pct, 0);
  v_flat := coalesce(r.flat, s.flat_per_deal, 0);
  v_amt := round(v_val * v_pct / 100 + v_flat, 2);

  if c.id is null then
    if v_amt <= 0 then return; end if;
    insert into lb_commissions (company_id, lead_id, user_id, deal_value, pct, flat, amount, won_at)
    values (l.company_id, l.id, v_user, v_val, v_pct, v_flat, v_amt, coalesce(l.closed_at, now()));
  else
    update lb_commissions set user_id = v_user, deal_value = v_val, pct = v_pct, flat = v_flat, amount = v_amt,
      status = case when v_amt <= 0 then 'cancelled' else 'pending' end,
      note = case when note = 'Lead is no longer Won' then '' else note end,
      won_at = coalesce(l.closed_at, won_at, now()), updated_at = now()
    where id = c.id;
  end if;
end $$;
revoke all on function public.lb__commission_sync(uuid) from public, anon, authenticated;
grant execute on function public.lb__commission_sync(uuid) to service_role;

-- Lead trigger. A commission problem must never block saving a lead.
create or replace function public.lb__lead_commission_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status_category is not distinct from old.status_category
     and new.won_value is not distinct from old.won_value
     and new.converted_owner_id is not distinct from old.converted_owner_id
     and new.owner_id is not distinct from old.owner_id
     and new.deleted_at is not distinct from old.deleted_at then
    return null;
  end if;
  if new.status_category <> 'won' and (tg_op = 'INSERT' or old.status_category <> 'won')
     and not exists (select 1 from lb_commissions where lead_id = new.id) then
    return null;
  end if;
  begin
    perform lb__commission_sync(new.id);
  exception when others then
    raise warning 'lb commission sync failed for lead %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists lb_lead_commission on public.lb_leads;
create trigger lb_lead_commission after insert or update on public.lb_leads
  for each row execute function public.lb__lead_commission_trg();

-- Adds/refreshes commissions for leads won on or after p_from (admin of the active company).
create or replace function public.lb_commission_backfill(p_from date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_company uuid := lb_my_company(); v_id uuid; n integer := 0;
begin
  if v_company is null or not lb_is_admin_of(v_company) then raise exception 'Not permitted' using errcode = '42501'; end if;
  for v_id in select id from lb_leads where company_id = v_company and status_category = 'won' and deleted_at is null
              and closed_at >= (p_from::timestamp at time zone 'Asia/Kolkata') loop
    perform lb__commission_sync(v_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_commission_backfill(date) from public, anon;
grant execute on function public.lb_commission_backfill(date) to authenticated, service_role;

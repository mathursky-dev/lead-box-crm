-- Profit & Loss report (/profit-loss, admins only).
--
--   lb_pl_entries  ad cost and sale entries, one amount per day.
--                  origin 'manual' = typed in by an admin (any channel: Meta, Google, other)
--                  origin 'meta'   = daily ad spend pulled from the Meta Marketing API
--                                    (one row per ad account per day, written by the
--                                    server with the service role, never by users)
--   lb_pl_sync     when Meta spend was last pulled for a company (service role only)
--   lb_profit_loss(from, to)  totals, day-wise and source-wise breakdown.
--                  Sales = won value of leads won in the range (lb_leads.won_value by
--                  closed_at, IST) + manual sale entries. Profit = sales - ad cost.
--
-- Everything is scoped to lb_my_company(), so a Super Admin sees only the company that
-- is switched in the top bar. Idempotent: safe to run more than once.

create table if not exists public.lb_pl_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete cascade,
  kind text not null check (kind in ('ad_cost','sale')),
  entry_date date not null,
  amount numeric(14,2) not null check (amount >= 0 and amount < 1000000000000),
  channel text not null default 'other' check (channel in ('meta','google','other')),
  source_id uuid references public.lb_sources(id) on delete set null,
  note text not null default '' check (length(note) <= 500),
  origin text not null default 'manual' check (origin in ('manual','meta')),
  ext_ref text,      -- Meta ad account id (act_123) for origin 'meta'
  ext_name text,     -- Meta ad account name
  currency text,     -- ad account currency for origin 'meta'
  created_by uuid default auth.uid() references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_pl_entries_company_day on public.lb_pl_entries (company_id, entry_date);
create unique index if not exists lb_pl_entries_meta_uq on public.lb_pl_entries (company_id, ext_ref, entry_date) where origin = 'meta';

create table if not exists public.lb_pl_sync (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  synced_at timestamptz,
  synced_from date,
  synced_to date,
  accounts int not null default 0,
  error text
);

-- Checks on every user write: users only write manual rows of their own company.
create or replace function public.lb__pl_entry_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then          -- service role (Meta sync) has no auth.uid()
    new.origin := 'manual'; new.ext_ref := null; new.ext_name := null; new.currency := null;
    if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now();
    else new.company_id := old.company_id; new.created_by := old.created_by; new.created_at := old.created_at; end if;
  end if;
  new.note := trim(coalesce(new.note, ''));
  new.updated_at := now();
  if new.source_id is not null and not exists (select 1 from lb_sources where id = new.source_id and company_id = new.company_id) then
    raise exception 'Source not found in this company';
  end if;
  return new;
end $$;
drop trigger if exists lb_pl_entries_write on public.lb_pl_entries;
create trigger lb_pl_entries_write before insert or update on public.lb_pl_entries
  for each row execute function public.lb__pl_entry_write();

alter table public.lb_pl_entries enable row level security;
alter table public.lb_pl_sync enable row level security;   -- no policies: service role only

drop policy if exists lb_pl_entries_select on public.lb_pl_entries;
create policy lb_pl_entries_select on public.lb_pl_entries for select to authenticated
  using (company_id = lb_my_company() and lb_is_admin_of(company_id));
drop policy if exists lb_pl_entries_insert on public.lb_pl_entries;
create policy lb_pl_entries_insert on public.lb_pl_entries for insert to authenticated
  with check (company_id = lb_my_company() and lb_is_admin_of(company_id) and origin = 'manual');
drop policy if exists lb_pl_entries_update on public.lb_pl_entries;
create policy lb_pl_entries_update on public.lb_pl_entries for update to authenticated
  using (company_id = lb_my_company() and lb_is_admin_of(company_id) and origin = 'manual')
  with check (company_id = lb_my_company() and origin = 'manual');
drop policy if exists lb_pl_entries_delete on public.lb_pl_entries;
create policy lb_pl_entries_delete on public.lb_pl_entries for delete to authenticated
  using (company_id = lb_my_company() and lb_is_admin_of(company_id) and origin = 'manual');

grant select, insert, update, delete on public.lb_pl_entries to authenticated;
revoke all on public.lb_pl_sync from anon, authenticated;

-- The report. p_from / p_to are inclusive IST dates (max 400 days).
create or replace function public.lb_profit_loss(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_co uuid := lb_my_company();
  v_start timestamptz; v_end timestamptz;
  v_out jsonb;
begin
  if v_co is null or not lb_is_admin_of(v_co) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid date range'; end if;
  if p_to - p_from > 400 then raise exception 'Choose a range of 400 days or less'; end if;
  v_start := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_end := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');

  with won as (
    select (l.closed_at at time zone 'Asia/Kolkata')::date d, l.source_id, coalesce(l.won_value, 0) amt
    from lb_leads l
    where l.company_id = v_co and l.status_category = 'won' and l.deleted_at is null
      and l.closed_at >= v_start and l.closed_at < v_end
  ), ent as (
    select e.entry_date d, e.source_id, e.kind, e.origin, e.amount amt
    from lb_pl_entries e
    where e.company_id = v_co and e.entry_date between p_from and p_to
  ), days as (
    select d,
      sum(amt) filter (where src = 'ad') ad,
      sum(amt) filter (where src in ('won','sale')) sales
    from (select d, amt, 'won' src from won
          union all select d, amt, case when kind = 'ad_cost' then 'ad' else 'sale' end from ent) x
    group by d
  ), srcs as (
    select source_id,
      coalesce(sum(amt) filter (where src = 'ad'), 0) ad,
      coalesce(sum(amt) filter (where src in ('won','sale')), 0) sales,
      count(*) filter (where src = 'won') won
    from (select source_id, amt, 'won' src from won
          union all select source_id, amt, case when kind = 'ad_cost' then 'ad' else 'sale' end from ent) x
    group by source_id
  )
  select jsonb_build_object(
    'ad_meta',      (select coalesce(sum(amt), 0) from ent where kind = 'ad_cost' and origin = 'meta'),
    'ad_manual',    (select coalesce(sum(amt), 0) from ent where kind = 'ad_cost' and origin = 'manual'),
    'sales_won',    (select coalesce(sum(amt), 0) from won),
    'won_count',    (select count(*) from won),
    'sales_manual', (select coalesce(sum(amt), 0) from ent where kind = 'sale'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'ad', coalesce(ad, 0), 'sales', coalesce(sales, 0)) order by d) from days), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source_id', s.source_id, 'name', coalesce(so.name, 'No source'),
                 'ad', s.ad, 'sales', s.sales, 'won', s.won) order by s.sales desc, s.ad desc)
               from srcs s left join lb_sources so on so.id = s.source_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.lb_profit_loss(date, date) from public, anon;
grant execute on function public.lb_profit_loss(date, date) to authenticated;

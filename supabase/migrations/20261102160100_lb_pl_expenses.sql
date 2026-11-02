-- Profit & Loss: approved team expenses (Field Force expense claims) count as a cost.
--
-- Expenses = lb_expenses with status approved or paid, by expense_date (IST date the agent chose).
-- Pending / rejected claims are not counted (pending total is returned for a note on the page).
-- Profit on the page = sales - ad cost - team expenses. ROAS stays sales / ad cost.
-- New keys: expenses, expense_count, expenses_pending, pending_count, expense_cats, expense_users,
-- and days[].exp. Older keys unchanged.
-- Needs 20261102000071_lb_profit_loss_payments.sql and 20261102040000_lb_field_force.sql.
-- Idempotent: safe to run more than once.

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

  with paid as (
    select (pl.paid_at at time zone 'Asia/Kolkata')::date d, l.source_id, pl.amount_paid amt
    from lb_payment_links pl join lb_leads l on l.id = pl.lead_id
    where pl.company_id = v_co and pl.amount_paid > 0 and l.deleted_at is null
      and pl.paid_at >= v_start and pl.paid_at < v_end
  ), won as (
    select (l.closed_at at time zone 'Asia/Kolkata')::date d, l.source_id, coalesce(l.won_value, 0) amt
    from lb_leads l
    where l.company_id = v_co and l.status_category = 'won' and l.deleted_at is null
      and l.closed_at >= v_start and l.closed_at < v_end
      and not exists (select 1 from lb_payment_links pl where pl.lead_id = l.id and pl.amount_paid > 0)
  ), ent as (
    select e.entry_date d, e.source_id, e.kind, e.origin, e.amount amt
    from lb_pl_entries e
    where e.company_id = v_co and e.entry_date between p_from and p_to
  ), exp as (
    select x.expense_date d, x.category, x.user_id, x.amount amt
    from lb_expenses x
    where x.company_id = v_co and x.status in ('approved','paid') and x.expense_date between p_from and p_to
  ), allrows as (
    select d, source_id, amt, 'won' src from won
    union all select d, source_id, amt, 'paid' from paid
    union all select d, source_id, amt, case when kind = 'ad_cost' then 'ad' else 'sale' end from ent
  ), days as (
    select d, sum(ad) ad, sum(sales) sales, sum(ex) ex from (
      select d, case when src = 'ad' then amt end ad, case when src <> 'ad' then amt end sales, null::numeric ex from allrows
      union all select d, null, null, amt from exp
    ) z group by d
  ), srcs as (
    select source_id,
      coalesce(sum(amt) filter (where src = 'ad'), 0) ad,
      coalesce(sum(amt) filter (where src <> 'ad'), 0) sales,
      count(*) filter (where src = 'won') won,
      count(*) filter (where src = 'paid') paid
    from allrows group by source_id
  )
  select jsonb_build_object(
    'ad_meta',      (select coalesce(sum(amt), 0) from ent where kind = 'ad_cost' and origin = 'meta'),
    'ad_manual',    (select coalesce(sum(amt), 0) from ent where kind = 'ad_cost' and origin = 'manual'),
    'sales_won',    (select coalesce(sum(amt), 0) from won),
    'won_count',    (select count(*) from won),
    'sales_paid',   (select coalesce(sum(amt), 0) from paid),
    'paid_count',   (select count(*) from paid),
    'sales_manual', (select coalesce(sum(amt), 0) from ent where kind = 'sale'),
    'expenses',     (select coalesce(sum(amt), 0) from exp),
    'expense_count', (select count(*) from exp),
    'expenses_pending', (select coalesce(sum(amount), 0) from lb_expenses where company_id = v_co and status = 'pending' and expense_date between p_from and p_to),
    'pending_count', (select count(*) from lb_expenses where company_id = v_co and status = 'pending' and expense_date between p_from and p_to),
    'expense_cats', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', a, 'count', c) order by a desc)
               from (select category, sum(amt) a, count(*) c from exp group by category) q), '[]'::jsonb),
    'expense_users', coalesce((select jsonb_agg(jsonb_build_object('user_id', q.user_id, 'name', coalesce(p.full_name, '—'), 'amount', q.a, 'count', q.c) order by q.a desc)
               from (select user_id, sum(amt) a, count(*) c from exp group by user_id) q left join lb_profiles p on p.id = q.user_id), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'ad', coalesce(ad, 0), 'sales', coalesce(sales, 0), 'exp', coalesce(ex, 0)) order by d) from days), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source_id', s.source_id, 'name', coalesce(so.name, 'No source'),
                 'ad', s.ad, 'sales', s.sales, 'won', s.won, 'paid', s.paid) order by s.sales desc, s.ad desc)
               from srcs s left join lb_sources so on so.id = s.source_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.lb_profit_loss(date, date) from public, anon;
grant execute on function public.lb_profit_loss(date, date) to authenticated;

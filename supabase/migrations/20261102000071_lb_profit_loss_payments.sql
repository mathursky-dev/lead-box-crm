-- Profit & Loss: count online payments (Razorpay payment links on quotations /
-- invoices, lb_payment_links) in sales.
--
-- Sales = payments received in the range (lb_payment_links.amount_paid by paid_at, IST)
--       + won value of leads won in the range that have NO received payment
--         (a paid link marks the lead Won with the invoice total, so counting both
--          would double the sale)
--       + manual sale entries.
-- Needs 20261102000053_lb_quotes_payments.sql and 20261102000070_lb_profit_loss.sql.
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
  ), allrows as (
    select d, source_id, amt, 'won' src from won
    union all select d, source_id, amt, 'paid' from paid
    union all select d, source_id, amt, case when kind = 'ad_cost' then 'ad' else 'sale' end from ent
  ), days as (
    select d, sum(amt) filter (where src = 'ad') ad, sum(amt) filter (where src <> 'ad') sales
    from allrows group by d
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
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'ad', coalesce(ad, 0), 'sales', coalesce(sales, 0)) order by d) from days), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source_id', s.source_id, 'name', coalesce(so.name, 'No source'),
                 'ad', s.ad, 'sales', s.sales, 'won', s.won, 'paid', s.paid) order by s.sales desc, s.ad desc)
               from srcs s left join lb_sources so on so.id = s.source_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.lb_profit_loss(date, date) from public, anon;
grant execute on function public.lb_profit_loss(date, date) to authenticated;

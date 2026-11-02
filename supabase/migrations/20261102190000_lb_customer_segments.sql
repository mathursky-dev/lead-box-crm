-- Automatic customer segments (VIP, repeat buyers, inactive, ...) for broadcasts.
--
--   1. lb_customer_segment_settings: per-company thresholds (one row, defaults
--      used when the row is missing).
--   2. lb__customer_stats(company): purchases per customer, counted once each:
--        * store orders (not cancelled, not refunded, confirmed+ or paid)
--        * paid invoices (lb_quotes kind = invoice)
--        * won leads that have neither a counted order nor a paid invoice
--      plus first/last purchase, last inbound WhatsApp message.
--   3. lb__smart_customers(company, keys): customers in any of the segments.
--   4. lb__rule_leads gains rules.smart = ["vip","repeat",...]: the broadcast
--      builder and saved segments can target a smart segment. Picking one also
--      includes won/lost leads (buyers sit on won leads); invalid leads stay out.
--   5. RPCs for the Segments page: lb_customer_segments(), lb_customer_segment_members(key),
--      lb_save_customer_segment_settings(p). All need campaigns.manage and are
--      scoped to the caller's (acting) company.
-- Nothing existing changes behaviour: rules without "smart" match exactly as before.

-- ------------------------------------------------------------ 1. settings
create table if not exists public.lb_customer_segment_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  vip_min_spend numeric(14,2) not null default 25000 check (vip_min_spend >= 0),
  vip_min_orders int not null default 5 check (vip_min_orders between 1 and 1000),
  repeat_min_orders int not null default 2 check (repeat_min_orders between 2 and 1000),
  new_buyer_days int not null default 30 check (new_buyer_days between 1 and 3650),
  at_risk_days int not null default 90 check (at_risk_days between 1 and 3650),
  inactive_days int not null default 60 check (inactive_days between 1 and 3650),
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.lb_customer_segment_settings enable row level security;
revoke all on public.lb_customer_segment_settings from anon;
revoke insert, update, delete on public.lb_customer_segment_settings from authenticated;
grant select on public.lb_customer_segment_settings to authenticated;
drop policy if exists lb_customer_segment_settings_read on public.lb_customer_segment_settings;
create policy lb_customer_segment_settings_read on public.lb_customer_segment_settings for select to authenticated using (company_id = lb_my_company());
drop policy if exists lb_paid on public.lb_customer_segment_settings;
create policy lb_paid on public.lb_customer_segment_settings as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

create or replace function public.lb__segment_settings(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vip_min_spend', coalesce(s.vip_min_spend, 25000), 'vip_min_orders', coalesce(s.vip_min_orders, 5),
    'repeat_min_orders', coalesce(s.repeat_min_orders, 2), 'new_buyer_days', coalesce(s.new_buyer_days, 30),
    'at_risk_days', coalesce(s.at_risk_days, 90), 'inactive_days', coalesce(s.inactive_days, 60))
  from (select 1) d left join lb_customer_segment_settings s on s.company_id = p_company
$$;
revoke all on function public.lb__segment_settings(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ 2. stats
create or replace function public.lb__customer_stats(p_company uuid)
returns table (customer_id uuid, orders int, spent numeric, first_buy timestamptz, last_buy timestamptz,
               last_inbound timestamptz, last_seen timestamptz, birthday date)
language sql stable security definer set search_path = public as $$
  with
  o as (  -- store / WhatsApp / manual orders that really happened
    select o.customer_id, o.lead_id, o.total amount, o.created_at at
    from lb_orders o
    where o.company_id = p_company and o.customer_id is not null
      and o.status <> 'cancelled' and o.payment_status <> 'refunded'
      and (o.status in ('confirmed','packed','shipped','delivered') or o.payment_status = 'paid')),
  q as (  -- paid (fully or partly) invoices
    select coalesce(q.customer_id, l.customer_id) customer_id, q.lead_id,
           greatest(q.amount_paid, case when q.status = 'paid' then q.total else 0 end) amount,
           coalesce(q.paid_at, q.issue_date::timestamptz) at
    from lb_quotes q join lb_leads l on l.id = q.lead_id
    where q.company_id = p_company and q.kind = 'invoice' and q.status <> 'cancelled'
      and (q.status = 'paid' or q.amount_paid > 0)),
  w as (  -- won deals not already counted through an order or invoice
    select l.customer_id, coalesce(l.won_value, l.expected_value, 0) amount, coalesce(l.converted_at, l.closed_at, l.updated_at) at
    from lb_leads l
    where l.company_id = p_company and l.deleted_at is null and l.status_category = 'won'
      and not exists (select 1 from o where o.lead_id = l.id)
      and not exists (select 1 from q where q.lead_id = l.id)),
  b as (
    select x.customer_id, count(*)::int n, sum(coalesce(x.amount, 0)) spent, min(x.at) first_buy, max(x.at) last_buy
    from (select customer_id, amount, at from o union all select customer_id, amount, at from q union all select customer_id, amount, at from w) x
    group by x.customer_id),
  m as (
    select v.customer_id, max(v.last_inbound_at) last_inbound
    from lb_conversations v where v.company_id = p_company and v.last_inbound_at is not null
    group by v.customer_id),
  c as (  -- customers with at least one live, valid lead
    select cu.id, cu.created_at, cu.birthday
    from lb_customers cu
    where cu.company_id = p_company
      and exists (select 1 from lb_leads l where l.customer_id = cu.id and l.deleted_at is null and l.status_category <> 'invalid'))
  select c.id, coalesce(b.n, 0), coalesce(b.spent, 0), b.first_buy, b.last_buy, m.last_inbound,
         greatest(c.created_at, b.last_buy, m.last_inbound), c.birthday
  from c left join b on b.customer_id = c.id left join m on m.customer_id = c.id
$$;
revoke all on function public.lb__customer_stats(uuid) from public, anon, authenticated;

-- Segment keys, in display order.
create or replace function public.lb__smart_keys() returns text[]
language sql immutable as $$ select array['vip','repeat','new_buyer','one_time','at_risk','inactive','never_bought','birthday_month'] $$;

-- Which segments one customer's stats fall into.
create or replace function public.lb__smart_match(k text, s jsonb, orders int, spent numeric, first_buy timestamptz,
                                                  last_buy timestamptz, last_seen timestamptz, birthday date) returns boolean
language sql stable as $$
  select case k
    when 'vip' then orders > 0 and (spent >= (s->>'vip_min_spend')::numeric or orders >= (s->>'vip_min_orders')::int)
    when 'repeat' then orders >= (s->>'repeat_min_orders')::int
    when 'new_buyer' then orders > 0 and first_buy > now() - make_interval(days => (s->>'new_buyer_days')::int)
    when 'one_time' then orders = 1
    when 'at_risk' then orders > 0 and last_buy < now() - make_interval(days => (s->>'at_risk_days')::int)
    when 'inactive' then last_seen < now() - make_interval(days => (s->>'inactive_days')::int)
    when 'never_bought' then orders = 0
    when 'birthday_month' then birthday is not null and extract(month from birthday) = extract(month from (now() at time zone 'Asia/Kolkata'))
    else false end
$$;

-- ------------------------------------------------------------ 3. members
create or replace function public.lb__smart_customers(p_company uuid, p_keys jsonb) returns table (customer_id uuid)
language sql stable security definer set search_path = public as $$
  select st.customer_id
  from lb__customer_stats(p_company) st, (select lb__segment_settings(p_company) s) cfg
  where exists (select 1 from jsonb_array_elements_text(coalesce(p_keys, '[]')) k
                where lb__smart_match(k, cfg.s, st.orders, st.spent, st.first_buy, st.last_buy, st.last_seen, st.birthday))
$$;
revoke all on function public.lb__smart_customers(uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ 4. rule matching (+ smart)
-- Same as 20261102000061 (identical to prod), plus rules.smart.
create or replace function public.lb__rule_leads(p_company uuid, p_rules jsonb) returns table (lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  select x.lead_id, x.customer_id from (
    select distinct on (l.customer_id) l.id lead_id, l.customer_id, l.created_at
    from lb_leads l, (select coalesce(p_rules, '{}'::jsonb) rules) r
    where l.company_id = p_company and l.deleted_at is null
      and (coalesce((r.rules->>'include_closed')::boolean, false) or not lb__closed(l.status_category)
           or (jsonb_array_length(coalesce(r.rules->'smart','[]')) > 0 and l.status_category <> 'invalid'))
      and (jsonb_array_length(coalesce(r.rules->'smart','[]')) = 0 or l.customer_id in (select sc.customer_id from lb__smart_customers(p_company, r.rules->'smart') sc))
      and (jsonb_array_length(coalesce(r.rules->'categories','[]')) = 0 or l.status_category in (select jsonb_array_elements_text(r.rules->'categories')))
      and (jsonb_array_length(coalesce(r.rules->'status_ids','[]')) = 0 or l.status_id::text in (select jsonb_array_elements_text(r.rules->'status_ids')))
      and (jsonb_array_length(coalesce(r.rules->'sub_status_ids','[]')) = 0 or l.sub_status_id::text in (select jsonb_array_elements_text(r.rules->'sub_status_ids')))
      and (jsonb_array_length(coalesce(r.rules->'product_ids','[]')) = 0 or l.product_id::text in (select jsonb_array_elements_text(r.rules->'product_ids')))
      and (jsonb_array_length(coalesce(r.rules->'source_ids','[]')) = 0 or l.source_id::text in (select jsonb_array_elements_text(r.rules->'source_ids')))
      and (jsonb_array_length(coalesce(r.rules->'tag_ids','[]')) = 0 or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id::text in (select jsonb_array_elements_text(r.rules->'tag_ids'))))
      and (jsonb_array_length(coalesce(r.rules->'owner_ids','[]')) = 0 or l.owner_id::text in (select jsonb_array_elements_text(r.rules->'owner_ids')))
      and (nullif(r.rules->>'number_id','') is null or l.number_id::text = r.rules->>'number_id')
      and (nullif(r.rules->>'priority','') is null or l.priority = any(string_to_array(r.rules->>'priority', ',')))
      and (nullif(r.rules->>'inactive_days','') is null or l.last_activity_at < now() - make_interval(days => (r.rules->>'inactive_days')::int))
      and (nullif(r.rules->>'created_within_days','') is null or l.created_at > now() - make_interval(days => (r.rules->>'created_within_days')::int))
      and (coalesce(r.rules->>'purchased','any') = 'any'
           or (r.rules->>'purchased' = 'yes') = exists (select 1 from lb_leads w where w.customer_id = l.customer_id and w.status_category = 'won' and w.deleted_at is null))
      and (coalesce(r.rules->>'replied_days','') = '' or exists (select 1 from lb_messages m join lb_conversations v on v.id = m.conversation_id
           where v.customer_id = l.customer_id and m.direction = 'in' and m.created_at > now() - make_interval(days => (r.rules->>'replied_days')::int)))
    order by l.customer_id, l.created_at desc
  ) x
$$;
revoke all on function public.lb__rule_leads(uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ 5. page RPCs
-- Counts per segment: customers, how many can get WhatsApp, total spend.
create or replace function public.lb_customer_segments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); cfg jsonb;
begin
  cfg := lb__segment_settings(me.company_id);
  return (
    with st as (
      select st.*, cu.wa_opt_in_at is not null and cu.wa_opted_out_at is null
               and not exists (select 1 from lb_suppressions x where x.company_id = me.company_id and x.phone_e164 = cu.phone_e164) reachable
      from lb__customer_stats(me.company_id) st join lb_customers cu on cu.id = st.customer_id),
    seg as (
      select k, ord from unnest(lb__smart_keys()) with ordinality u(k, ord))
    select jsonb_build_object(
      'settings', cfg,
      'customers', (select count(*) from st),
      'buyers', (select count(*) from st where orders > 0),
      'revenue', (select coalesce(sum(spent), 0) from st),
      'p90_spend', (select percentile_disc(0.9) within group (order by spent) from st where orders > 0),
      'segments', coalesce((select jsonb_agg(jsonb_build_object(
          'key', seg.k,
          'count', (select count(*) from st where lb__smart_match(seg.k, cfg, orders, spent, first_buy, last_buy, last_seen, birthday)),
          'reachable', (select count(*) from st where reachable and lb__smart_match(seg.k, cfg, orders, spent, first_buy, last_buy, last_seen, birthday)),
          'spent', (select coalesce(sum(spent), 0) from st where lb__smart_match(seg.k, cfg, orders, spent, first_buy, last_buy, last_seen, birthday)))
        order by seg.ord) from seg), '[]'))
  );
end $$;
revoke all on function public.lb_customer_segments() from public, anon;
grant execute on function public.lb_customer_segments() to authenticated;

-- Customers in one segment, biggest spenders first.
create or replace function public.lb_customer_segment_members(p_key text, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); cfg jsonb;
begin
  if not (p_key = any(lb__smart_keys())) then raise exception 'Unknown segment'; end if;
  cfg := lb__segment_settings(me.company_id);
  return coalesce((select jsonb_agg(row_to_json(x)) from (
    select cu.id customer_id, cu.name, cu.phone_e164, st.orders, st.spent, st.first_buy, st.last_buy, st.last_inbound, st.birthday,
           cu.wa_opt_in_at is not null and cu.wa_opted_out_at is null opted_in, cu.wa_opted_out_at is not null opted_out,
           ll.id lead_id, ll.lead_no
    from lb__customer_stats(me.company_id) st
    join lb_customers cu on cu.id = st.customer_id
    left join lateral (select l.id, l.lead_no from lb_leads l where l.customer_id = cu.id and l.deleted_at is null order by l.created_at desc limit 1) ll on true
    where lb__smart_match(p_key, cfg, st.orders, st.spent, st.first_buy, st.last_buy, st.last_seen, st.birthday)
    order by st.spent desc, st.last_seen desc nulls last
    limit greatest(1, least(coalesce(p_limit, 200), 1000))) x), '[]');
end $$;
revoke all on function public.lb_customer_segment_members(text, int) from public, anon;
grant execute on function public.lb_customer_segment_members(text, int) to authenticated;

create or replace function public.lb_save_customer_segment_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); cur jsonb;
begin
  cur := lb__segment_settings(me.company_id) || coalesce(p, '{}');
  insert into lb_customer_segment_settings (company_id, vip_min_spend, vip_min_orders, repeat_min_orders, new_buyer_days, at_risk_days, inactive_days, updated_by, updated_at)
  values (me.company_id, (cur->>'vip_min_spend')::numeric, (cur->>'vip_min_orders')::int, (cur->>'repeat_min_orders')::int,
          (cur->>'new_buyer_days')::int, (cur->>'at_risk_days')::int, (cur->>'inactive_days')::int, me.id, now())
  on conflict (company_id) do update set
    vip_min_spend = excluded.vip_min_spend, vip_min_orders = excluded.vip_min_orders, repeat_min_orders = excluded.repeat_min_orders,
    new_buyer_days = excluded.new_buyer_days, at_risk_days = excluded.at_risk_days, inactive_days = excluded.inactive_days,
    updated_by = me.id, updated_at = now();
  perform lb_audit(me.company_id, 'segment.settings', 'company', me.company_id::text, cur);
  return lb__segment_settings(me.company_id);
end $$;
revoke all on function public.lb_save_customer_segment_settings(jsonb) from public, anon;
grant execute on function public.lb_save_customer_segment_settings(jsonb) to authenticated;

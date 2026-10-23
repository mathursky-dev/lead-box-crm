-- 360 reports. Breakdowns reuse lb_metric_rows (same scope + rules as the
-- dashboard), so every report cell equals its drill-down list.

-- Metrics by a lead/user dimension. Lead dimensions group by the lead's
-- current attribute; 'user' groups by the credited user and 'team' by that
-- user's team (unattributed rows by the lead's team), matching the filters.
create or replace function lb_report(p jsonb, p_dim text) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select distinct on (m.metric, m.lead_id, m.user_id) m.metric, m.user_id, m.lead_id, m.amount
    from lb_metric_rows(p) m
    where m.metric in ('total_leads','current_assigned','new_allocations','worked','follow_up','converted','lost','invalid','cohort_allocated','cohort_won','untouched','overdue')
  ),
  k as (
    select r.*, case p_dim
      when 'source' then l.source_id when 'product' then l.product_id when 'number' then l.number_id
      when 'branch' then l.branch_id when 'department' then l.department_id when 'status' then l.status_id
      when 'user' then r.user_id
      when 'team' then case when r.user_id is null then l.team_id else u.team_id end end as key
    from r join lb_leads l on l.id = r.lead_id left join lb_profiles u on u.id = r.user_id
    where p_dim <> 'user' or r.user_id is not null
  ),
  agg as (
    select key, metric, count(distinct lead_id) n, sum(amount) amt from k group by key, metric
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select key, jsonb_object_agg(metric, n) metrics, coalesce(max(amt) filter (where metric = 'converted'), 0) won_value
    from agg group by key
  ) x
$$;

-- Daily trend (IST days): leads created, first allocations and conversions.
create or replace function lb_report_trend(p jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select distinct metric, lead_id, amount from lb_metric_rows(p) where metric in ('total_leads','converted','cohort_allocated')),
  d as (
    select (case r.metric when 'converted' then l.converted_at when 'cohort_allocated' then l.first_allocated_at else l.created_at end
            at time zone 'Asia/Kolkata')::date as day, r.metric, r.lead_id, r.amount
    from r join lb_leads l on l.id = r.lead_id
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.day), '[]'::jsonb) from (
    select day,
      count(distinct lead_id) filter (where metric = 'total_leads') created,
      count(distinct lead_id) filter (where metric = 'cohort_allocated') allocated,
      count(distinct lead_id) filter (where metric = 'converted') converted,
      coalesce(sum(amount) filter (where metric = 'converted'), 0) won_value
    from d group by day
  ) x
$$;

-- WhatsApp activity in the period. SECURITY INVOKER: RLS limits it to chats the caller can see.
create or replace function lb_report_messages(p jsonb) returns jsonb
language sql stable security invoker set search_path = public as $$
  with m as (
    select m.*, v.number_id from lb_messages m join lb_conversations v on v.id = m.conversation_id
    where m.created_at >= (p->>'from')::timestamptz and m.created_at < (p->>'to')::timestamptz
      and (nullif(p->>'number_id','') is null or v.number_id = (p->>'number_id')::uuid)
  )
  select jsonb_build_object(
    'inbound', (select count(*) from m where direction = 'in'),
    'outbound', (select count(*) from m where direction = 'out'),
    'delivered', (select count(*) from m where direction = 'out' and status in ('delivered','read')),
    'read', (select count(*) from m where direction = 'out' and status = 'read'),
    'failed', (select count(*) from m where direction = 'out' and status = 'failed'),
    'templates', (select count(*) from m where direction = 'out' and type = 'template'),
    'chats', (select count(distinct conversation_id) from m),
    'new_chats', (select count(*) from lb_conversations c where c.created_at >= (p->>'from')::timestamptz and c.created_at < (p->>'to')::timestamptz
                   and (nullif(p->>'number_id','') is null or c.number_id = (p->>'number_id')::uuid)),
    'by_number', coalesce((select jsonb_agg(row_to_json(x)) from (
        select number_id, count(*) filter (where direction = 'in') inbound, count(*) filter (where direction = 'out') outbound,
               count(*) filter (where direction = 'out' and status = 'failed') failed
        from m group by number_id) x), '[]')
  )
$$;

-- Customer directory with server-side search (RLS applies).
create or replace function lb_list_customers(p jsonb) returns jsonb
language sql stable security invoker set search_path = public as $$
  with q as (
    select c.*, (select count(*) from lb_leads l where l.customer_id = c.id) leads,
           (select max(l.last_activity_at) from lb_leads l where l.customer_id = c.id) last_activity,
           (select coalesce(sum(l.won_value),0) from lb_leads l where l.customer_id = c.id and l.status_category = 'won') won_value
    from lb_customers c
    where nullif(p->>'q','') is null
       or c.name ilike '%' || (p->>'q') || '%' or c.wa_profile_name ilike '%' || (p->>'q') || '%' or c.email ilike '%' || (p->>'q') || '%'
       or (regexp_replace(p->>'q','\D','','g') <> '' and c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%')
  )
  select jsonb_build_object('total', (select count(*) from q), 'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
    select id, name, wa_profile_name, phone_e164, email, location, wa_opted_out_at, leads, last_activity, won_value, created_at
    from q order by last_activity desc nulls last, created_at desc
    limit least(coalesce((p->>'limit')::int, 50), 200) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
$$;

revoke execute on function lb_report(jsonb,text), lb_report_trend(jsonb), lb_report_messages(jsonb), lb_list_customers(jsonb) from public, anon;
grant execute on function lb_report(jsonb,text), lb_report_trend(jsonb), lb_report_messages(jsonb), lb_list_customers(jsonb) to authenticated, service_role;

-- Reporting. lb_metric_rows is the single source for every dashboard number
-- AND its drill-down list, so card totals always equal list counts.
-- Each row = (metric, credited user, lead, amount). Counts are DISTINCT leads.

create or replace function lb_metric_rows(p jsonb)
returns table (metric text, user_id uuid, lead_id uuid, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  me lb_profiles := lb__me();
  v_company uuid := me.company_id;
  v_from timestamptz := coalesce(nullif(p->>'from','')::timestamptz, date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  v_to timestamptz := coalesce(nullif(p->>'to','')::timestamptz, v_from + interval '1 day');
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  f_user uuid := nullif(p->>'user_id','')::uuid;
  f_team uuid := nullif(p->>'team_id','')::uuid;
  f_branch uuid := nullif(p->>'branch_id','')::uuid;
  f_dept uuid := nullif(p->>'department_id','')::uuid;
  f_number uuid := nullif(p->>'number_id','')::uuid;
  f_product uuid := nullif(p->>'product_id','')::uuid;
  f_source uuid := nullif(p->>'source_id','')::uuid;
  f_status uuid := nullif(p->>'status_id','')::uuid;
  v_users uuid[]; v_teams uuid[]; v_unattributed boolean;
begin
  if me.role = 'super_admin' and nullif(p->>'company_id','') is not null then v_company := (p->>'company_id')::uuid; end if;
  -- Which users' numbers the caller may see.
  if me.role = 'agent' then v_users := array[me.id];
  elsif me.role = 'team_leader' then v_teams := lb_my_team_ids(); v_users := lb_visible_user_ids();
  end if;
  if f_user is not null then
    if v_users is not null and not f_user = any(v_users) then raise exception 'Not permitted' using errcode='42501'; end if;
    v_users := array[f_user];
  end if;
  if f_team is not null then
    if v_teams is not null and not f_team = any(v_teams) then raise exception 'Not permitted' using errcode='42501'; end if;
    v_users := array(select id from lb_profiles where company_id = v_company and team_id = f_team
                     and (v_users is null or id = any(v_users)));
    v_teams := array[f_team];
  end if;
  -- Unassigned / un-credited rows are visible to managers without a user filter.
  v_unattributed := f_user is null and me.role <> 'agent';

  return query
  with l as (
    select x.* from lb_leads x
    where x.company_id = v_company
      and (f_branch is null or x.branch_id = f_branch) and (f_dept is null or x.department_id = f_dept)
      and (f_number is null or x.number_id = f_number) and (f_product is null or x.product_id = f_product)
      and (f_source is null or x.source_id = f_source) and (f_status is null or x.status_id = f_status)
  ),
  ev as (
    select e.* from lb_lead_events e join l on l.id = e.lead_id
    where e.created_at >= v_from and e.created_at < v_to
  ),
  rows as (
    -- Unique leads created in period, credited to current owner.
    select 'total_leads'::text m, l.owner_id u, l.id lid, null::numeric amt, l.team_id tid from l
      where l.created_at >= v_from and l.created_at < v_to
    -- Current workload (not period-bound).
    union all select 'unassigned', null, l.id, null, l.team_id from l where l.owner_id is null and not lb__closed(l.status_category)
    union all select 'current_assigned', l.owner_id, l.id, null, l.team_id from l where l.owner_id is not null and not lb__closed(l.status_category)
    union all select 'untouched', l.owner_id, l.id, null, l.team_id from l
      where l.owner_id is not null and not lb__closed(l.status_category)
        and not exists (select 1 from lb_lead_events w where w.lead_id = l.id and w.is_work
                        and w.actor_id = l.owner_id and w.created_at >= l.assigned_at)
    union all select 'follow_up', l.owner_id, l.id, null, l.team_id from l where l.status_category = 'follow_up'
    union all select 'followups_due', f.assigned_to, l.id, null, l.team_id from l join lb_followups f on f.lead_id = l.id
      where f.status = 'pending' and f.due_at >= v_today and f.due_at < v_today + interval '1 day'
    union all select 'overdue', f.assigned_to, l.id, null, l.team_id from l join lb_followups f on f.lead_id = l.id
      where f.status = 'pending' and f.due_at < v_today
    union all select 'status:' || l.status_id, l.owner_id, l.id, null, l.team_id from l
    -- Allocation events in period (unique leads per user; transfers counted separately).
    union all select 'allocated', ev.to_user_id, ev.lead_id, null, null from ev where ev.type = 'assignment' and ev.to_user_id is not null
    union all select 'new_allocations', ev.to_user_id, ev.lead_id, null, null from ev
      where ev.type = 'assignment' and ev.to_user_id is not null and ev.from_user_id is null
    union all select 'transfers_in', ev.to_user_id, ev.lead_id, null, null from ev
      where ev.type = 'assignment' and ev.to_user_id is not null and ev.from_user_id is not null
    union all select 'transfers_out', ev.from_user_id, ev.lead_id, null, null from ev
      where ev.type = 'assignment' and ev.from_user_id is not null and ev.to_user_id is distinct from ev.from_user_id
    -- Worked = recorded agent action in period, credited to the actor.
    union all select 'worked', ev.actor_id, ev.lead_id, null, null from ev where ev.is_work and ev.actor_id is not null
    -- Period conversions: by conversion date, credited to owner at conversion.
    union all select 'converted', l.converted_owner_id, l.id, coalesce(l.won_value, 0), l.team_id from l
      where l.converted_at >= v_from and l.converted_at < v_to
    union all select 'lost', ev.owner_id, ev.lead_id, null, null from ev join l on l.id = ev.lead_id
      where ev.type = 'status_change' and ev.to_category = 'lost' and l.status_category = 'lost'
    union all select 'invalid', ev.owner_id, ev.lead_id, null, null from ev join l on l.id = ev.lead_id
      where ev.type = 'status_change' and ev.to_category = 'invalid' and l.status_category = 'invalid'
    -- Cohort: unique leads first allocated in period (credited to original owner), and those now won.
    union all select 'cohort_allocated', l.original_owner_id, l.id, null, l.team_id from l
      where l.first_allocated_at >= v_from and l.first_allocated_at < v_to
    union all select 'cohort_won', l.original_owner_id, l.id, null, l.team_id from l
      where l.first_allocated_at >= v_from and l.first_allocated_at < v_to and l.status_category = 'won'
    -- Opening Assigned: owner at period start (from history) with an open status at that moment.
    union all select 'opening_assigned', oa.owner_at, l.id, null, l.team_id from l
      cross join lateral (
        select (select e.to_user_id from lb_lead_events e where e.lead_id = l.id and e.type = 'assignment'
                  and e.created_at < v_from order by e.created_at desc limit 1) owner_at,
               (select e.to_category from lb_lead_events e where e.lead_id = l.id and e.type in ('created','status_change','repeat_created')
                  and e.created_at < v_from order by e.created_at desc limit 1) cat_at
      ) oa
      where l.created_at < v_from and oa.owner_at is not null and not lb__closed(coalesce(oa.cat_at, 'new'))
  )
  select r.m, r.u, r.lid, r.amt from rows r
  where (r.u is not null and (v_users is null or r.u = any(v_users)))
     or (r.u is null and v_unattributed and (v_teams is null or r.tid = any(v_teams)));
end $$;

-- Aggregated dashboard: totals per metric (distinct leads) + per-user rows.
create or replace function lb_dashboard(p jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select * from lb_metric_rows(p)),
  d as (select distinct on (metric, lead_id) metric, lead_id, amount from r order by metric, lead_id),
  du as (select distinct on (metric, user_id, lead_id) metric, user_id, lead_id from r where user_id is not null)
  select jsonb_build_object(
    'totals', coalesce((select jsonb_object_agg(metric, n) from (select metric, count(*) n from d group by metric) t), '{}'),
    'won_value', coalesce((select sum(amount) from d where metric = 'converted'), 0),
    'by_user', coalesce((select jsonb_object_agg(user_id, m) from (
        select user_id, jsonb_object_agg(metric, n) m from (select user_id, metric, count(*) n from du group by 1, 2) a group by user_id) b), '{}')
  )
$$;

-- Drill-down for one metric (optionally one credited user): same rows as the card.
create or replace function lb_metric_leads(p jsonb, p_metric text, p_user uuid default null,
  p_limit integer default 50, p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  with ids as (select distinct lead_id from lb_metric_rows(p) where metric = p_metric and (p_user is null or user_id = p_user))
  select jsonb_build_object(
    'total', (select count(*) from ids),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select l.id, l.lead_no, l.status_category, l.priority, l.expected_value, l.won_value, l.created_at, l.assigned_at,
             l.last_activity_at, l.next_followup_at, l.converted_at, l.owner_id,
             c.name customer_name, c.phone_e164, s.name status_name, o.full_name owner_name, pr.name product_name, so.name source_name
      from ids join lb_leads l on l.id = ids.lead_id join lb_customers c on c.id = l.customer_id
      join lb_lead_statuses s on s.id = l.status_id left join lb_profiles o on o.id = l.owner_id
      left join lb_products pr on pr.id = l.product_id left join lb_sources so on so.id = l.source_id
      order by l.last_activity_at desc limit least(p_limit, 200) offset p_offset) x), '[]')
  )
$$;

-- Lead list with server-side search/filters/pagination. SECURITY INVOKER: RLS applies.
create or replace function lb_list_leads(p jsonb) returns jsonb
language sql stable security invoker set search_path = public as $$
  with q as (
    select l.*, c.name customer_name, c.phone_e164, c.email, s.name status_name, o.full_name owner_name,
           pr.name product_name, so.name source_name
    from lb_leads l join lb_customers c on c.id = l.customer_id
    join lb_lead_statuses s on s.id = l.status_id left join lb_profiles o on o.id = l.owner_id
    left join lb_products pr on pr.id = l.product_id left join lb_sources so on so.id = l.source_id
    where (nullif(p->>'q','') is null
           or c.name ilike '%' || (p->>'q') || '%' or c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%'
              and regexp_replace(p->>'q','\D','','g') <> ''
           or c.email ilike '%' || (p->>'q') || '%' or ('LB-' || l.lead_no) ilike '%' || (p->>'q') || '%')
      and (nullif(p->>'status_id','') is null or l.status_id = (p->>'status_id')::uuid)
      and (nullif(p->>'category','') is null or l.status_category = p->>'category')
      and (nullif(p->>'owner_id','') is null or l.owner_id = (p->>'owner_id')::uuid)
      and (coalesce((p->>'unassigned')::boolean, false) = false or l.owner_id is null)
      and (coalesce((p->>'open_only')::boolean, false) = false or not lb__closed(l.status_category))
      and (nullif(p->>'branch_id','') is null or l.branch_id = (p->>'branch_id')::uuid)
      and (nullif(p->>'department_id','') is null or l.department_id = (p->>'department_id')::uuid)
      and (nullif(p->>'team_id','') is null or l.team_id = (p->>'team_id')::uuid)
      and (nullif(p->>'product_id','') is null or l.product_id = (p->>'product_id')::uuid)
      and (nullif(p->>'source_id','') is null or l.source_id = (p->>'source_id')::uuid)
      and (nullif(p->>'number_id','') is null or l.number_id = (p->>'number_id')::uuid)
      and (nullif(p->>'priority','') is null or l.priority = p->>'priority')
      and (nullif(p->>'tag_id','') is null or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id = (p->>'tag_id')::uuid))
      and (nullif(p->>'from','') is null or l.created_at >= (p->>'from')::timestamptz)
      and (nullif(p->>'to','') is null or l.created_at < (p->>'to')::timestamptz)
      and (nullif(p->>'followup','') is null
           or (p->>'followup' = 'today' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                 and f.due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'))
           or (p->>'followup' = 'overdue' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')))
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select id, lead_no, customer_id, customer_name, phone_e164, email, status_id, status_name, status_category, priority,
             owner_id, owner_name, product_name, source_name, expected_value, won_value, created_at, assigned_at,
             last_activity_at, next_followup_at, converted_at
      from q order by
        case when p->>'sort' = 'created' then created_at end desc,
        case when p->>'sort' = 'followup' then next_followup_at end asc nulls last,
        last_activity_at desc
      limit least(coalesce((p->>'limit')::int, 50), 500) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
$$;

create or replace function lb_list_conversations(p jsonb) returns jsonb
language sql stable security invoker set search_path = public as $$
  with q as (
    select v.*, c.name customer_name, c.wa_profile_name, c.phone_e164, c.wa_opted_out_at, a.full_name assignee_name,
           n.label number_label, l.lead_no, s.name lead_status
    from lb_conversations v join lb_customers c on c.id = v.customer_id
    join lb_wa_numbers n on n.id = v.number_id
    left join lb_profiles a on a.id = v.assignee_id
    left join lb_leads l on l.id = v.lead_id left join lb_lead_statuses s on s.id = l.status_id
    where (nullif(p->>'status','') is null or v.status = p->>'status')
      and (nullif(p->>'number_id','') is null or v.number_id = (p->>'number_id')::uuid)
      and (coalesce((p->>'mine')::boolean, false) = false or v.assignee_id = auth.uid())
      and (coalesce((p->>'unassigned')::boolean, false) = false or v.assignee_id is null)
      and (coalesce((p->>'unread')::boolean, false) = false or v.unread_count > 0)
      and (nullif(p->>'tag_id','') is null or exists (select 1 from lb_conversation_tags t where t.conversation_id = v.id and t.tag_id = (p->>'tag_id')::uuid))
      and (nullif(p->>'q','') is null
           or c.name ilike '%' || (p->>'q') || '%' or c.wa_profile_name ilike '%' || (p->>'q') || '%'
           or (regexp_replace(p->>'q','\D','','g') <> '' and c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%')
           or exists (select 1 from lb_messages m where m.conversation_id = v.id
                      and to_tsvector('simple', coalesce(m.body,'')) @@ plainto_tsquery('simple', p->>'q')))
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'unread_total', (select coalesce(sum(unread_count),0) from q),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select id, customer_id, customer_name, wa_profile_name, phone_e164, wa_opted_out_at, assignee_id, assignee_name, number_id, number_label,
             lead_id, lead_no, lead_status, status, unread_count, last_message_at, last_message_preview, last_inbound_at
      from q order by last_message_at desc nulls last
      limit least(coalesce((p->>'limit')::int, 30), 100) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
$$;

revoke execute on function lb_metric_rows(jsonb), lb_dashboard(jsonb), lb_metric_leads(jsonb,text,uuid,integer,integer),
  lb_list_leads(jsonb), lb_list_conversations(jsonb) from anon, public;
grant execute on function lb_metric_rows(jsonb), lb_dashboard(jsonb), lb_metric_leads(jsonb,text,uuid,integer,integer),
  lb_list_leads(jsonb), lb_list_conversations(jsonb) to authenticated;

-- Reminders every minute (pure SQL; no HTTP needed).
select cron.schedule('lb-followup-reminders', '* * * * *', 'select public.lb_run_reminders()');

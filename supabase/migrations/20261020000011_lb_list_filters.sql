-- Lead list: multi-priority filter (e.g. high,urgent) and 14-day stale filter for the day brief.
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
      and (nullif(p->>'priority','') is null or l.priority = any(string_to_array(p->>'priority', ',')))
      and (coalesce((p->>'stale')::boolean, false) = false or l.last_activity_at < now() - interval '14 days')
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

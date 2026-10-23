-- Post-login "day brief". SECURITY INVOKER: RLS scopes it (agent = own leads,
-- team leader = permitted teams, admin = company). Times use Asia/Kolkata.
create or replace function lb_day_brief() returns jsonb
language sql stable security invoker set search_path = public as $$
  with t as (
    select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as d0
  ),
  scope as (select lb_my_role() in ('agent') as mine),
  open_leads as (
    select l.* from lb_leads l, scope
    where not lb__closed(l.status_category) and (not scope.mine or l.owner_id = auth.uid())
  ),
  fu as (
    select f.lead_id, f.due_at from lb_followups f, scope
    where f.status = 'pending' and (not scope.mine or f.assigned_to = auth.uid())
  ),
  overdue as (select distinct lead_id from fu, t where fu.due_at < t.d0),
  today as (select distinct lead_id from fu, t where fu.due_at >= t.d0 and fu.due_at < t.d0 + interval '1 day'),
  stale as (select id from open_leads where last_activity_at < now() - interval '14 days'),
  top as (
    select l.id, l.lead_no, l.priority, l.expected_value, l.last_activity_at, c.name customer_name, c.phone_e164,
      case when l.id in (select lead_id from overdue) then 'Overdue follow-up'
           when l.id in (select lead_id from today) then 'Follow-up due today'
           when l.priority in ('urgent','high') then initcap(l.priority) || ' priority'
           when l.owner_id is null then 'Unassigned'
           else 'No activity for 14+ days' end reason,
      case when l.id in (select lead_id from overdue) then 1 when l.id in (select lead_id from today) then 2
           when l.priority = 'urgent' then 3 when l.priority = 'high' then 4 else 5 end rank
    from open_leads l join lb_customers c on c.id = l.customer_id
    where l.id in (select lead_id from overdue) or l.id in (select lead_id from today)
       or l.priority in ('urgent','high') or l.id in (select id from stale)
  )
  select jsonb_build_object(
    'high_priority', (select count(*) from open_leads where priority in ('urgent','high')),
    'overdue', (select count(*) from overdue),
    'due_today', (select count(*) from today),
    'stale', (select count(*) from stale),
    'pipeline', (select coalesce(sum(expected_value), 0) from open_leads),
    'open_leads', (select count(*) from open_leads),
    'unread_chats', (select count(*) from lb_conversations v, scope where v.unread_count > 0 and (not scope.mine or v.assignee_id = auth.uid())),
    'scope', (select case when mine then 'mine' else 'team' end from scope),
    'top', coalesce((select jsonb_agg(row_to_json(x)) from (select * from top order by rank, last_activity_at limit 5) x), '[]'),
    'closed_statuses', coalesce((select jsonb_agg(name order by sort_order) from lb_lead_statuses
                                  where company_id = lb_my_company() and lb__closed(category) and is_active), '[]')
  )
$$;
revoke execute on function lb_day_brief() from public, anon;
grant execute on function lb_day_brief() to authenticated;

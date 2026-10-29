-- Day brief v2: "your" numbers (leads you own, follow-ups assigned to you) plus an
-- "across your team" panel for admins and team leaders. SECURITY INVOKER, so RLS
-- still decides what a team leader sees; every query is also pinned to the
-- caller's company because super admin RLS can read all companies.
-- Untouched = last_activity_at older than 14 days (same rule as the leads list stale filter).
-- Times use Asia/Kolkata.
create or replace function lb_day_brief() returns jsonb
language sql stable security invoker set search_path = public as $$
  with t as (
    select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as d0
  ),
  me as (select auth.uid() uid, lb_my_company() cid, coalesce(lb_my_role(), 'agent') <> 'agent' as team),
  co_leads as (select l.* from lb_leads l, me where l.company_id = me.cid),
  co_open as (select * from co_leads where not lb__closed(status_category)),
  co_fu as (select f.* from lb_followups f, me where f.company_id = me.cid and f.status = 'pending'),
  my_open as (select l.* from co_open l, me where l.owner_id = me.uid),
  my_fu as (select f.* from co_fu f, me where f.assigned_to = me.uid),
  my_overdue as (select f.* from my_fu f, t where f.due_at < now()),
  my_today as (select f.* from my_fu f, t where f.due_at >= now() and f.due_at < t.d0 + interval '1 day'),
  my_stale as (select id from my_open where last_activity_at < now() - interval '14 days'),
  top as (
    select l.id, l.lead_no, l.priority, l.expected_value, l.last_activity_at, c.name customer_name, c.phone_e164,
      case when l.id in (select lead_id from my_overdue) then 'Overdue follow-up'
           when l.id in (select lead_id from my_today) then 'Follow-up due today'
           when l.priority in ('urgent','high') then initcap(l.priority) || ' priority'
           else 'No activity for 14+ days' end reason,
      case when l.id in (select lead_id from my_overdue) then 1 when l.id in (select lead_id from my_today) then 2
           when l.priority = 'urgent' then 3 when l.priority = 'high' then 4 else 5 end rank
    from my_open l join lb_customers c on c.id = l.customer_id
    where l.id in (select lead_id from my_overdue) or l.id in (select lead_id from my_today)
       or l.priority in ('urgent','high') or l.id in (select id from my_stale)
  )
  select jsonb_build_object(
    'scope', 'mine',
    'high_priority', (select count(*) from my_open where priority in ('urgent','high')),
    'overdue', (select count(*) from my_overdue),
    'overdue_leads', (select count(distinct lead_id) from my_overdue),
    'due_today', (select count(*) from my_today),
    'due_today_leads', (select count(distinct lead_id) from my_today),
    'stale', (select count(*) from my_stale),
    'pipeline', (select coalesce(sum(expected_value), 0) from my_open),
    'open_leads', (select count(*) from my_open),
    'unread_chats', (select count(*) from lb_conversations v, me where v.company_id = me.cid and v.unread_count > 0
                       and (v.assignee_id = me.uid or (me.team and v.assignee_id is null))),
    'top', coalesce((select jsonb_agg(row_to_json(x)) from (select * from top order by rank, last_activity_at nulls first limit 5) x), '[]'),
    'closed_statuses', coalesce((select jsonb_agg(s.name order by s.sort_order) from lb_lead_statuses s, me
                                  where s.company_id = me.cid and lb__closed(s.category) and s.is_active), '[]'),
    'team', case when (select team from me) then jsonb_build_object(
      'new_yesterday', (select count(*) from co_leads, t where created_at >= t.d0 - interval '1 day' and created_at < t.d0),
      'updated_yesterday', (select count(distinct e.lead_id) from lb_lead_events e, me, t
                             where e.company_id = me.cid and e.type not in ('created', 'message_in')
                               and e.created_at >= t.d0 - interval '1 day' and e.created_at < t.d0),
      'converted_yesterday', (select count(*) from co_leads, t where converted_at >= t.d0 - interval '1 day' and converted_at < t.d0),
      'overdue', (select count(*) from co_fu where due_at < now()),
      'unassigned', (select count(*) from co_open where owner_id is null),
      'high_priority', (select count(*) from co_open where priority in ('urgent','high')),
      'stale', (select count(*) from co_open where last_activity_at < now() - interval '14 days'),
      'open_leads', (select count(*) from co_open),
      'pipeline', (select coalesce(sum(expected_value), 0) from co_open)
    ) end
  )
$$;
revoke execute on function lb_day_brief() from public, anon;
grant execute on function lb_day_brief() to authenticated;

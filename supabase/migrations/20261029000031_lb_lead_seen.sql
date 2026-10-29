-- Seen / Unseen: has the lead's current owner opened the lead yet?
-- owner_seen_at is set the first time the owner opens the lead page and is
-- cleared whenever the lead moves to another owner, so new and reassigned
-- leads start unseen. A lead the owner creates or self-assigns starts seen.

alter table public.lb_leads add column if not exists owner_seen_at timestamptz;
create index if not exists lb_leads_owner_unseen on public.lb_leads (company_id, owner_id)
  where owner_id is not null and owner_seen_at is null;

create or replace function public.lb__lead_owner_seen() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then return new; end if;
  new.owner_seen_at := case when new.owner_id is not null and new.owner_id = auth.uid() then now() end;
  return new;
end $$;
drop trigger if exists lb_leads_owner_seen on public.lb_leads;
create trigger lb_leads_owner_seen before insert or update of owner_id on public.lb_leads
  for each row execute function public.lb__lead_owner_seen();

-- Called when a user opens a lead. Only the owner's first open counts; it
-- does not touch last_activity_at or the history.
create or replace function public.lb_mark_lead_seen(p_lead uuid)
returns void language sql security definer set search_path = public as $$
  update lb_leads set owner_seen_at = now()
  where id = p_lead and owner_id = auth.uid() and owner_seen_at is null;
$$;
revoke all on function public.lb_mark_lead_seen(uuid) from public, anon;
grant execute on function public.lb_mark_lead_seen(uuid) to authenticated;

-- Existing leads: count as seen if the owner has already worked on them
-- since they were assigned; everything else starts unseen.
update public.lb_leads l set owner_seen_at = coalesce(l.assigned_at, l.created_at)
where l.owner_id is not null and l.owner_seen_at is null
  and exists (select 1 from public.lb_lead_events e where e.lead_id = l.id and e.actor_id = l.owner_id
              and e.created_at >= coalesce(l.assigned_at, l.created_at));

-- ------------------------------------------------------------ leads list
-- Same as before plus the seen filter ('seen' / 'unseen') and owner_seen_at.
create or replace function public.lb_list_leads(p jsonb)
returns jsonb language sql stable set search_path = public as $$
  with q as (
    select l.*, c.name customer_name, c.phone_e164, c.email, s.name status_name, ss.name sub_status_name, o.full_name owner_name,
           pr.name product_name, so.name source_name
    from lb_leads l join lb_customers c on c.id = l.customer_id
    join lb_lead_statuses s on s.id = l.status_id left join lb_profiles o on o.id = l.owner_id
    left join lb_lead_sub_statuses ss on ss.id = l.sub_status_id
    left join lb_products pr on pr.id = l.product_id left join lb_sources so on so.id = l.source_id
    where (nullif(p->>'q','') is null
           or c.name ilike '%' || (p->>'q') || '%' or c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%'
              and regexp_replace(p->>'q','\D','','g') <> ''
           or c.email ilike '%' || (p->>'q') || '%' or ('LB-' || l.lead_no) ilike '%' || (p->>'q') || '%')
      and (nullif(p->>'status_id','') is null or l.status_id = (p->>'status_id')::uuid)
      and (nullif(p->>'sub_status_id','') is null or l.sub_status_id = (p->>'sub_status_id')::uuid)
      and (nullif(p->>'category','') is null or l.status_category = p->>'category')
      and (nullif(p->>'owner_id','') is null or l.owner_id = (p->>'owner_id')::uuid)
      and (coalesce((p->>'unassigned')::boolean, false) = false or l.owner_id is null)
      and (coalesce((p->>'open_only')::boolean, false) = false or not lb__closed(l.status_category))
      and (nullif(p->>'seen','') is null
           or (p->>'seen' = 'unseen' and l.owner_id is not null and l.owner_seen_at is null)
           or (p->>'seen' = 'seen' and l.owner_seen_at is not null))
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
      select id, lead_no, customer_id, customer_name, phone_e164, email, status_id, status_name, status_category,
             sub_status_id, sub_status_name, priority,
             owner_id, owner_name, owner_seen_at, product_name, source_name, expected_value, won_value, created_at, assigned_at,
             last_activity_at, next_followup_at, converted_at
      from q order by
        case when p->>'sort' = 'created' then created_at end desc,
        case when p->>'sort' = 'followup' then next_followup_at end asc nulls last,
        last_activity_at desc
      limit least(coalesce((p->>'limit')::int, 50), 500) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
$$;

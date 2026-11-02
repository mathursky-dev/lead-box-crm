-- Leads toolbar: soft delete (Active / Deleted toggle) and an Untouched filter.
--
--   1. lb_leads.deleted_at / deleted_by. A deleted lead disappears from every
--      read that goes through RLS (lists, cards, lead page, day brief, customers),
--      from dashboard + reports (lb_metric_rows), allocation, duplicate checks and
--      inbound message matching. Admins see them on the leads page "Deleted" view
--      and can restore them.
--   2. lb_delete_leads / lb_restore_leads (company admin or super admin only).
--      Delete also cancels pending follow-ups, stops journeys and unlinks chats.
--   3. lb_list_leads: p.deleted = '1' (admins only) and p.untouched = '1'
--      (owned open leads with no work by the owner since assignment, same rule as
--      the dashboard "Untouched" card).
-- Safe to re-run.

-- ------------------------------------------------------------ 1. columns + RLS
alter table public.lb_leads add column if not exists deleted_at timestamptz;
alter table public.lb_leads add column if not exists deleted_by uuid references public.lb_profiles(id) on delete set null;
create index if not exists lb_leads_deleted on public.lb_leads (company_id, deleted_at) where deleted_at is not null;

-- Deleted rows are hidden unless lb_list_leads switched on the Deleted view for
-- an admin in this transaction (lb.show_deleted).
drop policy if exists lb_leads_read on public.lb_leads;
create policy lb_leads_read on public.lb_leads for select to authenticated
  using (lb_can_see_lead(company_id, team_id, owner_id)
         and (deleted_at is null or coalesce(current_setting('lb.show_deleted', true), '') = '1'));

-- ------------------------------------------------------------ 2. delete / restore
create or replace function public.lb_delete_leads(p_leads uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_ids uuid[];
begin
  select array_agg(id) into v_ids from lb_leads
  where id = any(p_leads) and deleted_at is null and lb_is_admin_of(company_id);
  if coalesce(array_length(p_leads, 1), 0) > 0 and v_ids is null
     and not exists (select 1 from lb_leads where id = any(p_leads) and lb_is_admin_of(company_id)) then
    raise exception 'Only a company admin can delete leads' using errcode = '42501';
  end if;
  if v_ids is null then return 0; end if;
  update lb_leads set deleted_at = now(), deleted_by = me.id, next_followup_at = null, updated_at = now() where id = any(v_ids);
  update lb_followups set status = 'cancelled' where lead_id = any(v_ids) and status = 'pending';
  update lb_journey_enrollments set status = 'stopped', status_reason = 'lead deleted'
    where lead_id = any(v_ids) and status in ('active', 'paused');
  update lb_conversations set lead_id = null where lead_id = any(v_ids);
  perform lb_audit(me.company_id, 'leads.delete', 'lead', null, jsonb_build_object('lead_ids', to_jsonb(v_ids)));
  return array_length(v_ids, 1);
end $$;

create or replace function public.lb_restore_leads(p_leads uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_ids uuid[];
begin
  select array_agg(id) into v_ids from lb_leads
  where id = any(p_leads) and deleted_at is not null and lb_is_admin_of(company_id);
  if v_ids is null then return 0; end if;
  update lb_leads set deleted_at = null, deleted_by = null, updated_at = now() where id = any(v_ids);
  perform lb_audit(me.company_id, 'leads.restore', 'lead', null, jsonb_build_object('lead_ids', to_jsonb(v_ids)));
  return array_length(v_ids, 1);
end $$;

revoke all on function public.lb_delete_leads(uuid[]) from public, anon;
revoke all on function public.lb_restore_leads(uuid[]) from public, anon;
grant execute on function public.lb_delete_leads(uuid[]) to authenticated;
grant execute on function public.lb_restore_leads(uuid[]) to authenticated;

-- ------------------------------------------------------------ 3. skip deleted leads elsewhere

CREATE OR REPLACE FUNCTION public.lb_metric_rows(p jsonb)
 RETURNS TABLE(metric text, user_id uuid, lead_id uuid, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where x.company_id = v_company and x.deleted_at is null
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
end $function$
;

CREATE OR REPLACE FUNCTION public.lb__auto_allocate(p_lead uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l lb_leads; a lb_alloc_sources; v_auto boolean; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_pick lb_alloc_members; v_sum integer; v_src text;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or l.deleted_at is not null or l.owner_id is not null or lb__closed(l.status_category) then return l.owner_id; end if;
  select auto_allocate into v_auto from lb_companies where id = l.company_id;
  if not coalesce(v_auto, false) then return null; end if;

  -- The lead's own source row wins (even when switched off); otherwise "Others".
  select * into a from lb_alloc_sources s
  where s.company_id = l.company_id and s.source_id = l.source_id;
  if a.id is null then
    select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.source_id is null;
  end if;
  if a.id is null or not a.is_active then return null; end if;

  -- Lock the allocation's members so concurrent leads take turns correctly.
  perform 1 from lb_alloc_members m where m.alloc_id = a.id for update;

  -- Eligible: switched on here, lb__alloc_user_ok, under today's cap.
  select coalesce(sum(m.ratio), 0) into v_sum
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);
  if v_sum = 0 then return null; end if;

  -- Smooth weighted round-robin: everyone eligible gains their ratio, the
  -- highest takes the lead and pays back the total.
  update lb_alloc_members m set rr_weight = m.rr_weight + m.ratio
  from lb_profiles u
  where u.id = m.user_id and m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);

  select m.* into v_pick
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = a.id and m.is_active and u.company_id = l.company_id and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day)
  order by m.rr_weight desc, m.ratio desc, m.created_at, m.id
  limit 1;

  update lb_alloc_members set
    rr_weight = rr_weight - v_sum,
    day_count = case when day = v_today then day_count + 1 else 1 end,
    day = v_today,
    total_count = total_count + 1
  where id = v_pick.id;

  select coalesce((select name from lb_sources where id = a.source_id), 'Others') into v_src;
  perform lb__assign(p_lead, v_pick.user_id, p_actor, 'Auto allocation: ' || v_src || ' (ratio ' || v_pick.ratio || ')');
  return v_pick.user_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.lb_alloc_assign_waiting(p_alloc uuid, p_max integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a lb_alloc_sources; v_id uuid; n integer := 0;
begin
  select * into a from lb_alloc_sources where id = p_alloc;
  if a.id is null or not lb_is_admin_of(a.company_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not a.is_active then raise exception 'Switch this source on first'; end if;
  for v_id in
    select l.id from lb_leads l
    where l.company_id = a.company_id and l.deleted_at is null and l.owner_id is null and not lb__closed(l.status_category)
      and (case when a.source_id is not null then l.source_id = a.source_id
                else not exists (select 1 from lb_alloc_sources s where s.company_id = a.company_id and s.source_id is not null and s.source_id = l.source_id) end)
    order by l.created_at
    limit least(greatest(coalesce(p_max, 500), 1), 2000)
  loop
    if lb__auto_allocate(v_id, auth.uid()) is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.lb_create_lead(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me lb_profiles := lb__me();
  v_company uuid := me.company_id;
  v_phone text := p->>'phone_e164';
  v_cust lb_customers; v_existing lb_leads; v_lead lb_leads;
  v_owner uuid := nullif(p->>'owner_id','')::uuid;
  v_source uuid := nullif(p->>'source_id','')::uuid;
  v_force boolean := coalesce((p->>'force_repeat')::boolean, false);
  v_status uuid; v_tag uuid; v_due timestamptz := nullif(p->>'next_followup_at','')::timestamptz;
begin
  if not lb_can('leads.create') then raise exception 'You do not have permission to create leads' using errcode = '42501'; end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  -- Reference integrity within the company.
  if exists (select 1 from (values
      ('lb_branches', p->>'branch_id'), ('lb_departments', p->>'department_id'), ('lb_teams', p->>'team_id'),
      ('lb_products', p->>'product_id'), ('lb_sources', p->>'source_id')) v(t, idv)
    where nullif(idv,'') is not null and not exists (
      select 1 from lb_branches where t='lb_branches' and id=idv::uuid and company_id=v_company
      union all select 1 from lb_departments where t='lb_departments' and id=idv::uuid and company_id=v_company
      union all select 1 from lb_teams where t='lb_teams' and id=idv::uuid and company_id=v_company
      union all select 1 from lb_products where t='lb_products' and id=idv::uuid and company_id=v_company
      union all select 1 from lb_sources where t='lb_sources' and id=idv::uuid and company_id=v_company))
  then raise exception 'Invalid branch/department/team/product/source'; end if;

  insert into lb_customers (company_id, phone_e164, name, email, location)
  values (v_company, v_phone, nullif(p->>'name',''), nullif(p->>'email',''), nullif(p->>'location',''))
  on conflict (company_id, phone_e164) do update set
    name = coalesce(lb_customers.name, excluded.name),
    email = coalesce(lb_customers.email, excluded.email),
    location = coalesce(lb_customers.location, excluded.location),
    updated_at = now();
  -- Serialize duplicate detection per customer.
  select * into v_cust from lb_customers where company_id = v_company and phone_e164 = v_phone for update;

  select * into v_existing from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_existing.id is not null and not v_force then
    return jsonb_build_object('status','duplicate','lead_id', v_existing.id, 'lead_no', v_existing.lead_no,
      'visible', lb_can_see_lead(v_existing.company_id, v_existing.team_id, v_existing.owner_id),
      'customer_id', v_cust.id);
  end if;

  if v_source is null then
    select id into v_source from lb_sources where company_id = v_company and name =
      case when p->>'import_job_id' is not null then 'Import' else 'Manual' end;
  end if;
  v_status := lb__default_status(v_company, 'new');
  insert into lb_leads (company_id, customer_id, branch_id, department_id, team_id, product_id, source_id,
    status_id, status_category, priority, expected_value, notes, is_repeat, parent_lead_id, created_by)
  values (v_company, v_cust.id, nullif(p->>'branch_id','')::uuid, nullif(p->>'department_id','')::uuid,
    coalesce(nullif(p->>'team_id','')::uuid, case when me.role in ('agent','team_leader') then me.team_id end),
    nullif(p->>'product_id','')::uuid, v_source, v_status, 'new',
    coalesce(nullif(p->>'priority',''), 'normal'), nullif(p->>'expected_value','')::numeric,
    nullif(p->>'notes',''), v_existing.id is not null, v_existing.id, me.id)
  returning * into v_lead;

  insert into lb_lead_events (company_id, lead_id, actor_id, type, to_status_id, to_category, data)
  values (v_company, v_lead.id, me.id, case when v_existing.id is not null then 'repeat_created' else 'created' end,
    v_status, 'new', jsonb_build_object('import_job_id', p->>'import_job_id'));

  for v_tag in select (jsonb_array_elements_text(coalesce(p->'tag_ids','[]')))::uuid loop
    insert into lb_lead_tags select v_lead.id, id from lb_tags where id = v_tag and company_id = v_company
    on conflict do nothing;
  end loop;

  -- Ownership: agents own what they create; managers may pick; else auto.
  if me.role = 'agent' then
    perform lb__assign(v_lead.id, me.id, me.id, 'Created by owner');
  elsif v_owner is not null then
    if me.role = 'team_leader' and not v_owner = any(lb_visible_user_ids()) then
      raise exception 'You can only assign within your teams';
    end if;
    perform lb__assign(v_lead.id, v_owner, me.id, 'Assigned at creation');
  elsif coalesce((p->>'auto_allocate')::boolean, true) then
    perform lb__auto_allocate(v_lead.id, me.id);
  end if;

  if v_due is not null then
    insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, created_by)
    select v_company, v_lead.id, owner_id, v_due, 'Initial follow-up', me.id from lb_leads where id = v_lead.id;
    perform lb__refresh_next_followup(v_lead.id);
  end if;
  return jsonb_build_object('status','created','lead_id', v_lead.id, 'lead_no', v_lead.lead_no, 'customer_id', v_cust.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lb_ingest_fb_lead(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := (p->>'company_id')::uuid;
  v_phone text := p->>'phone_e164';
  v_cust lb_customers; v_existing lb_leads; v_lead lb_leads; v_status uuid; v_source uuid;
begin
  if v_company is null or v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('status','skipped','reason','no_valid_phone');
  end if;

  insert into lb_customers (company_id, phone_e164, name, email, location)
  values (v_company, v_phone, nullif(p->>'name',''), nullif(p->>'email',''), nullif(p->>'location',''))
  on conflict (company_id, phone_e164) do update set
    name = coalesce(lb_customers.name, excluded.name),
    email = coalesce(lb_customers.email, excluded.email),
    location = coalesce(lb_customers.location, excluded.location),
    updated_at = now();
  select * into v_cust from lb_customers where company_id = v_company and phone_e164 = v_phone for update;

  select * into v_existing from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_existing.id is not null and v_existing.status_category not in ('won','lost','closed') then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (v_company, v_existing.id, v_existing.owner_id, 'note',
      jsonb_build_object('via','facebook','leadgen_id', p->>'leadgen_id','text','Facebook lead form submitted again'));
    update lb_leads set last_activity_at = now() where id = v_existing.id;
    return jsonb_build_object('status','duplicate','lead_id', v_existing.id);
  end if;

  select id into v_source from lb_sources where company_id = v_company and name = 'Facebook';
  v_status := lb__default_status(v_company, 'new');
  insert into lb_leads (company_id, customer_id, source_id, status_id, status_category, priority, notes,
    is_repeat, parent_lead_id)
  values (v_company, v_cust.id, v_source, v_status, 'new', 'normal', nullif(p->>'notes',''),
    v_existing.id is not null, v_existing.id)
  returning * into v_lead;

  insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
  values (v_company, v_lead.id, case when v_existing.id is not null then 'repeat_created' else 'created' end,
    v_status, 'new', jsonb_build_object('via','facebook','leadgen_id', p->>'leadgen_id',
      'page_id', p->>'page_id','form_id', p->>'form_id','ad_id', p->>'ad_id','fields', p->'fields'));
  perform lb__auto_allocate(v_lead.id, null);
  return jsonb_build_object('status','created','lead_id', v_lead.id, 'customer_id', v_cust.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lb_ingest_inbound(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n lb_wa_numbers; co lb_companies; v_cust lb_customers; c lb_conversations; l lb_leads;
  v_msg uuid; v_e164 text := '+' || regexp_replace(p->>'from', '\D', '', 'g');
  v_ts timestamptz := coalesce(to_timestamp((p->>'timestamp')::bigint), now());
  v_body text := p->>'body'; v_kw text := upper(trim(coalesce(p->>'body','')));
  v_created boolean := false; v_prev_unread integer; v_status uuid;
begin
  select * into n from lb_wa_numbers where phone_number_id = p->>'phone_number_id';
  if n.id is null then return jsonb_build_object('skipped','unknown_number'); end if;
  if exists (select 1 from lb_messages where wa_message_id = p->>'wa_message_id') then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into co from lb_companies where id = n.company_id;
  update lb_wa_numbers set last_webhook_at = now() where id = n.id;

  insert into lb_customers (company_id, phone_e164, name, wa_profile_name)
  values (n.company_id, v_e164, nullif(p->>'profile_name',''), nullif(p->>'profile_name',''))
  on conflict (company_id, phone_e164) do update set wa_profile_name = coalesce(excluded.wa_profile_name, lb_customers.wa_profile_name);
  select * into v_cust from lb_customers where company_id = n.company_id and phone_e164 = v_e164 for update;

  if v_kw in ('STOP','UNSUBSCRIBE','STOP ALL','OPT OUT','OPTOUT','CANCEL') then
    update lb_customers set wa_opted_out_at = now() where id = v_cust.id;
  elsif v_kw in ('START','SUBSCRIBE','UNSTOP','OPT IN') then
    update lb_customers set wa_opted_out_at = null, wa_opt_in_at = now() where id = v_cust.id;
  end if;

  insert into lb_conversations (company_id, number_id, customer_id, team_id)
  values (n.company_id, n.id, v_cust.id, n.team_id)
  on conflict (number_id, customer_id) do nothing;
  select * into c from lb_conversations where number_id = n.id and customer_id = v_cust.id for update;

  -- Repeat messages attach to the existing lead; new contacts may create one.
  if c.lead_id is not null then select * into l from lb_leads where id = c.lead_id and deleted_at is null;
    if l.id is null then select * into l from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1; end if;
  else select * into l from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  end if;
  if l.id is null and co.auto_create_leads then
    v_status := lb__default_status(n.company_id, 'new');
    insert into lb_leads (company_id, customer_id, branch_id, department_id, team_id, product_id, source_id, number_id,
      status_id, status_category)
    values (n.company_id, v_cust.id, n.branch_id, n.department_id, n.team_id, n.product_id,
      (select id from lb_sources where company_id = n.company_id and name = 'WhatsApp'), n.id, v_status, 'new')
    returning * into l;
    insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
    values (n.company_id, l.id, 'created', v_status, 'new', jsonb_build_object('via','whatsapp'));
    perform lb__auto_allocate(l.id, null);
    select * into l from lb_leads where id = l.id;
    v_created := true;
  end if;

  insert into lb_messages (company_id, conversation_id, direction, type, body, media_wa_id, media_mime, media_filename,
    media_status, wa_message_id, status, wa_timestamp, created_at)
  values (n.company_id, c.id, 'in', coalesce(p->>'type','text'), v_body, nullif(p->>'media_id',''), p->>'mime_type',
    p->>'filename', case when nullif(p->>'media_id','') is not null then 'pending' end,
    p->>'wa_message_id', 'received', v_ts, now())
  on conflict (wa_message_id) do nothing
  returning id into v_msg;
  if v_msg is null then return jsonb_build_object('duplicate', true); end if;

  v_prev_unread := c.unread_count;
  update lb_conversations set
    lead_id = coalesce(lead_id, l.id),
    assignee_id = coalesce(assignee_id, l.owner_id),
    unread_count = unread_count + 1,
    last_message_at = greatest(coalesce(last_message_at, v_ts), v_ts),
    last_message_preview = case when last_message_at is null or v_ts >= last_message_at
      then left(coalesce(v_body, '[' || coalesce(p->>'type','message') || ']'), 140) else last_message_preview end,
    last_inbound_at = greatest(coalesce(last_inbound_at, v_ts), v_ts),
    status = case when status = 'resolved' then 'open' else status end,
    updated_at = now()
  where id = c.id returning * into c;

  if l.id is not null then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (n.company_id, l.id, l.owner_id, 'message_in', jsonb_build_object('message_id', v_msg));
    update lb_leads set last_activity_at = now() where id = l.id;
  end if;
  if v_prev_unread = 0 then
    perform lb__notify(n.company_id, c.assignee_id, 'message', 'New WhatsApp message',
      coalesce(v_cust.name, v_cust.wa_profile_name, v_e164) || ': ' || left(coalesce(v_body,'[media]'), 80),
      '/inbox?c=' || c.id, 'msg:' || v_msg);
  end if;
  return jsonb_build_object('message_id', v_msg, 'conversation_id', c.id, 'lead_id', l.id,
    'lead_created', v_created, 'company_id', n.company_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.lb_check_phones(p_phones text[])
 RETURNS TABLE(phone_e164 text, lead_id uuid, lead_no bigint, owner_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me lb_profiles := lb__me();
begin
  if not lb_can('leads.import') then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  return query
  select distinct on (c.phone_e164) c.phone_e164, l.id, l.lead_no, o.full_name
  from lb_customers c join lb_leads l on l.customer_id = c.id and l.deleted_at is null left join lb_profiles o on o.id = l.owner_id
  where c.company_id = me.company_id and c.phone_e164 = any(p_phones)
  order by c.phone_e164, l.created_at desc;
end $function$
;

-- ------------------------------------------------------------ 4. leads list
-- Now plpgsql so the Deleted view can switch on lb.show_deleted (admins only)
-- for this call before reading.
create or replace function public.lb_list_leads(p jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_deleted boolean := coalesce(p->>'deleted', '') = '1' and lb_is_admin_of(lb_my_company()); v_out jsonb;
begin
  perform set_config('lb.show_deleted', case when v_deleted then '1' else '' end, true);
  v_out := (
with srt as (
    select coalesce(nullif(p->>'sort', ''), 'activity') k,
           case when p->>'dir' in ('asc', 'desc') then p->>'dir'
                when p->>'sort' = 'followup' then 'asc' else 'desc' end d
  ), q as (
    select l.*, c.name customer_name, c.phone_e164, c.email, s.name status_name, s.sort_order status_order, ss.name sub_status_name, o.full_name owner_name,
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
      and (coalesce((p->>'untouched')::boolean, false) = false
           or (l.owner_id is not null and not lb__closed(l.status_category)
               and not exists (select 1 from lb_lead_events w where w.lead_id = l.id and w.is_work
                               and w.actor_id = l.owner_id and w.created_at >= l.assigned_at)))
      and (case when v_deleted then l.deleted_at is not null else l.deleted_at is null end)
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
  ), r as (
    -- one text, one number and one time sort key per row; only the one matching o.k is non-null
    select q.*,
      case srt.k when 'customer' then lower(customer_name) when 'mobile' then phone_e164 when 'email' then lower(email)
               when 'sub_status' then lower(sub_status_name) when 'owner' then lower(owner_name) when 'product' then lower(product_name)
               when 'source' then lower(source_name) when 'remark' then lower(remark) end sk_text,
      case srt.k when 'lead' then lead_no::numeric when 'value' then coalesce(won_value, expected_value)
               when 'status' then status_order::numeric
               when 'priority' then array_position(array['low','normal','high','urgent'], priority)::numeric end sk_num,
      case srt.k when 'activity' then last_activity_at when 'created' then created_at when 'followup' then next_followup_at
               when 'assigned' then assigned_at when 'converted' then converted_at when 'seen' then owner_seen_at end sk_time,
      srt.d
    from q, srt
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select id, lead_no, customer_id, customer_name, phone_e164, email, status_id, status_name, status_category,
             sub_status_id, sub_status_name, priority, remark, remark_at,
             owner_id, owner_name, owner_seen_at, product_name, source_name, expected_value, won_value, created_at, assigned_at,
             last_activity_at, next_followup_at, converted_at, deleted_at
      from r order by
        case when d = 'asc' then sk_text end asc nulls last,
        case when d = 'desc' then sk_text end desc nulls last,
        case when d = 'asc' then sk_num end asc nulls last,
        case when d = 'desc' then sk_num end desc nulls last,
        case when d = 'asc' then sk_time end asc nulls last,
        case when d = 'desc' then sk_time end desc nulls last,
        last_activity_at desc, id
      limit least(coalesce((p->>'limit')::int, 50), 500) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
  );
  perform set_config('lb.show_deleted', '', true);
  return v_out;
end $$;

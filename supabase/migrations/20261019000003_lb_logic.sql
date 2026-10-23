-- LEAD BOX business logic. All writes to leads/messages/history go through
-- these functions so history is always recorded atomically.

-- ------------------------------------------------------------ seeding
create or replace function lb__seed_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lb_lead_statuses (company_id, name, category, sort_order, is_default) values
    (new.id, 'New', 'new', 10, true),
    (new.id, 'Assigned', 'assigned', 20, true),
    (new.id, 'Contacted', 'contacted', 30, true),
    (new.id, 'Interested', 'interested', 40, true),
    (new.id, 'Follow-up', 'follow_up', 50, true),
    (new.id, 'Demo/Consultation Scheduled', 'scheduled', 60, true),
    (new.id, 'Converted/Won', 'won', 70, true),
    (new.id, 'Lost', 'lost', 80, true),
    (new.id, 'Invalid', 'invalid', 90, true);
  insert into lb_sources (company_id, name, is_system) values
    (new.id, 'WhatsApp', true), (new.id, 'Manual', true), (new.id, 'Import', true);
  return new;
end $$;
create trigger lb_companies_seed after insert on lb_companies
  for each row execute function lb__seed_company();

-- ------------------------------------------------------------ helpers
create or replace function lb__me() returns lb_profiles
language plpgsql stable security definer set search_path = public as $$
declare p lb_profiles;
begin
  select * into p from lb_profiles where id = auth.uid() and is_active;
  if p.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  return p;
end $$;

create or replace function lb__closed(p_cat text) returns boolean
language sql immutable as $$ select p_cat in ('won','lost','invalid') $$;

create or replace function lb__default_status(p_company uuid, p_cat text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from lb_lead_statuses where company_id = p_company and category = p_cat and is_active
  order by is_default desc, sort_order limit 1
$$;

create or replace function lb_audit(p_company uuid, p_action text, p_entity text, p_entity_id text, p_data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (p_company, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'))
$$;

create or replace function lb__notify(p_company uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text, p_key text default null)
returns void language sql security definer set search_path = public as $$
  insert into lb_notifications (company_id, user_id, type, title, body, link, dedupe_key)
  select p_company, p_user, p_type, p_title, p_body, p_link, p_key
  where p_user is not null
  on conflict (dedupe_key) do nothing
$$;

create or replace function lb__refresh_next_followup(p_lead uuid) returns void
language sql security definer set search_path = public as $$
  update lb_leads set next_followup_at =
    (select min(due_at) from lb_followups where lead_id = p_lead and status = 'pending')
  where id = p_lead
$$;

-- Core status setter (no permission check).
create or replace function lb__set_status(p_lead uuid, p_status uuid, p_actor uuid, p_reason text, p_won numeric, p_is_work boolean)
returns void language plpgsql security definer set search_path = public as $$
declare l lb_leads; s lb_lead_statuses;
begin
  select * into l from lb_leads where id = p_lead for update;
  select * into s from lb_lead_statuses where id = p_status and company_id = l.company_id and is_active;
  if s.id is null then raise exception 'Invalid status'; end if;
  if l.status_id = s.id then return; end if;
  if s.category in ('lost','invalid') and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for Lost/Invalid';
  end if;
  update lb_leads set
    status_id = s.id,
    status_category = s.category,
    converted_at = case when s.category = 'won' then coalesce(converted_at, now()) else null end,
    converted_owner_id = case when s.category = 'won' then coalesce(converted_owner_id, owner_id) else null end,
    won_value = case when s.category = 'won' then coalesce(p_won, won_value, expected_value) else won_value end,
    closed_at = case when lb__closed(s.category) then coalesce(closed_at, now()) else null end,
    lost_reason = case when s.category in ('lost','invalid') then p_reason else lost_reason end,
    last_activity_at = now(), updated_at = now()
  where id = p_lead;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, from_status_id, to_status_id, to_category, reason)
  values (l.company_id, p_lead, p_actor, l.owner_id, 'status_change', p_is_work, l.status_id, s.id, s.category, p_reason);
end $$;

-- Core assignment (no permission check). Returns true if owner changed.
create or replace function lb__assign(p_lead uuid, p_to uuid, p_actor uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare l lb_leads; u lb_profiles; c record;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.owner_id is not distinct from p_to then return false; end if;
  if p_to is not null then
    select * into u from lb_profiles where id = p_to;
    if u.id is null or u.company_id <> l.company_id or not u.is_active then
      raise exception 'Assignee must be an active user of this company';
    end if;
  end if;
  update lb_leads set
    owner_id = p_to,
    assigned_at = case when p_to is null then null else now() end,
    original_owner_id = coalesce(original_owner_id, p_to),
    first_allocated_at = case when first_allocated_at is null and p_to is not null then now() else first_allocated_at end,
    team_id = coalesce(u.team_id, team_id),
    updated_at = now()
  where id = p_lead;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, from_user_id, to_user_id, reason)
  values (l.company_id, p_lead, p_actor, p_to, 'assignment', l.owner_id, p_to, p_reason);
  if p_to is not null and l.status_category = 'new' then
    perform lb__set_status(p_lead, lb__default_status(l.company_id, 'assigned'), p_actor, null, null, false);
  end if;
  -- Keep chat assignee in sync with lead owner.
  for c in select id, assignee_id from lb_conversations where lead_id = p_lead and assignee_id is distinct from p_to loop
    update lb_conversations set assignee_id = p_to, team_id = coalesce(u.team_id, team_id), updated_at = now() where id = c.id;
    insert into lb_conversation_transfers (company_id, conversation_id, from_user_id, to_user_id, actor_id, reason)
    values (l.company_id, c.id, c.assignee_id, p_to, p_actor, coalesce(p_reason, 'Lead owner changed'));
  end loop;
  update lb_followups set assigned_to = p_to where lead_id = p_lead and status = 'pending' and p_to is not null;
  perform lb__notify(l.company_id, p_to, 'assignment', 'Lead LB-' || l.lead_no || ' assigned to you',
    p_reason, '/leads/' || p_lead, null);
  return true;
end $$;

-- Round-robin allocation. Rule rows are locked so concurrent calls serialize;
-- the lead row lock + owner check means a lead is never assigned twice.
create or replace function lb__auto_allocate(p_lead uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l lb_leads; r record; v_user uuid; v_auto boolean;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.owner_id is not null or lb__closed(l.status_category) then return l.owner_id; end if;
  select auto_allocate into v_auto from lb_companies where id = l.company_id;
  if not v_auto then return null; end if;
  for r in
    select * from lb_allocation_rules ar
    where ar.company_id = l.company_id and ar.is_active
      and (ar.match_number_id is null or ar.match_number_id = l.number_id)
      and (ar.match_branch_id is null or ar.match_branch_id = l.branch_id)
      and (ar.match_department_id is null or ar.match_department_id = l.department_id)
      and (ar.match_product_id is null or ar.match_product_id = l.product_id)
      and (ar.match_source_id is null or ar.match_source_id = l.source_id)
    order by ar.priority, ar.created_at
    for update
  loop
    select u.id into v_user
    from lb_allocation_rule_users ru join lb_profiles u on u.id = ru.user_id
    where ru.rule_id = r.id and u.is_active and u.accepts_auto_allocation and u.company_id = l.company_id
      and (u.allocation_limit is null or
           (select count(*) from lb_leads x where x.owner_id = u.id and not lb__closed(x.status_category)) < u.allocation_limit)
    order by (u.id > coalesce(r.last_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) desc, u.id
    limit 1;
    if v_user is not null then
      update lb_allocation_rules set last_user_id = v_user where id = r.id;
      perform lb__assign(p_lead, v_user, p_actor, 'Auto allocation: ' || r.name);
      return v_user;
    end if;
  end loop;
  return null;
end $$;

-- ----------------------------------------------------- lead RPCs
create or replace function lb_create_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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

  select * into v_existing from lb_leads where customer_id = v_cust.id order by created_at desc limit 1;
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
end $$;

create or replace function lb_assign_leads(p_leads uuid[], p_to uuid, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_id uuid; l lb_leads; n integer := 0;
begin
  if not (me.role in ('super_admin','company_admin','team_leader') or 'assign_leads' = any(me.permissions)) then
    raise exception 'Not allowed to assign leads' using errcode = '42501';
  end if;
  if p_to is not null and me.role = 'team_leader' and not p_to = any(lb_visible_user_ids()) then
    raise exception 'You can only assign to users in your teams' using errcode = '42501';
  end if;
  if array_length(p_leads, 1) > 500 then raise exception 'Max 500 leads per bulk assignment'; end if;
  for v_id in select unnest(p_leads) order by 1 loop
    select * into l from lb_leads where id = v_id for update;
    if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
      raise exception 'Lead not found or not permitted' using errcode = '42501';
    end if;
    if l.owner_id is not null and l.owner_id is distinct from p_to and coalesce(trim(p_reason),'') = '' then
      raise exception 'A reason is required to reassign LB-%', l.lead_no;
    end if;
    if lb__assign(v_id, p_to, me.id, nullif(trim(p_reason),'')) then n := n + 1; end if;
  end loop;
  perform lb_audit(me.company_id, 'leads.assign', 'lead', null,
    jsonb_build_object('lead_ids', p_leads, 'to', p_to, 'reason', p_reason, 'changed', n));
  return n;
end $$;

create or replace function lb_auto_allocate_leads(p_leads uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_id uuid; n integer := 0; l lb_leads;
begin
  if me.role not in ('super_admin','company_admin','team_leader') then raise exception 'Not allowed' using errcode='42501'; end if;
  for v_id in select unnest(p_leads) order by 1 loop
    select * into l from lb_leads where id = v_id;
    if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then continue; end if;
    if l.owner_id is null and lb__auto_allocate(v_id, me.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function lb_change_status(p_lead uuid, p_status uuid, p_reason text default null, p_won_value numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me();
begin
  if not lb_can_see_lead_id(p_lead) then raise exception 'Not permitted' using errcode='42501'; end if;
  perform lb__set_status(p_lead, p_status, me.id, nullif(trim(p_reason),''), p_won_value, true);
end $$;

create or replace function lb_update_lead(p_lead uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; k text;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('branch_id','department_id','product_id','source_id','priority','expected_value','notes',
                 'won_value','name','email','location','tag_ids') then
      raise exception 'Field % cannot be edited', k;
    end if;
  end loop;
  if p ? 'priority' and p->>'priority' not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
  if (p ? 'branch_id' and nullif(p->>'branch_id','') is not null and not exists (select 1 from lb_branches where id=(p->>'branch_id')::uuid and company_id=l.company_id))
  or (p ? 'department_id' and nullif(p->>'department_id','') is not null and not exists (select 1 from lb_departments where id=(p->>'department_id')::uuid and company_id=l.company_id))
  or (p ? 'product_id' and nullif(p->>'product_id','') is not null and not exists (select 1 from lb_products where id=(p->>'product_id')::uuid and company_id=l.company_id))
  or (p ? 'source_id' and nullif(p->>'source_id','') is not null and not exists (select 1 from lb_sources where id=(p->>'source_id')::uuid and company_id=l.company_id))
  then raise exception 'Invalid reference'; end if;

  update lb_leads set
    branch_id = case when p ? 'branch_id' then nullif(p->>'branch_id','')::uuid else branch_id end,
    department_id = case when p ? 'department_id' then nullif(p->>'department_id','')::uuid else department_id end,
    product_id = case when p ? 'product_id' then nullif(p->>'product_id','')::uuid else product_id end,
    source_id = case when p ? 'source_id' then nullif(p->>'source_id','')::uuid else source_id end,
    priority = coalesce(p->>'priority', priority),
    expected_value = case when p ? 'expected_value' then nullif(p->>'expected_value','')::numeric else expected_value end,
    won_value = case when p ? 'won_value' then nullif(p->>'won_value','')::numeric else won_value end,
    notes = case when p ? 'notes' then nullif(p->>'notes','') else notes end,
    last_activity_at = now(), updated_at = now()
  where id = p_lead;
  if p ? 'name' or p ? 'email' or p ? 'location' then
    update lb_customers set
      name = case when p ? 'name' then nullif(p->>'name','') else name end,
      email = case when p ? 'email' then nullif(p->>'email','') else email end,
      location = case when p ? 'location' then nullif(p->>'location','') else location end,
      updated_at = now()
    where id = l.customer_id;
  end if;
  if p ? 'tag_ids' then
    delete from lb_lead_tags where lead_id = p_lead;
    insert into lb_lead_tags select p_lead, t.id from lb_tags t
      where t.company_id = l.company_id and t.id in (select (jsonb_array_elements_text(p->'tag_ids'))::uuid)
    on conflict do nothing;
  end if;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, p_lead, me.id, l.owner_id, 'field_update', true, p);
end $$;

create or replace function lb_log_activity(p_lead uuid, p_type text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads;
begin
  if p_type not in ('note','call') then raise exception 'Invalid activity'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Text required'; end if;
  select * into l from lb_leads where id = p_lead;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_type = 'note' then
    insert into lb_notes (company_id, customer_id, lead_id, author_id, body) values (l.company_id, l.customer_id, p_lead, me.id, p_body);
  end if;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, p_lead, me.id, l.owner_id, p_type, true, jsonb_build_object('body', left(p_body, 2000)));
  update lb_leads set last_activity_at = now() where id = p_lead;
end $$;

create or replace function lb_add_followup(p_lead uuid, p_due timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; v_id uuid;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_due is null then raise exception 'Due time required'; end if;
  insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, created_by)
  values (l.company_id, p_lead, coalesce(l.owner_id, me.id), p_due, nullif(trim(p_note),''), me.id) returning id into v_id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, p_lead, me.id, l.owner_id, 'followup_created', true, jsonb_build_object('due_at', p_due, 'note', p_note));
  update lb_leads set last_activity_at = now() where id = p_lead;
  perform lb__refresh_next_followup(p_lead);
  return v_id;
end $$;

create or replace function lb_complete_followup(p_followup uuid, p_note text default null, p_cancel boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); f lb_followups; l lb_leads;
begin
  select * into f from lb_followups where id = p_followup for update;
  select * into l from lb_leads where id = f.lead_id;
  if f.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if f.status <> 'pending' then return; end if;
  update lb_followups set status = case when p_cancel then 'cancelled' else 'done' end,
    completed_at = now(), completed_by = me.id where id = p_followup;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, l.id, me.id, l.owner_id, 'followup_done', not p_cancel,
    jsonb_build_object('followup_id', p_followup, 'note', p_note, 'cancelled', p_cancel));
  update lb_leads set last_activity_at = now() where id = l.id;
  perform lb__refresh_next_followup(l.id);
end $$;

-- ---------------------------------------------- conversation RPCs
create or replace function lb_conversation_action(p_conv uuid, p_action text, p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_conversations; v_to uuid; r jsonb; v_cust lb_customers; v_lead uuid;
begin
  select * into c from lb_conversations where id = p_conv for update;
  if c.id is null or not lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if p_action = 'read' then
    update lb_conversations set unread_count = 0 where id = p_conv;
  elsif p_action = 'status' then
    if p->>'status' not in ('open','pending','resolved') then raise exception 'Invalid status'; end if;
    update lb_conversations set status = p->>'status', updated_at = now(),
      unread_count = case when p->>'status' = 'resolved' then 0 else unread_count end where id = p_conv;
  elsif p_action = 'note' then
    if coalesce(trim(p->>'body'),'') = '' then raise exception 'Note text required'; end if;
    insert into lb_notes (company_id, customer_id, lead_id, conversation_id, author_id, body)
    values (c.company_id, c.customer_id, c.lead_id, p_conv, me.id, p->>'body');
    if c.lead_id is not null then
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
      select c.company_id, c.lead_id, me.id, owner_id, 'note', true, jsonb_build_object('body', left(p->>'body', 2000))
      from lb_leads where id = c.lead_id;
    end if;
  elsif p_action = 'transfer' then
    v_to := nullif(p->>'to_user_id','')::uuid;
    if v_to is null then raise exception 'Choose a user'; end if;
    if not exists (select 1 from lb_profiles where id = v_to and company_id = c.company_id and is_active) then
      raise exception 'Target must be an active user of this company';
    end if;
    if me.role = 'agent' and c.assignee_id is distinct from me.id then raise exception 'Agents can only transfer their own chats' using errcode='42501'; end if;
    if me.role = 'team_leader' and not v_to = any(lb_visible_user_ids()) then raise exception 'You can only transfer within your teams' using errcode='42501'; end if;
    if c.lead_id is not null and coalesce((p->>'sync_lead')::boolean, true) then
      perform lb__assign(c.lead_id, v_to, me.id, coalesce(nullif(trim(p->>'reason'),''), 'Chat transfer'));
    end if;
    if exists (select 1 from lb_conversations where id = p_conv and assignee_id is distinct from v_to) then
      insert into lb_conversation_transfers (company_id, conversation_id, from_user_id, to_user_id, actor_id, reason)
      values (c.company_id, p_conv, c.assignee_id, v_to, me.id, p->>'reason');
      update lb_conversations set assignee_id = v_to, team_id = coalesce((select team_id from lb_profiles where id = v_to), team_id),
        updated_at = now() where id = p_conv;
      perform lb__notify(c.company_id, v_to, 'transfer', 'Chat transferred to you', p->>'reason', '/inbox?c=' || p_conv, null);
    end if;
  elsif p_action = 'create_lead' then
    if c.lead_id is not null then return jsonb_build_object('lead_id', c.lead_id); end if;
    select * into v_cust from lb_customers where id = c.customer_id;
    select id into v_lead from lb_leads where customer_id = c.customer_id order by created_at desc limit 1;
    if v_lead is null then
      r := lb_create_lead(jsonb_build_object('phone_e164', v_cust.phone_e164, 'name', coalesce(v_cust.name, v_cust.wa_profile_name),
        'source_id', (select id from lb_sources where company_id = c.company_id and name = 'WhatsApp'),
        'owner_id', coalesce(c.assignee_id, case when me.role <> 'super_admin' then me.id end)));
      v_lead := (r->>'lead_id')::uuid;
      update lb_leads set number_id = c.number_id where id = v_lead and number_id is null;
    end if;
    update lb_conversations set lead_id = v_lead where id = p_conv;
    return jsonb_build_object('lead_id', v_lead);
  elsif p_action = 'tags' then
    delete from lb_conversation_tags where conversation_id = p_conv;
    insert into lb_conversation_tags select p_conv, t.id from lb_tags t
      where t.company_id = c.company_id and t.id in (select (jsonb_array_elements_text(coalesce(p->'tag_ids','[]')))::uuid)
    on conflict do nothing;
  else
    raise exception 'Unknown action';
  end if;
  return '{}'::jsonb;
end $$;

-- Persist an outbound message before any network call. client_id makes the
-- request idempotent (double-clicks / retries return the same row).
create or replace function lb_enqueue_message(p_conv uuid, p_client_id uuid, p jsonb) returns lb_messages
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_conversations; m lb_messages; t lb_wa_templates; v_cust lb_customers;
  v_type text := coalesce(p->>'type','text'); v_waba text;
begin
  select * into m from lb_messages where client_id = p_client_id;
  if m.id is not null then return m; end if;
  select * into c from lb_conversations where id = p_conv;
  if c.id is null or not lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  if c.assignee_id is distinct from me.id and not lb_can_use_number(c.number_id) then
    raise exception 'You do not have access to this business number' using errcode='42501';
  end if;
  if not exists (select 1 from lb_wa_numbers where id = c.number_id and is_active) then
    raise exception 'This business number is disabled';
  end if;
  select * into v_cust from lb_customers where id = c.customer_id;
  if v_type = 'template' then
    select waba_id into v_waba from lb_wa_numbers where id = c.number_id;
    select * into t from lb_wa_templates where company_id = c.company_id and waba_id = v_waba
      and name = p->>'template_name' and language = p->>'template_language';
    if t.id is null or upper(t.status) <> 'APPROVED' then raise exception 'Template is not approved'; end if;
    if upper(coalesce(t.category,'')) = 'MARKETING' and v_cust.wa_opted_out_at is not null then
      raise exception 'Customer has opted out of marketing messages';
    end if;
  else
    if v_type not in ('text','image','document','audio','video') then raise exception 'Unsupported message type'; end if;
    if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then
      raise exception 'The 24-hour customer service window is closed. Send an approved template instead.';
    end if;
    if v_type = 'text' and coalesce(trim(p->>'body'),'') = '' then raise exception 'Message text required'; end if;
    if v_type <> 'text' and nullif(p->>'media_path','') is null then raise exception 'Attachment missing'; end if;
    if v_type <> 'text' and split_part(p->>'media_path', '/', 2) <> p_conv::text then raise exception 'Invalid attachment path'; end if;
  end if;
  insert into lb_messages (company_id, conversation_id, direction, type, body, media_path, media_mime, media_filename,
    media_status, template_name, template_language, template_params, client_id, status, next_attempt_at, sent_by)
  values (c.company_id, p_conv, 'out', v_type, nullif(p->>'body',''), nullif(p->>'media_path',''), p->>'media_mime',
    p->>'media_filename', case when p->>'media_path' is not null then 'stored' end,
    p->>'template_name', p->>'template_language', p->'template_params', p_client_id, 'queued', now(), me.id)
  on conflict (client_id) do nothing
  returning * into m;
  if m.id is null then select * into m from lb_messages where client_id = p_client_id; return m; end if;
  update lb_conversations set last_message_at = now(), updated_at = now(),
    last_message_preview = left(coalesce(m.body, case when v_type='template' then 'Template: '||m.template_name else '['||v_type||']' end), 140),
    status = case when status = 'resolved' then 'open' else status end
  where id = p_conv;
  if c.lead_id is not null then
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
    select c.company_id, c.lead_id, me.id, owner_id, 'message_out', true, jsonb_build_object('message_id', m.id)
    from lb_leads where id = c.lead_id;
    update lb_leads set last_activity_at = now() where id = c.lead_id;
  end if;
  return m;
end $$;

create or replace function lb_retry_message(p_msg uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); m lb_messages; c lb_conversations;
begin
  select * into m from lb_messages where id = p_msg for update;
  if m.id is null or not lb_can_see_conversation_id(m.conversation_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if m.direction <> 'out' or m.status <> 'failed' then raise exception 'Only failed outbound messages can be retried'; end if;
  select * into c from lb_conversations where id = m.conversation_id;
  if m.type <> 'template' and (c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours') then
    raise exception 'The 24-hour window is closed. Send an approved template instead.';
  end if;
  update lb_messages set status = 'queued', status_rank = 0, next_attempt_at = now(), attempts = 0,
    error_code = null, error_message = null, failed_at = null, wa_message_id = null, locked_at = null
  where id = p_msg;
  perform lb_audit(m.company_id, 'message.retry', 'message', p_msg::text, '{}');
end $$;

-- ---------------------------------------------- service-only RPCs
create or replace function lb__status_rank(p text) returns smallint
language sql immutable as $$
  select case p when 'sent' then 1 when 'failed' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end::smallint
$$;

create or replace function lb_apply_status(p_wamid text, p_status text, p_ts timestamptz, p_code text, p_msg text)
returns boolean language plpgsql security definer set search_path = public as $$
declare m lb_messages; v_rank smallint := lb__status_rank(p_status); v_ts timestamptz := coalesce(p_ts, now());
begin
  if p_status not in ('sent','delivered','read','failed') then return false; end if;
  insert into lb_message_status_events (wa_message_id, status, occurred_at, error_code, error_message)
  values (p_wamid, p_status, v_ts, p_code, p_msg) on conflict do nothing;
  select * into m from lb_messages where wa_message_id = p_wamid for update;
  if m.id is null then return false; end if;  -- applied later by lb_mark_send_result
  update lb_messages set
    sent_at = case when p_status in ('sent','delivered','read') then coalesce(sent_at, v_ts) else sent_at end,
    delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, v_ts) else delivered_at end,
    read_at = case when p_status = 'read' then coalesce(read_at, v_ts) else read_at end,
    failed_at = case when p_status = 'failed' and m.status_rank < 2 then v_ts else failed_at end,
    error_code = case when p_status = 'failed' and m.status_rank < 2 then p_code else error_code end,
    error_message = case when p_status = 'failed' and m.status_rank < 2 then p_msg else error_message end,
    status = case
      when p_status = 'failed' and m.status_rank < 2 then 'failed'
      when p_status <> 'failed' and v_rank > m.status_rank then p_status
      else status end,
    status_rank = case
      when p_status = 'failed' and m.status_rank < 2 then 1
      when p_status <> 'failed' and v_rank > m.status_rank then v_rank
      else status_rank end
  where id = m.id;
  return true;
end $$;

create or replace function lb_claim_outbox(p_limit integer default 10) returns setof lb_messages
language plpgsql security definer set search_path = public as $$
begin
  -- A send that never reported back is ambiguous: never auto-resend it.
  update lb_messages set status = 'failed', failed_at = now(), error_code = 'unknown',
    error_message = 'Send outcome unknown (worker interrupted). Check WhatsApp before retrying.'
  where status = 'sending' and locked_at < now() - interval '5 minutes';
  return query
  update lb_messages m set status = 'sending', locked_at = now(), attempts = m.attempts + 1
  where m.id in (select id from lb_messages where status = 'queued' and next_attempt_at <= now()
                 order by next_attempt_at limit p_limit for update skip locked)
  returning m.*;
end $$;

create or replace function lb_mark_send_result(p_msg uuid, p_wamid text, p_code text, p_error text, p_retryable boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m lb_messages; e record;
begin
  select * into m from lb_messages where id = p_msg for update;
  if m.status <> 'sending' then return; end if;
  if p_wamid is not null then
    update lb_messages set wa_message_id = p_wamid, status = 'sent', status_rank = 1, sent_at = now(),
      locked_at = null, error_code = null, error_message = null where id = p_msg;
    for e in select * from lb_message_status_events where wa_message_id = p_wamid order by lb__status_rank(status) loop
      perform lb_apply_status(p_wamid, e.status, e.occurred_at, e.error_code, e.error_message);
    end loop;
  elsif p_retryable and m.attempts < 5 then
    update lb_messages set status = 'queued', locked_at = null, error_code = p_code, error_message = p_error,
      next_attempt_at = now() + (interval '30 seconds' * power(2, m.attempts)) where id = p_msg;
  else
    update lb_messages set status = 'failed', status_rank = 1, failed_at = now(), locked_at = null,
      error_code = p_code, error_message = p_error where id = p_msg;
  end if;
end $$;

create or replace function lb_ingest_inbound(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  if c.lead_id is not null then select * into l from lb_leads where id = c.lead_id;
  else select * into l from lb_leads where customer_id = v_cust.id order by created_at desc limit 1;
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
end $$;

create or replace function lb_run_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare f record; n integer := 0;
begin
  for f in select fu.*, l.lead_no from lb_followups fu join lb_leads l on l.id = fu.lead_id
    where fu.status = 'pending' and fu.reminded_at is null and fu.due_at <= now() + interval '15 minutes'
    for update of fu skip locked
  loop
    perform lb__notify(f.company_id, f.assigned_to, 'followup',
      case when f.due_at < now() then 'Overdue follow-up: LB-' else 'Follow-up due: LB-' end || f.lead_no,
      f.note, '/leads/' || f.lead_id, 'fu:' || f.id);
    update lb_followups set reminded_at = now() where id = f.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function lb_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into lb_rate_limits as r (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;

-- Lock down: service-only functions are not callable by end users.
do $$ declare f text; begin
  foreach f in array array['lb_apply_status(text,text,timestamptz,text,text)','lb_claim_outbox(integer)',
    'lb_mark_send_result(uuid,text,text,text,boolean)','lb_ingest_inbound(jsonb)','lb_run_reminders()',
    'lb_rate_limit(text,integer,integer)','lb__assign(uuid,uuid,uuid,text)','lb__auto_allocate(uuid,uuid)',
    'lb__set_status(uuid,uuid,uuid,text,numeric,boolean)','lb__notify(uuid,uuid,text,text,text,text,text)',
    'lb__refresh_next_followup(uuid)','lb_audit(uuid,text,text,text,jsonb)','lb__seed_company()']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- Everything else: authenticated only.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'lb\_%'
  loop execute format('revoke execute on function %s from anon', f.sig); end loop;
end $$;

-- Rental desk, part 3 (LivoraRent, cody 2026-11-14):
--  * Each zone is a department; every active user in that department is a zone agent (more agents later
--    = add users to the department). zones[].user_id stays as the fallback when a department is empty.
--  * As soon as the tenant form is complete the lead goes to the agents of the zone(s) of the area.
--    Several zones named ("Bodakdev ya Gota") → the agents of all those zones get it at the same time:
--    the first agent owns the WhatsApp lead, every other agent gets a linked copy of the lead
--    (parent_lead_id = the main lead, same customer, the form as a note), so it is in their own lead list.
--  * Payment confirm no longer moves the lead when the agents already have it.
--  * "Benefits" message sent once per enquiry; a help phone number for the "fill the form first" reply.
-- Only companies with an enabled lb_rental_desk row are touched.

alter table public.lb_rental_desk add column if not exists help_phone text not null default '';
alter table public.lb_rental_enquiries add column if not exists zones integer[] not null default '{}';
alter table public.lb_rental_enquiries add column if not exists assigned_users uuid[] not null default '{}';
alter table public.lb_rental_enquiries add column if not exists lead_copies uuid[] not null default '{}';
alter table public.lb_rental_enquiries add column if not exists benefits_sent boolean not null default false;

-- A zone agent also sees the enquiry rows given to them.
drop policy if exists lb_rental_enq_read on public.lb_rental_enquiries;
create policy lb_rental_enq_read on public.lb_rental_enquiries for select to authenticated
  using (company_id = public.lb_my_company() and (public.lb_is_admin_of(company_id) or assigned_to = auth.uid() or auth.uid() = any(assigned_users)));

-- The agents of one zone: active users of the zone's department (by name), else the zone's user_id.
create or replace function public.lb__rental_zone_agents(p_company uuid, z jsonb) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(p.id order by p.full_name, p.id) from lb_profiles p
      where p.company_id = p_company and p.is_active and p.role <> 'super_admin'
        and p.department_id is not null and p.department_id = nullif(z->>'department_id', '')::uuid),
    (select array[p.id] from lb_profiles p where p.id = nullif(z->>'user_id', '')::uuid and p.company_id = p_company and p.is_active),
    '{}')
$$;

-- Give the enquiry's lead to the agents of its zones. Safe to call again: agents who already have it are skipped.
-- p_note: the filled form, written on every copy. Returns {zones, agents:[names], new:[names]}.
create or replace function public.lb__rental_zone_assign(p_id uuid, p_actor uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; d lb_rental_desk; z jsonb; l lb_leads; c lb_leads; v_lead uuid; v_zone int; v_agent uuid; v_dept uuid;
  v_zones int[]; v_done uuid[]; v_copies uuid[]; v_names text[] := '{}'; v_new text[] := '{}'; v_name text; v_reason text; v_main_zone text;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null then return null; end if;
  select * into d from lb_rental_desk where company_id = e.company_id;
  if d.company_id is null then return null; end if;
  v_zones := case when cardinality(e.zones) > 0 then e.zones when e.zone is not null then array[e.zone] else '{}' end;
  if cardinality(v_zones) = 0 then return jsonb_build_object('zones', '[]'::jsonb, 'agents', '[]'::jsonb, 'new', '[]'::jsonb); end if;
  v_lead := lb__rental_lead(e);
  if v_lead is null then return jsonb_build_object('zones', to_jsonb(v_zones), 'agents', '[]'::jsonb, 'new', '[]'::jsonb, 'error', 'no lead'); end if;
  select * into l from lb_leads where id = v_lead;
  v_done := e.assigned_users; v_copies := e.lead_copies;

  foreach v_zone in array v_zones loop
    select x into z from jsonb_array_elements(coalesce(d.zones, '[]')) x where (x->>'no')::int = v_zone;
    continue when z is null;
    v_dept := nullif(z->>'department_id', '')::uuid;
    v_reason := 'Rental desk: Zone ' || v_zone || ' ' || coalesce(z->>'name', '') ||
      case when cardinality(v_zones) > 1 then ' (area in ' || cardinality(v_zones) || ' zones)' else '' end;
    foreach v_agent in array lb__rental_zone_agents(e.company_id, z) loop
      select full_name into v_name from lb_profiles where id = v_agent;
      v_names := v_names || v_name;
      continue when v_agent = any(v_done);
      if cardinality(v_done) = 0 then
        -- First agent: the WhatsApp lead itself (the chat moves with it).
        perform lb__assign(v_lead, v_agent, p_actor, v_reason);
        update lb_leads set department_id = coalesce(v_dept, department_id), updated_at = now() where id = v_lead;
        v_main_zone := 'Zone ' || v_zone;
      else
        -- Every other agent: a linked copy in their own lead list. Created a second before the main lead,
        -- so "the customer's newest lead" (chat bots, flows) stays the main one.
        insert into lb_leads (company_id, customer_id, branch_id, department_id, team_id, product_id, source_id, number_id,
          status_id, status_category, priority, notes, parent_lead_id, created_at, updated_at, last_activity_at)
        values (l.company_id, l.customer_id, l.branch_id, coalesce(v_dept, l.department_id), l.team_id, l.product_id, l.source_id, l.number_id,
          coalesce(lb__default_status(l.company_id, 'new'), l.status_id), 'new', l.priority,
          'Same rental enquiry as lead LB-' || l.lead_no || ' (shared with every zone of the area)', l.id,
          l.created_at - interval '1 second', now(), now())
        returning * into c;
        insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
        values (c.company_id, c.id, 'created', c.status_id, 'new', jsonb_build_object('via', 'rental_desk', 'main_lead', l.id));
        perform lb__assign(c.id, v_agent, p_actor, v_reason);
        if nullif(trim(coalesce(p_note, '')), '') is not null then
          insert into lb_notes (company_id, customer_id, lead_id, body) values (c.company_id, c.customer_id, c.id, left(trim(p_note), 5000));
        end if;
        v_copies := v_copies || c.id;
      end if;
      v_done := v_done || v_agent;
      v_new := v_new || v_name;
    end loop;
  end loop;

  update lb_rental_enquiries set assigned_users = v_done, lead_copies = v_copies, lead_id = coalesce(lead_id, v_lead),
    assigned_to = coalesce(assigned_to, v_done[1]), zone = coalesce(zone, v_zones[1]), zones = v_zones, updated_at = now()
  where id = e.id;
  if cardinality(v_new) > 0 then
    insert into lb_rental_log (company_id, enquiry_id, kind, detail)
    values (e.company_id, e.id, 'assigned', 'Zones ' || array_to_string(v_zones, ', ') || ' → ' || array_to_string(v_new, ', '));
  end if;
  return jsonb_build_object('zones', to_jsonb(v_zones), 'agents', to_jsonb(v_names), 'new', to_jsonb(v_new));
end $$;
revoke all on function public.lb__rental_zone_agents(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lb__rental_zone_assign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lb__rental_zone_assign(uuid, uuid, text) to service_role;

-- Payment checked: the zone agents normally have the lead already (given when the form was filled);
-- a zone picked here (or a first zone for an area that matched none) gives it to that zone's agents.
create or replace function public.lb_rental_confirm_payment(p_id uuid, p_zone integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; d lb_rental_desk; v_fee int; z jsonb; v_lead uuid; v_status uuid; v_zone int; r jsonb; v_names text;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage not in ('awaiting_payment','payment_review','fee_offer','not_registered') then raise exception 'This enquiry is already %', replace(e.stage, '_', ' '); end if;
  select * into d from lb_rental_desk where company_id = e.company_id;
  v_fee := case when e.plan = 'urgent' then d.urgent_fee else d.fee end;
  v_zone := coalesce(p_zone, e.zone);
  if v_zone is null then raise exception 'Pick the zone first (the area did not match any zone)'; end if;
  select x into z from jsonb_array_elements(coalesce(d.zones, '[]')) x where (x->>'no')::int = v_zone;
  if z is null then raise exception 'Zone % is not set up', v_zone; end if;
  if cardinality(lb__rental_zone_agents(e.company_id, z)) = 0 then
    raise exception 'Zone % has no active agent. Add a user to its department (or set the zone user on the Rental desk page).', v_zone;
  end if;
  if not v_zone = any(e.zones) then
    update lb_rental_enquiries set zones = case when cardinality(assigned_users) = 0 then array[v_zone] else zones || v_zone end, zone = coalesce(zone, v_zone) where id = e.id;
  end if;
  r := lb__rental_zone_assign(e.id, auth.uid(), null);
  select * into e from lb_rental_enquiries where id = p_id;

  v_lead := lb__rental_lead(e);
  if v_lead is not null then
    v_status := lb__rental_status(e.company_id, 'Registered - Requirement Taken');
    if v_status is not null then perform lb__set_status(v_lead, v_status, auth.uid(), 'Rental desk: ₹' || v_fee || ' payment confirmed', null, false); end if;
    insert into lb_notes (company_id, customer_id, lead_id, conversation_id, author_id, body)
    select e.company_id, e.customer_id, x, e.conversation_id, auth.uid(), '💰 Rental desk: ₹' || v_fee ||
      case when e.plan = 'urgent' then ' urgent (3 days)' else '' end || ' registration paid'
    from unnest(array[v_lead] || e.lead_copies) x;
  end if;
  select string_agg(full_name, ', ' order by full_name) into v_names from lb_profiles where id = any(e.assigned_users);
  update lb_rental_enquiries set stage = 'registered', base_stage = 'registered', lead_id = coalesce(v_lead, lead_id),
    paid_at = now(), paid_by = auth.uid(), followups = 0,
    next_followup_at = now() + make_interval(hours => d.followup_hours), updated_at = now()
  where id = e.id;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'paid', '₹' || v_fee || ' · ' || coalesce(v_names, '-'));
  return jsonb_build_object('fee', v_fee, 'plan', coalesce(e.plan, 'standard'), 'zone', v_zone, 'zone_name', z->>'name',
    'zones', to_jsonb(e.zones), 'user_id', e.assigned_to, 'user_name', coalesce(v_names, '-'), 'lead_id', v_lead);
end $$;

-- Zone picked by an admin (area did not match, or a zone added): the agents of that zone get the lead now.
create or replace function public.lb_rental_set_zone(p_id uuid, p_zone integer)
returns void language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if p_zone is not null and p_zone not between 1 and 20 then raise exception 'Bad zone'; end if;
  if p_zone is null then
    update lb_rental_enquiries set zone = null, zones = '{}', updated_at = now() where id = e.id and cardinality(assigned_users) = 0;
    return;
  end if;
  update lb_rental_enquiries set zone = coalesce(case when cardinality(assigned_users) = 0 then p_zone end, zone, p_zone),
    zones = case when cardinality(assigned_users) = 0 then array[p_zone] when p_zone = any(zones) then zones else zones || p_zone end,
    updated_at = now() where id = e.id;
  if e.stage not in ('role', 'form') and coalesce(e.role, 'tenant') = 'tenant' then
    perform lb__rental_zone_assign(e.id, auth.uid(), null);
  end if;
end $$;

revoke all on function public.lb_rental_confirm_payment(uuid, integer) from public, anon;
revoke all on function public.lb_rental_set_zone(uuid, integer) from public, anon;
grant execute on function public.lb_rental_confirm_payment(uuid, integer) to authenticated;
grant execute on function public.lb_rental_set_zone(uuid, integer) to authenticated;

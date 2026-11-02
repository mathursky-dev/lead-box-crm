-- Chatbot lead qualification, drip campaigns and city-wise auto-assignment.
--
-- 1) Chatbot "Update lead" block: lb_flow_update_lead (service role only) sets the
--    chat's lead status / priority and adds a note from the flow's answers.
-- 2) Drip campaigns (journeys with trigger_config.drip = 'true'):
--    - status journeys can start on one exact status (trigger_config.status_id),
--      not only on a status category;
--    - trigger_config.stop_on_status_change = 'true' stops the drip when the lead
--      moves to a status the drip is not for.
-- 3) City-wise allocation: lb_alloc_sources rows with cities[] are checked before
--    the source list. Same smooth weighted round-robin, ratios and max/day.
--    When the customer's city is filled in later (e.g. by the chatbot), still
--    unassigned leads are allocated again.
--
-- Safe to run more than once. Nothing existing changes behaviour unless a drip
-- or a city list is created.

-- ================================================================== 1) chatbot: update lead
create or replace function public.lb_flow_update_lead(p_conversation uuid, p_status uuid, p_priority text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v lb_conversations; l lb_leads;
begin
  select * into v from lb_conversations where id = p_conversation;
  if v.id is null then return null; end if;
  -- The chat's lead: newest open one first, else the newest.
  select * into l from lb_leads
  where company_id = v.company_id and customer_id = v.customer_id and deleted_at is null
  order by lb__closed(status_category), created_at desc
  limit 1;
  if l.id is null then return null; end if;

  if p_status is not null and exists (select 1 from lb_lead_statuses s where s.id = p_status and s.company_id = l.company_id and s.is_active) then
    perform lb__set_status(l.id, p_status, null, 'Chatbot flow', null, false);
  end if;
  if p_priority in ('low','normal','high','urgent') then
    update lb_leads set priority = p_priority, updated_at = now() where id = l.id and priority is distinct from p_priority;
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is not null then
    insert into lb_notes (company_id, customer_id, lead_id, conversation_id, body)
    values (l.company_id, l.customer_id, l.id, v.id, left(trim(p_note), 5000));
  end if;
  return l.id;
end $$;
revoke all on function public.lb_flow_update_lead(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.lb_flow_update_lead(uuid, uuid, text, text) to service_role;

-- ================================================================== 2) drip campaigns
-- Does a status journey's trigger match this status? A journey bound to one exact
-- status (status_id) matches only that status; otherwise the category decides.
create or replace function public.lb__journey_status_hit(p_cfg jsonb, p_category text, p_status uuid)
returns boolean language sql immutable as $$
  select case when nullif(p_cfg->>'status_id', '') is not null then p_status is not null and p_cfg->>'status_id' = p_status::text
              else p_cfg->>'category' = p_category end
$$;

-- Unchanged for every other trigger. For status_entered (no status id known here)
-- only category journeys match, so exact-status drips never start on a sibling status.
create or replace function public.lb__fire_trigger(p_lead uuid, p_trigger text, p_category text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l lb_leads; j record;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;
  for j in select id from lb_journeys where company_id = l.company_id and status = 'active' and trigger_type = p_trigger
    and (p_trigger <> 'status_entered' or (trigger_config->>'category' = p_category and nullif(trigger_config->>'status_id', '') is null))
    and (nullif(trigger_config->>'product_id','') is null or trigger_config->>'product_id' = l.product_id::text)
    and (nullif(trigger_config->>'source_id','') is null or trigger_config->>'source_id' = l.source_id::text)
    order by priority
  loop
    perform lb__enroll(j.id, l.id, null, false);
  end loop;
end $$;

-- Status change: stop drips that asked to stop on a status change, then start the
-- journeys / drips for the new status (exact status or its category).
create or replace function public.lb__fire_status_entered(p_lead uuid, p_category text, p_status uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l lb_leads; j record; e record;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;

  for e in select en.id, en.current_step from lb_journey_enrollments en join lb_journeys jj on jj.id = en.journey_id
    where en.lead_id = l.id and en.status in ('active','paused') and jj.trigger_type = 'status_entered'
      and coalesce(jj.trigger_config->>'stop_on_status_change', '') = 'true'
      and not lb__journey_status_hit(jj.trigger_config, p_category, p_status)
    for update of en
  loop
    update lb_journey_enrollments set status = 'stopped', status_reason = 'lead status changed', updated_at = now(), locked_at = null where id = e.id;
    perform lb__journey_event(e.id, e.current_step, 'stopped', 'lead status changed');
  end loop;

  for j in select id from lb_journeys where company_id = l.company_id and status = 'active' and trigger_type = 'status_entered'
    and lb__journey_status_hit(trigger_config, p_category, p_status)
    and (nullif(trigger_config->>'product_id','') is null or trigger_config->>'product_id' = l.product_id::text)
    and (nullif(trigger_config->>'source_id','') is null or trigger_config->>'source_id' = l.source_id::text)
    order by priority
  loop
    perform lb__enroll(j.id, l.id, null, false);
  end loop;
end $$;
revoke all on function public.lb__fire_status_entered(uuid, text, uuid) from public, anon, authenticated;

-- Same as the live version except the last branch passes the exact status.
create or replace function public.lb__on_lead_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare l lb_leads; src record;
begin
  if new.type not in ('created','repeat_created','status_change') then return new; end if;
  select * into l from lb_leads where id = new.lead_id;
  if new.type = 'status_change' and new.to_category = 'won' then
    perform lb__end_enrollments(l.id, null, 'purchase', 'stopped', 'purchase');
    select m.id, m.journey_id, m.campaign_id into src from lb_messages m join lb_conversations v on v.id = m.conversation_id
      where v.customer_id = l.customer_id and m.automated and m.direction = 'out' and m.status in ('sent','delivered','read')
        and m.created_at > now() - interval '30 days' order by m.created_at desc limit 1;
    if src.id is not null then
      insert into lb_attributions (company_id, customer_id, lead_id, journey_id, campaign_id, source_message_id, event, amount)
      values (l.company_id, l.customer_id, l.id, src.journey_id, src.campaign_id, src.id, 'conversion', l.won_value)
      on conflict do nothing;
    end if;
    perform lb__fire_trigger(l.id, 'won');
  elsif new.type = 'status_change' and new.to_category in ('lost','invalid') then
    perform lb__end_enrollments(l.id, null, 'lost', 'stopped', 'lead ' || new.to_category);
  elsif new.type in ('created','repeat_created') then
    perform lb__fire_trigger(l.id, 'lead_created');
  elsif new.type = 'status_change' then
    perform lb__fire_status_entered(l.id, new.to_category, new.to_status_id);
  end if;
  return new;
end $$;

-- ================================================================== 3) city-wise allocation
alter table public.lb_alloc_sources add column if not exists cities text[];
alter table public.lb_alloc_sources add column if not exists name text;
-- One plain list per source (and one "Others"); city lists may repeat a source.
alter table public.lb_alloc_sources drop constraint if exists lb_alloc_sources_company_id_source_id_key;
create unique index if not exists lb_alloc_sources_one_per_source on public.lb_alloc_sources (company_id, source_id) nulls not distinct where cities is null;
create index if not exists lb_alloc_sources_city_lists on public.lb_alloc_sources (company_id) where cities is not null;

create or replace function public.lb__city_key(p text) returns text
language sql immutable as $$ select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

-- "Jaipur" matches "jaipur", "Jaipur, Rajasthan" and "Malviya Nagar, Jaipur".
create or replace function public.lb__city_match(p_loc text, p_cities text[]) returns boolean
language sql immutable as $$
  select lb__city_key(p_loc) <> '' and exists (
    select 1 from unnest(coalesce(p_cities, '{}')) c
    where lb__city_key(c) <> ''
      and (lb__city_key(p_loc) = lb__city_key(c)
           or left(lb__city_key(p_loc), length(lb__city_key(c)) + 1) = lb__city_key(c) || ','
           or right(lb__city_key(p_loc), length(lb__city_key(c)) + 2) = ', ' || lb__city_key(c)
           or right(lb__city_key(p_loc), length(lb__city_key(c)) + 1) = ',' || lb__city_key(c)))
$$;

create or replace function public.lb__alloc_source_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_id is not null and not exists (select 1 from lb_sources s where s.id = new.source_id and s.company_id = new.company_id) then
    raise exception 'Source must belong to this company';
  end if;
  if new.cities is not null then
    -- Trim, drop blanks and case-insensitive repeats (first spelling wins), keep the typed order.
    new.cities := array(select x.c from (
                          select distinct on (lb__city_key(c)) trim(regexp_replace(c, '\s+', ' ', 'g')) c, ord
                          from unnest(new.cities) with ordinality u(c, ord)
                          where trim(coalesce(c, '')) <> '' order by lb__city_key(c), ord) x
                        order by x.ord);
    if cardinality(new.cities) = 0 then raise exception 'Add at least one city'; end if;
    if cardinality(new.cities) > 50 then raise exception 'At most 50 cities in one list'; end if;
    new.name := nullif(left(trim(coalesce(new.name, '')), 60), '');
  end if;
  return new;
end $$;
drop trigger if exists lb_alloc_sources_check on public.lb_alloc_sources;
create trigger lb_alloc_sources_check before insert or update of source_id, company_id, cities, name on public.lb_alloc_sources
  for each row execute function public.lb__alloc_source_check();

-- Pick the next user of one list (smooth weighted round-robin) and book the turn.
-- Returns the member row, or an empty row when nobody in the list can take a lead now.
create or replace function public.lb__alloc_pick(p_alloc uuid, p_company uuid) returns public.lb_alloc_members
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_sum integer; v_pick lb_alloc_members;
begin
  perform 1 from lb_alloc_members m where m.alloc_id = p_alloc for update;
  select coalesce(sum(m.ratio), 0) into v_sum
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = p_alloc and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);
  if v_sum = 0 then return v_pick; end if;

  update lb_alloc_members m set rr_weight = m.rr_weight + m.ratio
  from lb_profiles u
  where u.id = m.user_id and m.alloc_id = p_alloc and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);

  select m.* into v_pick
  from lb_alloc_members m join lb_profiles u on u.id = m.user_id
  where m.alloc_id = p_alloc and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day)
  order by m.rr_weight desc, m.ratio desc, m.created_at, m.id
  limit 1;

  update lb_alloc_members set
    rr_weight = rr_weight - v_sum,
    day_count = case when day = v_today then day_count + 1 else 1 end,
    day = v_today,
    total_count = total_count + 1
  where id = v_pick.id;
  return v_pick;
end $$;
revoke all on function public.lb__alloc_pick(uuid, uuid) from public, anon, authenticated;

-- Same signature as before. City lists first (a list for the lead's source beats an
-- "any source" list), then the lead's source list, then "Others" — exactly as before.
create or replace function public.lb__auto_allocate(p_lead uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l lb_leads; a lb_alloc_sources; v_auto boolean; v_pick lb_alloc_members; v_src text; v_loc text;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or l.deleted_at is not null or l.owner_id is not null or lb__closed(l.status_category) then return l.owner_id; end if;
  select auto_allocate into v_auto from lb_companies where id = l.company_id;
  if not coalesce(v_auto, false) then return null; end if;

  -- City-wise lists.
  select location into v_loc from lb_customers where id = l.customer_id;
  if lb__city_key(v_loc) <> '' then
    for a in select * from lb_alloc_sources s
      where s.company_id = l.company_id and s.cities is not null and s.is_active
        and (s.source_id is null or s.source_id = l.source_id) and lb__city_match(v_loc, s.cities)
      order by (s.source_id is not null) desc, s.created_at, s.id
    loop
      v_pick := lb__alloc_pick(a.id, l.company_id);
      if v_pick.id is not null then
        perform lb__assign(p_lead, v_pick.user_id, p_actor, 'Auto allocation: city ' || coalesce(a.name, array_to_string(a.cities, ', ')) || ' (ratio ' || v_pick.ratio || ')');
        return v_pick.user_id;
      end if;
    end loop;
  end if;

  -- The lead's own source row wins (even when switched off); otherwise "Others".
  select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.cities is null and s.source_id = l.source_id;
  if a.id is null then
    select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.cities is null and s.source_id is null;
  end if;
  if a.id is null or not a.is_active then return null; end if;

  v_pick := lb__alloc_pick(a.id, l.company_id);
  if v_pick.id is null then return null; end if;
  select coalesce((select name from lb_sources where id = a.source_id), 'Others') into v_src;
  perform lb__assign(p_lead, v_pick.user_id, p_actor, 'Auto allocation: ' || v_src || ' (ratio ' || v_pick.ratio || ')');
  return v_pick.user_id;
end $$;
revoke all on function public.lb__auto_allocate(uuid, uuid) from public, anon, authenticated;

-- "Assign waiting leads": a city list takes the unassigned leads of its cities.
create or replace function public.lb_alloc_assign_waiting(p_alloc uuid, p_max integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare a lb_alloc_sources; v_id uuid; n integer := 0;
begin
  select * into a from lb_alloc_sources where id = p_alloc;
  if a.id is null or not lb_is_admin_of(a.company_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not a.is_active then raise exception 'Switch this source on first'; end if;
  for v_id in
    select l.id from lb_leads l
    left join lb_customers c on c.id = l.customer_id
    where l.company_id = a.company_id and l.deleted_at is null and l.owner_id is null and not lb__closed(l.status_category)
      and (case
             when a.cities is not null then lb__city_match(c.location, a.cities) and (a.source_id is null or l.source_id = a.source_id)
             when a.source_id is not null then l.source_id = a.source_id
             else not exists (select 1 from lb_alloc_sources s where s.company_id = a.company_id and s.cities is null and s.source_id is not null and s.source_id = l.source_id)
           end)
    order by l.created_at
    limit least(greatest(coalesce(p_max, 500), 1), 2000)
  loop
    if lb__auto_allocate(v_id, auth.uid()) is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_alloc_assign_waiting(uuid, integer) from public, anon;
grant execute on function public.lb_alloc_assign_waiting(uuid, integer) to authenticated;

-- City filled in later (chatbot "Update contact → City", agent edit): allocate the
-- customer's still-unassigned open leads, only when the company has a city list.
create or replace function public.lb__on_customer_city() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if lb__city_key(new.location) = '' or lb__city_key(new.location) = lb__city_key(old.location) then return new; end if;
  if not exists (select 1 from lb_alloc_sources s where s.company_id = new.company_id and s.cities is not null and s.is_active) then return new; end if;
  for v_id in select id from lb_leads where customer_id = new.id and company_id = new.company_id and owner_id is null
                and deleted_at is null and not lb__closed(status_category)
  loop
    perform lb__auto_allocate(v_id, null);
  end loop;
  return new;
end $$;
revoke all on function public.lb__on_customer_city() from public, anon, authenticated;
drop trigger if exists lb_customers_city_alloc on public.lb_customers;
create trigger lb_customers_city_alloc after update of location on public.lb_customers
  for each row execute function public.lb__on_customer_city();

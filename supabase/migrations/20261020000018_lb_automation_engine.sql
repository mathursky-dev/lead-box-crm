-- Automation engine v2.

-- ================================================================ availability & allocation
create or replace function lb__agent_available(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.is_active and p.availability = 'available' and (
      p.working_hours is null or (
        p.working_hours ? to_char(now() at time zone 'Asia/Kolkata', 'dy')
        and (now() at time zone 'Asia/Kolkata')::time >= (p.working_hours -> to_char(now() at time zone 'Asia/Kolkata', 'dy') ->> 0)::time
        and (now() at time zone 'Asia/Kolkata')::time <  (p.working_hours -> to_char(now() at time zone 'Asia/Kolkata', 'dy') ->> 1)::time))
    from lb_profiles p where p.id = p_user), false)
$$;

create or replace function lb__open_load(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from lb_leads where owner_id = p_user and not lb__closed(status_category)
$$;

-- Smart allocation: only available agents inside working hours and under their limit;
-- round-robin or least-loaded per rule; falls back to members' backups.
create or replace function lb__auto_allocate(p_lead uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l lb_leads; r record; v_user uuid; v_auto boolean; v_reason text;
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
    where ru.rule_id = r.id and u.company_id = l.company_id and u.accepts_auto_allocation and lb__agent_available(u.id)
      and (u.allocation_limit is null or lb__open_load(u.id) < u.allocation_limit)
    order by case when r.strategy = 'least_loaded' then lb__open_load(u.id) end nulls last,
             (u.id > coalesce(r.last_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) desc, u.id
    limit 1;
    v_reason := 'Auto allocation (' || replace(r.strategy, '_', ' ') || '): ' || r.name;
    if v_user is null and r.fallback_to_backup then
      select b.id into v_user
      from lb_allocation_rule_users ru join lb_profiles u on u.id = ru.user_id join lb_profiles b on b.id = u.backup_user_id
      where ru.rule_id = r.id and b.company_id = l.company_id and lb__agent_available(b.id)
        and (b.allocation_limit is null or lb__open_load(b.id) < b.allocation_limit)
      order by lb__open_load(b.id), b.id limit 1;
      v_reason := 'Backup assignment (rule members unavailable): ' || r.name;
    end if;
    if v_user is not null then
      update lb_allocation_rules set last_user_id = v_user where id = r.id;
      perform lb__assign(p_lead, v_user, p_actor, v_reason);
      return v_user;
    end if;
  end loop;
  return null;
end $$;

-- ================================================================ send eligibility (rechecked right before every send)
create or replace function lb__send_check(p_company uuid, p_customer uuid, p_number uuid, p_template text, p_lang text, p_offer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c lb_customers; n lb_wa_numbers; t lb_wa_templates; o lb_offers; co lb_companies; v_sent int; v_oldest timestamptz; v_quiet timestamptz;
        v_cat text; v_scope text;
begin
  select * into c from lb_customers where id = p_customer and company_id = p_company;
  select * into n from lb_wa_numbers where id = p_number and company_id = p_company;
  select * into co from lb_companies where id = p_company;
  if c.id is null then return '{"ok":false,"reason":"customer_missing","hard":true}'; end if;
  if co.automation_paused then return jsonb_build_object('ok', false, 'reason', 'automation_paused', 'hard', false, 'defer_until', now() + interval '15 minutes'); end if;
  if c.automation_paused_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'customer_paused', 'hard', false, 'defer_until', least(c.automation_paused_until, now() + interval '1 day'));
  end if;
  if c.wa_opted_out_at is not null then return '{"ok":false,"reason":"opted_out","hard":true}'; end if;
  if c.wa_opt_in_at is null then return '{"ok":false,"reason":"no_consent","hard":true}'; end if;
  if n.id is null or not n.is_active then return '{"ok":false,"reason":"number_unavailable","hard":false}'; end if;
  select * into t from lb_wa_templates where company_id = p_company and waba_id = n.waba_id and name = p_template and language = p_lang;
  if t.id is null or upper(t.status) <> 'APPROVED' then return '{"ok":false,"reason":"template_not_approved","hard":false}'; end if;
  v_cat := upper(coalesce(t.category, 'MARKETING'));
  select scope into v_scope from lb_suppressions s where s.company_id = p_company and s.phone_e164 = c.phone_e164;
  if v_scope = 'all' or (v_scope = 'marketing' and v_cat = 'MARKETING') then return '{"ok":false,"reason":"suppressed","hard":true}'; end if;
  if p_offer is not null then
    select * into o from lb_offers where id = p_offer and company_id = p_company;
    if o.id is null or o.status <> 'approved' then return '{"ok":false,"reason":"offer_not_approved","hard":false}'; end if;
    if now() < o.valid_from then return jsonb_build_object('ok', false, 'reason', 'offer_not_started', 'hard', false, 'defer_until', o.valid_from); end if;
    if now() >= o.valid_to then return '{"ok":false,"reason":"offer_expired","hard":true}'; end if;
  end if;
  if v_cat = 'MARKETING' then
    select count(*), min(m.created_at) into v_sent, v_oldest from lb_messages m join lb_conversations v on v.id = m.conversation_id
    where v.customer_id = p_customer and m.automated and m.direction = 'out' and m.status <> 'failed'
      and coalesce(m.template_category, 'MARKETING') = 'MARKETING' and m.created_at > now() - interval '7 days';
    if v_sent >= co.marketing_cap_per_week then
      return jsonb_build_object('ok', false, 'reason', 'frequency_cap', 'hard', false, 'defer_until', v_oldest + interval '7 days' + interval '1 minute');
    end if;
    v_quiet := lb__quiet_until(p_company);
    if v_quiet is not null then return jsonb_build_object('ok', false, 'reason', 'quiet_hours', 'hard', false, 'defer_until', v_quiet); end if;
  end if;
  return jsonb_build_object('ok', true, 'category', v_cat);
end $$;

create or replace function lb__queue_automated(p_company uuid, p_customer uuid, p_lead uuid, p_number uuid, p_template text, p_lang text,
  p_params jsonb, p_client uuid, p_journey uuid, p_enrollment uuid, p_campaign uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_msg uuid; l lb_leads; v_cat text;
begin
  select * into l from lb_leads where id = p_lead;
  select upper(t.category) into v_cat from lb_wa_templates t join lb_wa_numbers n on n.waba_id = t.waba_id and n.company_id = t.company_id
  where n.id = p_number and t.name = p_template and t.language = p_lang;
  insert into lb_conversations (company_id, number_id, customer_id, lead_id, team_id, assignee_id)
  values (p_company, p_number, p_customer, p_lead, l.team_id, l.owner_id)
  on conflict (number_id, customer_id) do update set lead_id = coalesce(lb_conversations.lead_id, excluded.lead_id)
  returning id into v_conv;
  insert into lb_messages (company_id, conversation_id, direction, type, template_name, template_language, template_params, template_category, client_id,
    status, next_attempt_at, automated, journey_id, enrollment_id, campaign_id)
  values (p_company, v_conv, 'out', 'template', p_template, p_lang, p_params, v_cat, p_client, 'queued', now(), true, p_journey, p_enrollment, p_campaign)
  on conflict (client_id) do nothing
  returning id into v_msg;
  if v_msg is null then select id into v_msg from lb_messages where client_id = p_client; return v_msg; end if;
  update lb_conversations set last_message_at = now(), last_message_preview = left('Template: ' || p_template, 140), updated_at = now() where id = v_conv;
  return v_msg;
end $$;

-- ================================================================ enrolment
create or replace function lb__end_enrollments(p_where_lead uuid, p_where_customer uuid, p_flag text, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select en.id, en.current_step from lb_journey_enrollments en join lb_journeys j on j.id = en.journey_id
    where en.status in ('active','paused') and (p_status <> 'paused' or en.status = 'active')
      and (p_where_lead is null or en.lead_id = p_where_lead) and (p_where_customer is null or en.customer_id = p_where_customer)
      and (p_flag is distinct from 'reply' or en.wait_reply_then is null)
      and (p_flag is null
           or (p_flag = 'purchase' and j.stop_on_purchase) or (p_flag = 'lost' and j.stop_on_lost)
           or (p_flag = 'takeover' and j.stop_on_manual_takeover) or (p_flag = 'reply' and j.pause_on_reply)
           or (p_flag = 'payment' and j.stop_on_payment) or (p_flag = 'complaint' and j.stop_on_complaint))
    for update of en
  loop
    update lb_journey_enrollments set status = p_status, status_reason = p_reason, updated_at = now(), locked_at = null where id = e.id;
    perform lb__journey_event(e.id, e.current_step, case p_status when 'paused' then 'paused' else 'stopped' end, p_reason);
  end loop;
end $$;

-- Event-style triggers may re-run for the same lead after a 24h cooldown; others run once per lead.
create or replace function lb__enroll(p_journey uuid, p_lead uuid, p_actor uuid, p_force boolean) returns text
language plpgsql security definer set search_path = public as $$
declare j lb_journeys; l lb_leads; cur record; v_id uuid;
        v_event boolean;
begin
  select * into j from lb_journeys where id = p_journey;
  select * into l from lb_leads where id = p_lead for update;
  if j.id is null or l.id is null or j.company_id <> l.company_id then return 'invalid'; end if;
  if j.status <> 'active' or j.current_version = 0 then return 'journey_not_active'; end if;
  if lb__closed(l.status_category) and not (j.runs_on_closed and l.status_category = 'won') then return 'lead_closed'; end if;
  v_event := j.trigger_type in ('inbound_message','buying_signal','sla_breach','payment_pending','complaint');
  if exists (select 1 from lb_journey_enrollments where journey_id = p_journey and lead_id = p_lead and status in ('active','paused')) then return 'already_running'; end if;
  if not p_force then
    if v_event and exists (select 1 from lb_journey_enrollments where journey_id = p_journey and lead_id = p_lead and enrolled_at > now() - interval '24 hours') then return 'cooldown'; end if;
    if not v_event and exists (select 1 from lb_journey_enrollments where journey_id = p_journey and lead_id = p_lead) then return 'already_enrolled_before'; end if;
  end if;
  select en.id, en.journey_id, jj.priority into cur from lb_journey_enrollments en join lb_journeys jj on jj.id = en.journey_id
    where en.lead_id = p_lead and en.status in ('active','paused');
  if cur.id is not null then
    if cur.priority <= j.priority and not p_force then return 'conflict_higher_priority'; end if;
    update lb_journey_enrollments set status = 'stopped', status_reason = 'superseded by ' || j.name, updated_at = now() where id = cur.id;
    perform lb__journey_event(cur.id, null, 'stopped', 'superseded by ' || j.name);
  end if;
  insert into lb_journey_enrollments (company_id, journey_id, lead_id, customer_id, enrolled_by, version)
  values (l.company_id, p_journey, p_lead, l.customer_id, p_actor, j.current_version) returning id into v_id;
  perform lb__journey_event(v_id, 1, 'enrolled', case when p_actor is null then 'automatic (' || j.trigger_type || ')' else 'manual' end || ' · v' || j.current_version);
  return 'enrolled';
end $$;

create or replace function lb__fire_trigger(p_lead uuid, p_trigger text, p_category text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l lb_leads; j record;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;
  for j in select id from lb_journeys where company_id = l.company_id and status = 'active' and trigger_type = p_trigger
    and (p_trigger <> 'status_entered' or trigger_config->>'category' = p_category)
    and (nullif(trigger_config->>'product_id','') is null or trigger_config->>'product_id' = l.product_id::text)
    and (nullif(trigger_config->>'source_id','') is null or trigger_config->>'source_id' = l.source_id::text)
    order by priority
  loop
    perform lb__enroll(j.id, l.id, null, false);
  end loop;
end $$;

-- ================================================================ journey runner v2
create or replace function lb_run_journeys(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e record; j lb_journeys; co lb_companies; st jsonb; l lb_leads; c jsonb; v_type text; chk jsonb; v_num uuid; v_msg uuid; v_next int; v_ok boolean;
  v_guard int; n int := 0; v_uid uuid; v_err text; v_sid uuid; v_paused timestamptz;
begin
  for j in select * from lb_journeys where status = 'active' and current_version > 0 and trigger_type = 'segment' and trigger_config ? 'segment_id' loop
    perform lb__enroll(j.id, x.lead_id, null, false)
    from (select distinct on (l2.customer_id) l2.id lead_id from lb_segment_leads((j.trigger_config->>'segment_id')::uuid) sl
          join lb_leads l2 on l2.id = sl.lead_id
          where not exists (select 1 from lb_journey_enrollments en where en.journey_id = j.id and en.lead_id = l2.id)
          order by l2.customer_id, l2.created_at desc limit 200) x;
  end loop;

  for e in
    update lb_journey_enrollments en set locked_at = now()
    where en.id in (select id from lb_journey_enrollments where status = 'active' and next_run_at <= now()
                    and (locked_at is null or locked_at < now() - interval '5 minutes')
                    order by next_run_at limit p_limit for update skip locked)
    returning en.*
  loop
    n := n + 1;
    select * into j from lb_journeys where id = e.journey_id;
    select * into co from lb_companies where id = e.company_id;
    select automation_paused_until into v_paused from lb_customers where id = e.customer_id;
    if co.automation_paused or v_paused > now() then
      update lb_journey_enrollments set locked_at = null,
        next_run_at = case when co.automation_paused then now() + interval '5 minutes' else least(v_paused, now() + interval '1 day') end where id = e.id;
      continue;
    end if;
    begin
      v_guard := 0;
      <<steps>>
      loop
        v_guard := v_guard + 1;
        exit steps when v_guard > 25;
        select * into l from lb_leads where id = e.lead_id;
        if j.status <> 'active' then
          update lb_journey_enrollments set next_run_at = now() + interval '15 minutes', locked_at = null where id = e.id; exit steps;
        end if;
        if lb__closed(l.status_category) and not (j.runs_on_closed and l.status_category = 'won') then
          update lb_journey_enrollments set status = 'stopped', status_reason = 'lead closed (' || l.status_category || ')', locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, e.current_step, 'stopped', 'lead closed'); exit steps;
        end if;
        st := null;
        select x.value into st from lb_journey_versions v, jsonb_array_elements(v.steps) with ordinality as x(value, ord)
          where v.journey_id = e.journey_id and v.version = e.version and x.ord = e.current_step;
        if st is null or st->>'type' = 'end' then
          update lb_journey_enrollments set status = 'completed', status_reason = null, locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, e.current_step, 'completed', null); exit steps;
        end if;
        v_type := st->>'type';
        c := coalesce(st->'config', '{}');
        v_next := coalesce(nullif(st->>'next_step','')::int, e.current_step + 1);

        if v_type = 'delay' then
          update lb_journey_enrollments set current_step = v_next, next_run_at = now() + make_interval(mins => greatest(1, coalesce((c->>'minutes')::int, 60))),
            locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, e.current_step, 'step_done', 'wait ' || coalesce(c->>'minutes','60') || ' min');
          exit steps;

        elsif v_type = 'wait_reply' then
          if e.wait_reply_then is null then
            update lb_journey_enrollments set wait_reply_then = coalesce((c->>'then_step')::int, v_next), wait_reply_else = coalesce((c->>'else_step')::int, v_next),
              next_run_at = now() + make_interval(mins => greatest(1, coalesce((c->>'minutes')::int, 1440))), locked_at = null, updated_at = now() where id = e.id;
            perform lb__journey_event(e.id, e.current_step, 'waiting_reply', 'up to ' || coalesce(c->>'minutes','1440') || ' min');
            exit steps;
          end if;
          v_next := e.wait_reply_else;
          update lb_journey_enrollments set current_step = v_next, wait_reply_then = null, wait_reply_else = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, e.current_step, 'reply_timeout', '→ step ' || v_next);
          e.current_step := v_next; e.wait_reply_then := null;
          continue steps;

        elsif v_type = 'task' then
          insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, action_type)
          values (l.company_id, l.id, l.owner_id, now() + make_interval(hours => coalesce((c->>'due_in_hours')::int, 4)),
                  coalesce(c->>'title', 'Journey task: ' || j.name), coalesce(nullif(c->>'action_type',''), 'call'));
          insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
          values (l.company_id, l.id, l.owner_id, 'followup_created', jsonb_build_object('journey', j.name, 'note', c->>'title'));
          perform lb__refresh_next_followup(l.id);
          perform lb__notify(l.company_id, l.owner_id, 'task', 'New task from journey: ' || j.name, c->>'title', '/leads/' || l.id, 'jt:' || e.id || ':' || e.current_step || ':' || e.enrolled_at);
          perform lb__journey_event(e.id, e.current_step, 'task_created', c->>'title');

        elsif v_type = 'branch' then
          v_ok := case c->>'condition'
            when 'replied' then exists (select 1 from lb_messages m join lb_conversations v on v.id = m.conversation_id
                                        where v.customer_id = e.customer_id and m.direction = 'in' and m.created_at > e.enrolled_at)
            when 'status_in' then l.status_category = any(array(select jsonb_array_elements_text(coalesce(c->'values','[]'))))
            when 'purchased' then exists (select 1 from lb_leads x where x.customer_id = e.customer_id and x.status_category = 'won')
            when 'paid' then l.payment_status = 'paid'
            when 'opted_in' then exists (select 1 from lb_customers x where x.id = e.customer_id and x.wa_opt_in_at is not null and x.wa_opted_out_at is null)
            when 'product' then l.product_id::text = c->>'value'
            when 'priority_high' then l.priority in ('high','urgent')
            when 'owner_available' then l.owner_id is not null and lb__agent_available(l.owner_id)
            when 'buying_signal' then exists (select 1 from lb_signals s where s.customer_id = e.customer_id and s.created_at > e.enrolled_at)
            else false end;
          v_next := case when v_ok then coalesce((c->>'then_step')::int, v_next) else coalesce((c->>'else_step')::int, v_next) end;
          perform lb__journey_event(e.id, e.current_step, 'branch', (c->>'condition') || ' = ' || v_ok || ' → step ' || v_next);

        elsif v_type = 'assign' then
          if c->>'mode' = 'user' then
            perform lb__assign(l.id, (c->>'user_id')::uuid, null, coalesce(nullif(c->>'reason',''), 'Journey: ' || j.name));
          elsif l.owner_id is null then
            perform lb__auto_allocate(l.id, null);
          elsif not lb__agent_available(l.owner_id) then
            v_uid := null;
            select b.id into v_uid from lb_profiles o join lb_profiles b on b.id = o.backup_user_id where o.id = l.owner_id and lb__agent_available(b.id);
            if v_uid is not null then perform lb__assign(l.id, v_uid, null, 'Journey ' || j.name || ': owner unavailable, backup assigned'); end if;
          end if;
          perform lb__journey_event(e.id, e.current_step, 'assigned', (select full_name from lb_profiles p join lb_leads x on x.owner_id = p.id where x.id = l.id));

        elsif v_type = 'set_status' then
          select id into v_sid from lb_lead_statuses where company_id = l.company_id and category = c->>'category' and is_active order by is_default desc, sort_order limit 1;
          if v_sid is null then raise exception 'No active status for category %', c->>'category'; end if;
          perform lb__set_status(l.id, v_sid, null, 'Journey: ' || j.name, null, false);
          perform lb__journey_event(e.id, e.current_step, 'status_set', c->>'category');

        elsif v_type = 'tag' then
          insert into lb_lead_tags select l.id, t.id from lb_tags t where t.id = nullif(c->>'tag_id','')::uuid and t.company_id = l.company_id on conflict do nothing;
          perform lb__journey_event(e.id, e.current_step, 'tagged', c->>'tag_id');

        elsif v_type = 'notify' then
          for v_uid in select unnest(case c->>'target'
              when 'owner' then array[l.owner_id]
              when 'user' then array[nullif(c->>'user_id','')::uuid]
              when 'team_leaders' then array(select p.id from lb_profiles p where p.company_id = l.company_id and p.is_active and p.role = 'team_leader'
                                             and l.team_id is not null and l.team_id = any(lb_team_ids_for(p.id)))
              else array(select p.id from lb_profiles p where p.company_id = l.company_id and p.is_active and p.role = 'company_admin') end)
          loop
            perform lb__notify(l.company_id, v_uid, 'journey', coalesce(nullif(c->>'title',''), 'Journey: ' || j.name), c->>'body', '/leads/' || l.id,
              'jn:' || e.id || ':' || e.current_step || ':' || v_uid);
          end loop;
          perform lb__journey_event(e.id, e.current_step, 'notified', c->>'target');

        elsif v_type = 'ai_summary' then
          insert into lb_jobs (company_id, kind, payload, idempotency_key)
          values (l.company_id, 'ai_summary', jsonb_build_object('lead_id', l.id, 'customer_id', l.customer_id, 'notify_user', l.owner_id),
                  'jsum:' || e.id || ':' || e.current_step)
          on conflict (idempotency_key) do nothing;
          perform lb__journey_event(e.id, e.current_step, 'ai_summary_requested', null);

        elsif v_type = 'message' then
          v_num := coalesce(nullif(c->>'number_id','')::uuid, l.number_id, j.number_id,
                            (select id from lb_wa_numbers where company_id = l.company_id and is_active and status = 'connected' order by created_at limit 1));
          chk := lb__send_check(l.company_id, e.customer_id, v_num, c->>'template_name', c->>'template_language', nullif(c->>'offer_id','')::uuid);
          if (chk->>'ok')::boolean then
            v_msg := lb__queue_automated(l.company_id, e.customer_id, l.id, v_num, c->>'template_name', c->>'template_language',
              lb__render_params(c->'params', e.customer_id, nullif(c->>'offer_id','')::uuid),
              md5(e.id::text || ':' || e.current_step || ':' || coalesce(c->>'template_name',''))::uuid, j.id, e.id, null);
            perform lb__journey_event(e.id, e.current_step, 'message_queued', c->>'template_name', v_msg);
            update lb_journey_enrollments set last_message_at = now() where id = e.id;
          elsif chk ? 'defer_until' then
            update lb_journey_enrollments set next_run_at = (chk->>'defer_until')::timestamptz, locked_at = null, updated_at = now() where id = e.id;
            perform lb__journey_event(e.id, e.current_step, 'deferred', chk->>'reason'); exit steps;
          elsif (chk->>'hard')::boolean then
            update lb_journey_enrollments set status = 'stopped', status_reason = chk->>'reason', locked_at = null, updated_at = now() where id = e.id;
            perform lb__journey_event(e.id, e.current_step, 'stopped', chk->>'reason'); exit steps;
          else
            raise exception 'Send blocked: %', chk->>'reason';
          end if;
        else
          raise exception 'Unknown step type %', v_type;
        end if;

        -- advance (all non-exiting step types)
        if not exists (select 1 from lb_journey_enrollments where id = e.id and status = 'active') then exit steps; end if;
        update lb_journey_enrollments set current_step = v_next, updated_at = now() where id = e.id;
        e.current_step := v_next;
      end loop steps;
      update lb_journey_enrollments set attempts = 0, last_error = null,
        locked_at = null, next_run_at = case when next_run_at <= now() then now() else next_run_at end
      where id = e.id and (locked_at is not null or attempts > 0);
    exception when others then
      get stacked diagnostics v_err = message_text;
      update lb_journey_enrollments set attempts = attempts + 1, last_error = left(v_err, 500), locked_at = null,
        status = case when attempts + 1 >= 5 then 'failed' else status end,
        status_reason = case when attempts + 1 >= 5 then 'error: ' || left(v_err, 200) else status_reason end,
        next_run_at = now() + make_interval(mins => power(2, attempts + 1)::int), updated_at = now()
      where id = e.id;
      perform lb__journey_event(e.id, e.current_step, case when e.attempts + 1 >= 5 then 'failed' else 'retry_scheduled' end, left(v_err, 300));
    end;
  end loop;
  return n;
end $$;

-- ================================================================ complaints & signals
create or replace function lb__raise_complaint(p_conv uuid, p_msg uuid, p_source text, p_matched text, p_note text, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v lb_conversations; cu lb_customers; v_id uuid; u uuid;
begin
  select * into v from lb_conversations where id = p_conv;
  select * into cu from lb_customers where id = v.customer_id;
  if p_source = 'keyword' then
    select id into v_id from lb_complaints where customer_id = cu.id and status = 'open' and created_at > now() - interval '24 hours' limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into lb_complaints (company_id, customer_id, conversation_id, lead_id, message_id, source, matched, note, created_by)
  values (v.company_id, cu.id, v.id, v.lead_id, p_msg, p_source, p_matched, p_note, p_actor) returning id into v_id;
  -- Complaint-triggered marketing suppression (does not loosen an existing full suppression).
  insert into lb_suppressions (company_id, phone_e164, reason, scope, created_by)
  values (v.company_id, cu.phone_e164, 'complaint' || coalesce(': ' || coalesce(p_matched, p_note), ''), 'marketing', p_actor)
  on conflict (company_id, phone_e164) do nothing;
  perform lb__end_enrollments(null, cu.id, 'complaint', 'stopped', 'complaint raised');
  for u in select x from unnest(array_append(array(select p.id from lb_profiles p where p.company_id = v.company_id and p.is_active
            and (p.role = 'company_admin' or (p.role = 'team_leader' and v.team_id is not null and v.team_id = any(lb_team_ids_for(p.id))))), v.assignee_id)) x
            where x is not null
  loop
    perform lb__notify(v.company_id, u, 'complaint', 'Complaint: ' || coalesce(cu.name, cu.wa_profile_name, cu.phone_e164),
      coalesce(p_note, 'Matched "' || p_matched || '"'), '/inbox?c=' || v.id, 'cmp:' || v_id || ':' || u);
  end loop;
  if v.lead_id is not null then perform lb__fire_trigger(v.lead_id, 'complaint'); end if;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (v.company_id, p_actor, 'complaint.raise', 'customer', cu.id::text, jsonb_build_object('source', p_source, 'matched', p_matched, 'note', p_note));
  return v_id;
end $$;

create or replace function lb_complaint_action(p_conv uuid, p_action text, p_note text default null, p_complaint uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('complaints.manage'); k lb_complaints;
begin
  if p_action = 'raise' then
    if not lb_can_see_conversation_id(p_conv) then raise exception 'Not permitted' using errcode='42501'; end if;
    if coalesce(trim(p_note),'') = '' then raise exception 'Describe the complaint'; end if;
    return lb__raise_complaint(p_conv, null, 'manual', null, p_note, me.id);
  elsif p_action = 'resolve' then
    select * into k from lb_complaints where id = p_complaint for update;
    if k.id is null or not lb_can_see_customer(k.customer_id) then raise exception 'Not permitted' using errcode='42501'; end if;
    update lb_complaints set status = 'resolved', resolved_by = me.id, resolved_at = now(), note = coalesce(note || E'\n', '') || coalesce('Resolution: ' || p_note, '') where id = k.id;
    perform lb_audit(me.company_id, 'complaint.resolve', 'complaint', k.id::text, jsonb_build_object('note', p_note));
    return k.id;
  end if;
  raise exception 'Unknown action';
end $$;

-- ================================================================ hooks v2
create or replace function lb__on_lead_event() returns trigger
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
    perform lb__fire_trigger(l.id, 'status_entered', new.to_category);
  end if;
  return new;
end $$;

create or replace function lb__on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v lb_conversations; co lb_companies; src record; r record; v_body text; v_hit text; cu lb_customers;
begin
  select * into v from lb_conversations where id = new.conversation_id;
  if new.direction = 'in' then
    select * into co from lb_companies where id = v.company_id;
    update lb_conversations set awaiting_reply_since = coalesce(awaiting_reply_since, new.created_at) where id = v.id;
    perform lb__end_enrollments(null, v.customer_id, 'reply', 'paused', 'customer replied');
    -- "Wait for reply" steps continue on their reply branch.
    for r in update lb_journey_enrollments set current_step = wait_reply_then, wait_reply_then = null, wait_reply_else = null, next_run_at = now(), updated_at = now()
             where customer_id = v.customer_id and status = 'active' and wait_reply_then is not null returning id, current_step
    loop perform lb__journey_event(r.id, r.current_step, 'reply_received', '→ step ' || r.current_step); end loop;
    select m.id, m.journey_id, m.campaign_id into src from lb_messages m join lb_conversations c on c.id = m.conversation_id
      where c.customer_id = v.customer_id and m.automated and m.direction = 'out' and m.created_at > now() - interval '7 days'
        and not exists (select 1 from lb_attributions a where a.source_message_id = m.id and a.event = 'reply')
      order by m.created_at desc limit 1;
    if src.id is not null then
      insert into lb_attributions (company_id, customer_id, lead_id, journey_id, campaign_id, source_message_id, event)
      values (v.company_id, v.customer_id, v.lead_id, src.journey_id, src.campaign_id, src.id, 'reply');
    end if;
    v_body := lower(coalesce(new.body, ''));
    if v_body <> '' then
      select k into v_hit from unnest(co.complaint_keywords) k where v_body ~ ('\m' || lower(k) || '\M') limit 1;
      if v_hit is not null then
        perform lb__raise_complaint(v.id, new.id, 'keyword', v_hit, null, null);
      else
        select k into v_hit from unnest(co.buying_keywords) k where v_body ~ ('\m' || lower(k) || '\M') limit 1;
        if v_hit is not null and not exists (select 1 from lb_signals s where s.conversation_id = v.id and s.created_at > now() - interval '6 hours') then
          select * into cu from lb_customers where id = v.customer_id;
          insert into lb_signals (company_id, customer_id, conversation_id, lead_id, message_id, matched)
          values (v.company_id, v.customer_id, v.id, v.lead_id, new.id, v_hit) on conflict do nothing;
          perform lb__notify(v.company_id, v.assignee_id, 'signal', 'Buying signal: ' || coalesce(cu.name, cu.wa_profile_name, cu.phone_e164),
            left(new.body, 120), '/inbox?c=' || v.id, 'sig:' || new.id);
          if v.lead_id is not null then perform lb__fire_trigger(v.lead_id, 'buying_signal'); end if;
        end if;
      end if;
    end if;
    if v.lead_id is not null then perform lb__fire_trigger(v.lead_id, 'inbound_message'); end if;
  elsif not new.automated then
    update lb_conversations set last_outbound_at = new.created_at, awaiting_reply_since = null, sla_alerted_at = null, sla_escalated_at = null where id = v.id;
    perform lb__end_enrollments(null, v.customer_id, 'takeover', 'stopped', 'manual takeover');
  else
    update lb_conversations set last_outbound_at = new.created_at where id = v.id;
  end if;
  return new;
end $$;

create or replace function lb_set_payment(p_lead uuid, p_status text, p_amount numeric, p_due timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('leads.edit'); l lb_leads;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_status not in ('none','pending','partial','paid') then raise exception 'Invalid payment status'; end if;
  update lb_leads set payment_status = p_status, payment_due_amount = p_amount, payment_due_at = p_due, last_activity_at = now(), updated_at = now() where id = l.id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, l.id, me.id, l.owner_id, 'field_update', true, jsonb_build_object('payment_status', p_status, 'payment_due_amount', p_amount, 'payment_due_at', p_due));
  if p_status = 'paid' and l.payment_status <> 'paid' then
    perform lb__end_enrollments(l.id, null, 'payment', 'stopped', 'payment received');
  elsif p_status in ('pending','partial') and l.payment_status not in ('pending','partial') then
    perform lb__fire_trigger(l.id, 'payment_pending');
  end if;
end $$;

-- ================================================================ scheduled work
create or replace function lb_run_sla() returns integer
language plpgsql security definer set search_path = public as $$
declare v record; u uuid; n int := 0; v_targets uuid[]; v_first uuid[]; v_backup uuid;
begin
  for v in
    select cv.*, co.sla_first_response_minutes sla1, co.sla_escalation_minutes sla2, cu.name cname, cu.phone_e164
    from lb_conversations cv join lb_companies co on co.id = cv.company_id join lb_customers cu on cu.id = cv.customer_id
    where cv.awaiting_reply_since is not null and cv.status <> 'resolved'
      and cv.awaiting_reply_since < now() - make_interval(mins => co.sla_first_response_minutes)
    for update of cv skip locked
  loop
    v_targets := array(select id from lb_profiles p where p.company_id = v.company_id and p.is_active
                       and (p.role = 'company_admin' or (p.role = 'team_leader' and v.team_id is not null and v.team_id = any(lb_team_ids_for(p.id)))));
    v_backup := null;
    if v.assignee_id is not null and not lb__agent_available(v.assignee_id) then
      select b.id into v_backup from lb_profiles o join lb_profiles b on b.id = o.backup_user_id where o.id = v.assignee_id and lb__agent_available(b.id);
    end if;
    v_first := case when v.assignee_id is null then v_targets else array_remove(array[v.assignee_id, v_backup], null) end;
    if v.sla_alerted_at is null or v.sla_alerted_at < v.awaiting_reply_since then
      insert into lb_sla_events (company_id, conversation_id, level, awaiting_since, notified)
      values (v.company_id, v.id, 'breach', v.awaiting_reply_since, v_first) on conflict do nothing;
      foreach u in array v_first loop
        perform lb__notify(v.company_id, u, 'sla', 'Reply overdue: ' || coalesce(v.cname, v.phone_e164),
          'Waiting since ' || to_char(v.awaiting_reply_since at time zone 'Asia/Kolkata', 'HH24:MI') || case when u = v_backup then ' (you are the backup)' else '' end,
          '/inbox?c=' || v.id, 'sla1:' || v.id || ':' || extract(epoch from v.awaiting_reply_since)::bigint || ':' || u);
      end loop;
      update lb_conversations set sla_alerted_at = now() where id = v.id; n := n + 1;
      if v.lead_id is not null then perform lb__fire_trigger(v.lead_id, 'sla_breach'); end if;
    end if;
    if v.awaiting_reply_since < now() - make_interval(mins => v.sla2)
       and (v.sla_escalated_at is null or v.sla_escalated_at < v.awaiting_reply_since) then
      insert into lb_sla_events (company_id, conversation_id, level, awaiting_since, notified)
      values (v.company_id, v.id, 'escalation', v.awaiting_reply_since, v_targets) on conflict do nothing;
      foreach u in array v_targets loop
        perform lb__notify(v.company_id, u, 'escalation', 'Escalated: no reply to ' || coalesce(v.cname, v.phone_e164),
          'Unanswered for over ' || v.sla2 || ' min', '/inbox?c=' || v.id,
          'sla2:' || v.id || ':' || extract(epoch from v.awaiting_reply_since)::bigint || ':' || u);
      end loop;
      update lb_conversations set sla_escalated_at = now() where id = v.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function lb_run_scheduled_triggers() returns integer
language plpgsql security definer set search_path = public as $$
declare j record; n int := 0; v_days int;
begin
  for j in select * from lb_journeys where status = 'active' and current_version > 0 and trigger_type = 'days_after_won' loop
    v_days := greatest(1, coalesce((j.trigger_config->>'days')::int, 30));
    perform lb__enroll(j.id, l.id, null, false) from lb_leads l
    where l.company_id = j.company_id and l.status_category = 'won'
      and l.converted_at < now() - make_interval(days => v_days) and l.converted_at > now() - make_interval(days => v_days + 2)
      and not exists (select 1 from lb_journey_enrollments x where x.journey_id = j.id and x.lead_id = l.id)
    limit 200;
    get diagnostics n = row_count;
  end loop;
  return n;
end $$;

create or replace function lb_run_digests() returns integer
language plpgsql security definer set search_path = public as $$
declare co record; u record; v_from timestamptz; v_to timestamptz; s jsonb; n int := 0;
begin
  for co in select * from lb_companies where is_active and extract(hour from now() at time zone 'Asia/Kolkata') = digest_hour loop
    v_to := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    v_from := v_to - interval '1 day';
    s := jsonb_build_object(
      'new', (select count(*) from lb_leads where company_id = co.id and created_at >= v_from and created_at < v_to),
      'won', (select count(*) from lb_leads where company_id = co.id and converted_at >= v_from and converted_at < v_to),
      'value', (select coalesce(sum(won_value), 0) from lb_leads where company_id = co.id and converted_at >= v_from and converted_at < v_to),
      'unassigned', (select count(*) from lb_leads where company_id = co.id and owner_id is null and not lb__closed(status_category)),
      'overdue', (select count(distinct lead_id) from lb_followups where company_id = co.id and status = 'pending' and due_at < v_to),
      'sla', (select count(*) from lb_sla_events where company_id = co.id and level = 'breach' and created_at >= v_from and created_at < v_to),
      'complaints', (select count(*) from lb_complaints where company_id = co.id and created_at >= v_from and created_at < v_to));
    for u in select id from lb_profiles where company_id = co.id and is_active and role in ('company_admin','team_leader','super_admin') loop
      perform lb__notify(co.id, u.id, 'digest', 'Daily digest · ' || to_char(v_from at time zone 'Asia/Kolkata', 'DD Mon'),
        format('%s new · %s won (₹%s) · %s unassigned · %s overdue · %s SLA breaches · %s complaints',
          s->>'new', s->>'won', s->>'value', s->>'unassigned', s->>'overdue', s->>'sla', s->>'complaints'),
        '/nurture/digest', 'digest:' || u.id || ':' || to_char(v_from at time zone 'Asia/Kolkata', 'YYYYMMDD'));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

create or replace function lb_nurture_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'; k text;
begin
  foreach k in array array['sla','scheduled','journeys','campaigns','reminders','digests'] loop
    begin
      r := r || jsonb_build_object(k, case k
        when 'sla' then lb_run_sla() when 'scheduled' then lb_run_scheduled_triggers() when 'journeys' then lb_run_journeys()
        when 'campaigns' then lb_run_campaigns() when 'reminders' then lb_run_reminders() else lb_run_digests() end);
    exception when others then
      r := r || jsonb_build_object(k || '_error', sqlerrm);
      insert into lb_settings (key, value) values ('tick_error_' || k, now() || ': ' || sqlerrm)
      on conflict (key) do update set value = excluded.value;
    end;
  end loop;
  return r;
end $$;

-- ================================================================ journeys: save, preview, publish, controls
create or replace function lb_save_journey(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); v_id uuid := nullif(p->>'id','')::uuid; st jsonb; i int := 0; v_max int; cfg jsonb;
        v_trig text := p->>'trigger_type';
begin
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Journey name is required'; end if;
  if v_trig not in ('status_entered','lead_created','segment','manual','inbound_message','buying_signal','sla_breach','payment_pending','won','days_after_won','complaint') then
    raise exception 'Invalid trigger'; end if;
  if v_trig = 'status_entered' and coalesce(p->'trigger_config'->>'category','') = '' then raise exception 'Choose the status category that starts this journey'; end if;
  if v_trig = 'segment' and not exists (select 1 from lb_segments where id = nullif(p->'trigger_config'->>'segment_id','')::uuid and company_id = me.company_id) then
    raise exception 'Choose a segment for this journey'; end if;
  v_max := jsonb_array_length(coalesce(p->'steps','[]'));
  if v_max = 0 then raise exception 'Add at least one step'; end if;
  for st in select * from jsonb_array_elements(p->'steps') loop
    i := i + 1; cfg := coalesce(st->'config','{}');
    case st->>'type'
      when 'message' then
        if coalesce(cfg->>'template_name','') = '' or coalesce(cfg->>'template_language','') = '' then
          raise exception 'Step %: choose an approved template (business-initiated WhatsApp messages must use templates)', i; end if;
        if nullif(cfg->>'offer_id','') is not null and not exists (select 1 from lb_offers where id = (cfg->>'offer_id')::uuid and company_id = me.company_id) then
          raise exception 'Step %: invalid offer', i; end if;
      when 'branch', 'wait_reply' then
        if coalesce((cfg->>'then_step')::int, 0) not between 1 and v_max + 1 or coalesce((cfg->>'else_step')::int, 0) not between 1 and v_max + 1 then
          raise exception 'Step %: target steps must be between 1 and %', i, v_max + 1; end if;
        if st->>'type' = 'branch' and coalesce(cfg->>'condition','') = '' then raise exception 'Step %: choose a condition', i; end if;
      when 'assign' then
        if coalesce(cfg->>'mode','smart') = 'user' and not exists (select 1 from lb_profiles where id = nullif(cfg->>'user_id','')::uuid and company_id = me.company_id) then
          raise exception 'Step %: choose a user', i; end if;
      when 'set_status' then
        if coalesce(cfg->>'category','') not in ('new','assigned','contacted','interested','follow_up','scheduled','won','lost','invalid') then
          raise exception 'Step %: choose a status category', i; end if;
      when 'tag' then
        if not exists (select 1 from lb_tags where id = nullif(cfg->>'tag_id','')::uuid and company_id = me.company_id) then raise exception 'Step %: choose a tag', i; end if;
      when 'notify' then
        if coalesce(cfg->>'target','') not in ('owner','team_leaders','admins','user') or coalesce(trim(cfg->>'title'),'') = '' then
          raise exception 'Step %: choose who to notify and a title', i; end if;
      when 'task', 'delay', 'end', 'ai_summary' then null;
      else raise exception 'Step %: invalid type', i;
    end case;
  end loop;
  if v_id is null then
    insert into lb_journeys (company_id, name, description, trigger_type, trigger_config, priority, number_id, pause_on_reply, stop_on_purchase, stop_on_lost,
      stop_on_manual_takeover, stop_on_payment, stop_on_complaint, runs_on_closed, created_by)
    values (me.company_id, trim(p->>'name'), p->>'description', v_trig, coalesce(p->'trigger_config','{}'), coalesce((p->>'priority')::int, 100),
      nullif(p->>'number_id','')::uuid, coalesce((p->>'pause_on_reply')::boolean, true), coalesce((p->>'stop_on_purchase')::boolean, true),
      coalesce((p->>'stop_on_lost')::boolean, true), coalesce((p->>'stop_on_manual_takeover')::boolean, true),
      coalesce((p->>'stop_on_payment')::boolean, false), coalesce((p->>'stop_on_complaint')::boolean, true), v_trig in ('won','days_after_won'), me.id)
    returning id into v_id;
  else
    update lb_journeys set name = trim(p->>'name'), description = p->>'description', trigger_type = v_trig, trigger_config = coalesce(p->'trigger_config','{}'),
      priority = coalesce((p->>'priority')::int, 100), number_id = nullif(p->>'number_id','')::uuid,
      pause_on_reply = coalesce((p->>'pause_on_reply')::boolean, true), stop_on_purchase = coalesce((p->>'stop_on_purchase')::boolean, true),
      stop_on_lost = coalesce((p->>'stop_on_lost')::boolean, true), stop_on_manual_takeover = coalesce((p->>'stop_on_manual_takeover')::boolean, true),
      stop_on_payment = coalesce((p->>'stop_on_payment')::boolean, false), stop_on_complaint = coalesce((p->>'stop_on_complaint')::boolean, true),
      runs_on_closed = v_trig in ('won','days_after_won'), draft_updated_at = now(), updated_at = now()
    where id = v_id and company_id = me.company_id;
    if not found then raise exception 'Journey not found'; end if;
    delete from lb_journey_steps where journey_id = v_id;
  end if;
  insert into lb_journey_steps (journey_id, step_no, type, config, next_step)
  select v_id, ord, x->>'type', coalesce(x->'config','{}'), nullif(x->>'next_step','')::int
  from jsonb_array_elements(p->'steps') with ordinality as t(x, ord);
  perform lb_audit(me.company_id, 'journey.save_draft', 'journey', v_id::text, jsonb_build_object('name', p->>'name', 'steps', v_max));
  return v_id;
end $$;

-- What will happen if this draft is published: audience estimate, actions, warnings.
create or replace function lb_journey_preview(p_journey uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); j lb_journeys; w text[] := '{}'; st record; aud jsonb; v_cnt bigint;
begin
  select * into j from lb_journeys where id = p_journey and company_id = me.company_id;
  if j.id is null then raise exception 'Journey not found'; end if;
  if not exists (select 1 from lb_wa_numbers where company_id = j.company_id and is_active and status = 'connected') then
    w := w || 'No connected WhatsApp number: message steps will fail.'; end if;
  for st in select * from lb_journey_steps where journey_id = j.id order by step_no loop
    if st.type = 'message' then
      if not exists (select 1 from lb_wa_templates t where t.company_id = j.company_id and t.name = st.config->>'template_name'
                     and t.language = st.config->>'template_language' and upper(t.status) = 'APPROVED') then
        w := w || format('Step %s: template %s is not approved/synced.', st.step_no, st.config->>'template_name'); end if;
      if nullif(st.config->>'offer_id','') is not null and not exists (select 1 from lb_offers o where o.id = (st.config->>'offer_id')::uuid
                     and o.status = 'approved' and o.valid_to > now()) then
        w := w || format('Step %s: offer is not approved or has expired — the step will be held.', st.step_no); end if;
    end if;
  end loop;
  if j.trigger_type = 'segment' then
    with s as (select c.* from lb_segment_leads((j.trigger_config->>'segment_id')::uuid) sl join lb_customers c on c.id = sl.customer_id)
    select jsonb_build_object('label', 'Leads in the segment now (each is enrolled once)', 'total', count(*),
      'eligible', count(*) filter (where wa_opt_in_at is not null and wa_opted_out_at is null),
      'sample', coalesce((select jsonb_agg(coalesce(name, phone_e164)) from (select name, phone_e164 from s where wa_opt_in_at is not null and wa_opted_out_at is null limit 5) x), '[]'))
    into aud from s;
  else
    v_cnt := case j.trigger_type
      when 'status_entered' then (select count(*) from lb_leads where company_id = j.company_id and status_category = j.trigger_config->>'category')
      when 'lead_created' then (select count(*) from lb_leads where company_id = j.company_id and created_at > now() - interval '30 days')
      when 'won' then (select count(*) from lb_leads where company_id = j.company_id and converted_at > now() - interval '30 days')
      when 'days_after_won' then (select count(*) from lb_leads where company_id = j.company_id and status_category = 'won'
           and converted_at between now() - make_interval(days => coalesce((j.trigger_config->>'days')::int, 30)) and now() - make_interval(days => coalesce((j.trigger_config->>'days')::int, 30) - 7))
      when 'payment_pending' then (select count(*) from lb_leads where company_id = j.company_id and payment_status in ('pending','partial'))
      when 'complaint' then (select count(*) from lb_complaints where company_id = j.company_id and created_at > now() - interval '30 days')
      when 'buying_signal' then (select count(*) from lb_signals where company_id = j.company_id and created_at > now() - interval '30 days')
      when 'sla_breach' then (select count(*) from lb_sla_events where company_id = j.company_id and level = 'breach' and created_at > now() - interval '30 days')
      when 'inbound_message' then (select count(distinct conversation_id) from lb_messages where company_id = j.company_id and direction = 'in' and created_at > now() - interval '30 days')
      else 0 end;
    aud := jsonb_build_object('label', case j.trigger_type
      when 'status_entered' then 'Leads currently in this status (only leads that ENTER it after publishing are enrolled)'
      when 'days_after_won' then 'Won leads reaching the delay in the next 7 days'
      when 'payment_pending' then 'Leads with a pending payment now (enrolled when payment becomes pending)'
      when 'manual' then 'Manual enrolment only'
      else 'Matching events in the last 30 days (expected volume)' end, 'total', v_cnt);
  end if;
  return jsonb_build_object('journey', to_jsonb(j), 'audience', aud, 'warnings', to_jsonb(w),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('step_no', step_no, 'type', type, 'config', config, 'next_step', next_step) order by step_no)
                       from lb_journey_steps where journey_id = j.id), '[]'),
    'running', coalesce((select jsonb_agg(row_to_json(x)) from (select version, status, count(*) n from lb_journey_enrollments where journey_id = j.id
                         and status in ('active','paused') group by 1, 2 order by 1) x), '[]'),
    'unpublished_changes', j.current_version = 0 or j.draft_updated_at > coalesce((select max(published_at) from lb_journey_versions where journey_id = j.id), '-infinity'));
end $$;

create or replace function lb_publish_journey(p_journey uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); j lb_journeys; v int;
begin
  select * into j from lb_journeys where id = p_journey and company_id = me.company_id for update;
  if j.id is null then raise exception 'Journey not found'; end if;
  if not exists (select 1 from lb_journey_steps where journey_id = j.id) then raise exception 'Add steps before publishing'; end if;
  v := j.current_version + 1;
  insert into lb_journey_versions (journey_id, version, steps, settings, published_by)
  values (j.id, v, (select jsonb_agg(jsonb_build_object('type', type, 'config', config, 'next_step', next_step) order by step_no) from lb_journey_steps where journey_id = j.id),
          to_jsonb(j), me.id);
  update lb_journeys set current_version = v, status = 'active', updated_at = now() where id = j.id;
  perform lb_audit(me.company_id, 'journey.publish', 'journey', j.id::text, jsonb_build_object('version', v));
  return v;
end $$;

create or replace function lb_journey_action(p_journey uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); j lb_journeys;
begin
  select * into j from lb_journeys where id = p_journey and company_id = me.company_id for update;
  if j.id is null then raise exception 'Journey not found'; end if;
  if p_action = 'activate' then
    if j.current_version = 0 then raise exception 'Preview and publish the journey first'; end if;
    update lb_journeys set status = 'active', updated_at = now() where id = j.id;
  elsif p_action = 'pause' then update lb_journeys set status = 'paused', updated_at = now() where id = j.id;
  elsif p_action = 'archive' then
    update lb_journeys set status = 'archived', updated_at = now() where id = j.id;
    update lb_journey_enrollments set status = 'stopped', status_reason = 'journey archived', updated_at = now() where journey_id = j.id and status in ('active','paused');
  else raise exception 'Unknown action'; end if;
  perform lb_audit(me.company_id, 'journey.' || p_action, 'journey', j.id::text, '{}');
end $$;

create or replace function lb_set_automation_pause(p_paused boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('automation.control');
begin
  if p_paused and coalesce(trim(p_reason),'') = '' then raise exception 'Give a reason for pausing all automation'; end if;
  update lb_companies set automation_paused = p_paused, automation_paused_reason = case when p_paused then p_reason end where id = me.company_id;
  perform lb_audit(me.company_id, case when p_paused then 'automation.pause_all' else 'automation.resume_all' end, 'company', me.company_id::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function lb_set_customer_pause(p_customer uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('nurture.view');
begin
  if not lb_can_see_customer(p_customer) then raise exception 'Not permitted' using errcode='42501'; end if;
  update lb_customers set automation_paused_until = p_until where id = p_customer;
  perform lb_audit(me.company_id, case when p_until is null then 'automation.customer_resume' else 'automation.customer_pause' end, 'customer', p_customer::text, jsonb_build_object('until', p_until));
end $$;

create or replace function lb_set_my_availability(p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me();
begin
  if p_status not in ('available','away','offline') then raise exception 'Invalid availability'; end if;
  update lb_profiles set availability = p_status, updated_at = now() where id = me.id;
end $$;

-- ================================================================ durable jobs (AI) with bounded retries
create or replace function lb_claim_jobs(p_limit integer default 5) returns setof lb_jobs
language plpgsql security definer set search_path = public as $$
begin
  update lb_jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - interval '10 minutes';
  return query
  update lb_jobs j set status = 'running', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  where j.id in (select id from lb_jobs where status = 'queued' and next_run_at <= now() order by next_run_at limit p_limit for update skip locked)
  returning j.*;
end $$;

create or replace function lb_finish_job(p_id uuid, p_ok boolean, p_result jsonb, p_error text, p_retryable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare k lb_jobs;
begin
  select * into k from lb_jobs where id = p_id for update;
  if p_ok then
    update lb_jobs set status = 'done', result = p_result, last_error = null, locked_at = null, updated_at = now() where id = p_id;
  elsif p_retryable and k.attempts < k.max_attempts then
    update lb_jobs set status = 'queued', last_error = left(p_error, 500), locked_at = null, next_run_at = now() + make_interval(mins => power(2, k.attempts)::int), updated_at = now() where id = p_id;
  else
    update lb_jobs set status = 'failed', last_error = left(p_error, 500), locked_at = null, updated_at = now() where id = p_id;
  end if;
end $$;

create or replace function lb_failed_job_action(p_kind text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me();
begin
  if not (lb_can('journeys.manage') or lb_can('automation.control')) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_kind = 'enrollment' then
    if p_action = 'retry' then
      update lb_journey_enrollments set status = 'active', attempts = 0, last_error = null, status_reason = null, next_run_at = now(), locked_at = null, updated_at = now()
      where id = p_id and company_id = me.company_id and status = 'failed';
    else
      update lb_journey_enrollments set status = 'stopped', status_reason = 'dismissed by ' || me.full_name, updated_at = now()
      where id = p_id and company_id = me.company_id and status = 'failed';
    end if;
    if not found then raise exception 'Failed enrolment not found'; end if;
    perform lb__journey_event(p_id, null, case p_action when 'retry' then 'retried' else 'dismissed' end, 'by ' || me.full_name);
  elsif p_kind = 'job' then
    update lb_jobs set status = case p_action when 'retry' then 'queued' else 'dismissed' end, attempts = case p_action when 'retry' then 0 else attempts end,
      next_run_at = now(), updated_at = now()
    where id = p_id and company_id = me.company_id and status = 'failed';
    if not found then raise exception 'Failed job not found'; end if;
  else raise exception 'Unknown kind'; end if;
  perform lb_audit(me.company_id, 'failed_job.' || p_action, p_kind, p_id::text, '{}');
end $$;

-- ================================================================ knowledge & AI outputs
create or replace function lb_save_knowledge(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('knowledge.manage'); v_id uuid := nullif(p->>'id','')::uuid;
begin
  if coalesce(trim(p->>'title'),'') = '' or coalesce(trim(p->>'content'),'') = '' then raise exception 'Title and content are required'; end if;
  if v_id is null then
    insert into lb_knowledge (company_id, title, content, created_by) values (me.company_id, trim(p->>'title'), p->>'content', me.id) returning id into v_id;
  else
    -- Edits return the article to draft: it must be approved again before AI can use it.
    update lb_knowledge set title = trim(p->>'title'), content = p->>'content', status = 'draft', approved_by = null, approved_at = null, updated_at = now()
    where id = v_id and company_id = me.company_id;
  end if;
  perform lb_audit(me.company_id, 'knowledge.save', 'knowledge', v_id::text, jsonb_build_object('title', p->>'title'));
  return v_id;
end $$;

create or replace function lb_knowledge_action(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('knowledge.manage');
begin
  update lb_knowledge set status = case p_action when 'approve' then 'approved' when 'archive' then 'archived' else 'draft' end,
    approved_by = case when p_action = 'approve' then me.id end, approved_at = case when p_action = 'approve' then now() end, updated_at = now()
  where id = p_id and company_id = me.company_id;
  if not found then raise exception 'Article not found'; end if;
  perform lb_audit(me.company_id, 'knowledge.' || p_action, 'knowledge', p_id::text, '{}');
end $$;

create or replace function lb_record_ai_output(p_conv uuid, p_kind text, p_content text, p_model text, p_knowledge uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('ai.use'); v lb_conversations; v_id uuid;
begin
  select * into v from lb_conversations where id = p_conv;
  if v.id is null or not lb_can_see_conversation(v.company_id, v.team_id, v.assignee_id, v.number_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  insert into lb_ai_outputs (company_id, conversation_id, lead_id, kind, content, model, knowledge_ids, created_by)
  values (v.company_id, v.id, v.lead_id, p_kind, p_content, p_model, coalesce(p_knowledge, '{}'), me.id) returning id into v_id;
  return v_id;
end $$;

-- ================================================================ queues
create or replace function lb_nurture_queue(p_queue text, p_limit integer default 50, p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path = public as $$
  with lq as (
    select l.id, l.lead_no, l.priority, l.status_category, l.owner_id, l.last_activity_at, l.next_followup_at, l.expected_value,
           l.payment_status, l.payment_due_amount, l.payment_due_at, l.created_at, c.id customer_id, c.name customer_name, c.phone_e164,
           s.name status_name, o.full_name owner_name
    from lb_leads l join lb_customers c on c.id = l.customer_id join lb_lead_statuses s on s.id = l.status_id
    left join lb_profiles o on o.id = l.owner_id
    where not lb__closed(l.status_category)
  ),
  rows as (
    select jsonb_build_object('kind','lead') || to_jsonb(lq) r, lq.created_at sort_at from lq where p_queue = 'unassigned' and owner_id is null
    union all select jsonb_build_object('kind','lead') || to_jsonb(lq), lq.next_followup_at from lq
      where p_queue = 'overdue' and exists (select 1 from lb_followups f where f.lead_id = lq.id and f.status = 'pending'
        and f.due_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
    union all select jsonb_build_object('kind','lead') || to_jsonb(lq), lq.last_activity_at from lq
      where p_queue = 'no_next_action' and not exists (select 1 from lb_followups f where f.lead_id = lq.id and f.status = 'pending')
    union all select jsonb_build_object('kind','lead') || to_jsonb(lq), lq.last_activity_at from lq
      where p_queue = 'hot' and (priority in ('urgent','high') or status_category in ('interested','scheduled')
        or exists (select 1 from lb_signals sg where sg.customer_id = lq.customer_id and sg.created_at > now() - interval '48 hours'))
        and last_activity_at > now() - interval '7 days'
    union all select jsonb_build_object('kind','lead') || to_jsonb(lq), coalesce(lq.payment_due_at, lq.last_activity_at) from lq
      where p_queue = 'payments' and payment_status in ('pending','partial')
    union all select jsonb_build_object('kind','lead') || to_jsonb(lq), lq.last_activity_at from lq
      where p_queue = 'recovery' and last_activity_at < now() - interval '14 days'
    union all select jsonb_build_object('kind','chat', 'id', v.id, 'customer_id', v.customer_id, 'customer_name', coalesce(c.name, c.wa_profile_name), 'phone_e164', c.phone_e164,
        'awaiting_reply_since', v.awaiting_reply_since, 'owner_name', a.full_name, 'preview', v.last_message_preview,
        'sla_breached', v.awaiting_reply_since < now() - make_interval(mins => co.sla_first_response_minutes),
        'escalated', v.awaiting_reply_since < now() - make_interval(mins => co.sla_escalation_minutes)), v.awaiting_reply_since
      from lb_conversations v join lb_customers c on c.id = v.customer_id join lb_companies co on co.id = v.company_id
      left join lb_profiles a on a.id = v.assignee_id
      where p_queue = 'unanswered' and v.awaiting_reply_since is not null and v.status <> 'resolved'
    union all select jsonb_build_object('kind','message', 'id', m.id, 'conversation_id', m.conversation_id, 'customer_name', coalesce(c.name, c.wa_profile_name),
        'phone_e164', c.phone_e164, 'error', m.error_message, 'error_code', m.error_code, 'template_name', m.template_name, 'automated', m.automated,
        'failed_at', m.failed_at), m.failed_at
      from lb_messages m join lb_conversations v on v.id = m.conversation_id join lb_customers c on c.id = v.customer_id
      where p_queue = 'failed' and m.direction = 'out' and m.status = 'failed' and m.failed_at > now() - interval '14 days'
    union all select jsonb_build_object('kind','enrollment', 'id', e.id, 'lead_id', e.lead_id, 'journey', j.name, 'status', e.status, 'reason', e.status_reason,
        'customer_name', coalesce(c.name, c.wa_profile_name), 'phone_e164', c.phone_e164, 'updated_at', e.updated_at), e.updated_at
      from lb_journey_enrollments e join lb_journeys j on j.id = e.journey_id join lb_customers c on c.id = e.customer_id
      where p_queue = 'journeys' and e.status = 'paused'
    union all select jsonb_build_object('kind','failed_enrollment', 'id', e.id, 'lead_id', e.lead_id, 'journey', j.name, 'error', e.last_error, 'attempts', e.attempts,
        'customer_name', coalesce(c.name, c.wa_profile_name), 'phone_e164', c.phone_e164, 'updated_at', e.updated_at), e.updated_at
      from lb_journey_enrollments e join lb_journeys j on j.id = e.journey_id join lb_customers c on c.id = e.customer_id
      where p_queue = 'failed_jobs' and e.status = 'failed'
    union all select jsonb_build_object('kind','failed_job', 'id', k.id, 'job', k.kind, 'error', k.last_error, 'attempts', k.attempts, 'updated_at', k.updated_at), k.updated_at
      from lb_jobs k where p_queue = 'failed_jobs' and k.status = 'failed'
    union all select jsonb_build_object('kind','complaint', 'id', k.id, 'conversation_id', k.conversation_id, 'customer_id', k.customer_id,
        'customer_name', coalesce(c.name, c.wa_profile_name), 'phone_e164', c.phone_e164, 'source', k.source, 'matched', k.matched, 'note', k.note, 'created_at', k.created_at), k.created_at
      from lb_complaints k join lb_customers c on c.id = k.customer_id where p_queue = 'complaints' and k.status = 'open'
    union all select jsonb_build_object('kind','signal', 'id', s.id, 'conversation_id', s.conversation_id, 'lead_id', s.lead_id,
        'customer_name', coalesce(c.name, c.wa_profile_name), 'phone_e164', c.phone_e164, 'matched', s.matched, 'created_at', s.created_at), s.created_at
      from lb_signals s join lb_customers c on c.id = s.customer_id where p_queue = 'signals' and s.created_at > now() - interval '48 hours'
  )
  select jsonb_build_object('total', (select count(*) from rows),
    'rows', coalesce((select jsonb_agg(r) from (select r from rows order by sort_at asc nulls last limit least(p_limit, 200) offset p_offset) x), '[]'))
$$;

create or replace function lb_nurture_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_object_agg(q, (lb_nurture_queue(q, 1, 0)->>'total')::int)
  from unnest(array['unassigned','unanswered','overdue','no_next_action','hot','payments','failed','recovery','journeys','failed_jobs','complaints','signals']) q
$$;

-- ================================================================ grants
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('lb__agent_available','lb__open_load','lb__auto_allocate','lb__send_check','lb__queue_automated',
      'lb__end_enrollments','lb__enroll','lb__fire_trigger','lb_run_journeys','lb__raise_complaint','lb_complaint_action','lb__on_lead_event','lb__on_message',
      'lb_set_payment','lb_run_sla','lb_run_scheduled_triggers','lb_run_digests','lb_nurture_tick','lb_save_journey','lb_journey_preview','lb_publish_journey',
      'lb_journey_action','lb_set_automation_pause','lb_set_customer_pause','lb_set_my_availability','lb_claim_jobs','lb_finish_job','lb_failed_job_action',
      'lb_save_knowledge','lb_knowledge_action','lb_record_ai_output','lb_nurture_queue','lb_nurture_counts')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname not like 'lb\_\_%' and f.proname not in ('lb_run_journeys','lb_run_sla','lb_run_scheduled_triggers','lb_run_digests','lb_nurture_tick','lb_claim_jobs','lb_finish_job') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Used inside RLS-scoped (invoker) queries by signed-in users.
grant execute on function lb__agent_available(uuid) to authenticated;

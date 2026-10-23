-- Customer Nurturing & Lead Recovery: engine, hooks and RPCs.

-- ================================================================ helpers
-- When quiet hours are in force for a company, the next allowed send time (else null).
create or replace function lb__quiet_until(p_company uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare c lb_companies; t time := (now() at time zone 'Asia/Kolkata')::time; d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into c from lb_companies where id = p_company;
  if c.quiet_hours_start = c.quiet_hours_end then return null; end if;
  if c.quiet_hours_start > c.quiet_hours_end then           -- overnight window, e.g. 21:00–09:00
    if t >= c.quiet_hours_start then return ((d + 1) + c.quiet_hours_end) at time zone 'Asia/Kolkata'; end if;
    if t < c.quiet_hours_end then return (d + c.quiet_hours_end) at time zone 'Asia/Kolkata'; end if;
  elsif t >= c.quiet_hours_start and t < c.quiet_hours_end then
    return (d + c.quiet_hours_end) at time zone 'Asia/Kolkata';
  end if;
  return null;
end $$;

-- Full eligibility check for one automated (journey/campaign) send, run right before queueing.
-- Returns {ok, reason, hard, defer_until}. hard=true means stop trying for this customer.
create or replace function lb__send_check(p_company uuid, p_customer uuid, p_number uuid, p_template text, p_lang text, p_offer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c lb_customers; n lb_wa_numbers; t lb_wa_templates; o lb_offers; co lb_companies; v_sent int; v_oldest timestamptz; v_quiet timestamptz;
begin
  select * into c from lb_customers where id = p_customer and company_id = p_company;
  select * into n from lb_wa_numbers where id = p_number and company_id = p_company;
  select * into co from lb_companies where id = p_company;
  if c.id is null then return '{"ok":false,"reason":"customer_missing","hard":true}'; end if;
  if c.wa_opted_out_at is not null then return '{"ok":false,"reason":"opted_out","hard":true}'; end if;
  if exists (select 1 from lb_suppressions s where s.company_id = p_company and s.phone_e164 = c.phone_e164) then
    return '{"ok":false,"reason":"suppressed","hard":true}'; end if;
  if c.wa_opt_in_at is null then return '{"ok":false,"reason":"no_consent","hard":true}'; end if;
  if n.id is null or not n.is_active then return '{"ok":false,"reason":"number_unavailable","hard":false}'; end if;
  select * into t from lb_wa_templates where company_id = p_company and waba_id = n.waba_id and name = p_template and language = p_lang;
  if t.id is null or upper(t.status) <> 'APPROVED' then return '{"ok":false,"reason":"template_not_approved","hard":false}'; end if;
  if p_offer is not null then
    select * into o from lb_offers where id = p_offer and company_id = p_company;
    if o.id is null or o.status <> 'approved' then return '{"ok":false,"reason":"offer_not_approved","hard":false}'; end if;
    if now() < o.valid_from then return jsonb_build_object('ok', false, 'reason', 'offer_not_started', 'hard', false, 'defer_until', o.valid_from); end if;
    if now() >= o.valid_to then return '{"ok":false,"reason":"offer_expired","hard":true}'; end if;
  end if;
  select count(*), min(m.created_at) into v_sent, v_oldest from lb_messages m join lb_conversations v on v.id = m.conversation_id
  where v.customer_id = p_customer and m.automated and m.direction = 'out' and m.status <> 'failed' and m.created_at > now() - interval '7 days';
  if v_sent >= co.marketing_cap_per_week then
    return jsonb_build_object('ok', false, 'reason', 'frequency_cap', 'hard', false, 'defer_until', v_oldest + interval '7 days' + interval '1 minute');
  end if;
  v_quiet := lb__quiet_until(p_company);
  if v_quiet is not null then return jsonb_build_object('ok', false, 'reason', 'quiet_hours', 'hard', false, 'defer_until', v_quiet); end if;
  return jsonb_build_object('ok', true, 'category', t.category);
end $$;

-- Render {{name}}, {{first_name}}, {{offer_name}}, {{offer_code}}, {{offer_valid_to}} in template params.
create or replace function lb__render_params(p_params jsonb, p_customer uuid, p_offer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    replace(replace(replace(replace(replace(x,
      '{{name}}', coalesce(c.name, c.wa_profile_name, 'there')),
      '{{first_name}}', split_part(coalesce(c.name, c.wa_profile_name, 'there'), ' ', 1)),
      '{{offer_name}}', coalesce(o.name, '')),
      '{{offer_code}}', coalesce(o.code, '')),
      '{{offer_valid_to}}', coalesce(to_char(o.valid_to at time zone 'Asia/Kolkata', 'DD Mon YYYY'), ''))
    order by ord), '[]'::jsonb)
  from jsonb_array_elements_text(coalesce(p_params, '[]')) with ordinality as e(x, ord)
  cross join lb_customers c left join lb_offers o on o.id = p_offer
  where c.id = p_customer
$$;

-- Queue one automated template message. client_id is deterministic, so a retry
-- of the same step/recipient can never create a second message.
create or replace function lb__queue_automated(p_company uuid, p_customer uuid, p_lead uuid, p_number uuid, p_template text, p_lang text,
  p_params jsonb, p_client uuid, p_journey uuid, p_enrollment uuid, p_campaign uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_msg uuid; l lb_leads;
begin
  select * into l from lb_leads where id = p_lead;
  insert into lb_conversations (company_id, number_id, customer_id, lead_id, team_id, assignee_id)
  values (p_company, p_number, p_customer, p_lead, l.team_id, l.owner_id)
  on conflict (number_id, customer_id) do update set lead_id = coalesce(lb_conversations.lead_id, excluded.lead_id)
  returning id into v_conv;
  insert into lb_messages (company_id, conversation_id, direction, type, template_name, template_language, template_params, client_id,
    status, next_attempt_at, automated, journey_id, enrollment_id, campaign_id)
  values (p_company, v_conv, 'out', 'template', p_template, p_lang, p_params, p_client, 'queued', now(), true, p_journey, p_enrollment, p_campaign)
  on conflict (client_id) do nothing
  returning id into v_msg;
  if v_msg is null then select id into v_msg from lb_messages where client_id = p_client; return v_msg; end if;
  update lb_conversations set last_message_at = now(), last_message_preview = left('Template: ' || p_template, 140), updated_at = now() where id = v_conv;
  return v_msg;
end $$;

create or replace function lb__journey_event(p_enr uuid, p_step int, p_event text, p_detail text, p_msg uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into lb_journey_events (company_id, enrollment_id, journey_id, step_no, event, detail, message_id)
  select company_id, id, journey_id, p_step, p_event, p_detail, p_msg from lb_journey_enrollments where id = p_enr
$$;

create or replace function lb__end_enrollments(p_where_lead uuid, p_where_customer uuid, p_flag text, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select en.id, en.current_step from lb_journey_enrollments en join lb_journeys j on j.id = en.journey_id
    where en.status in ('active','paused') and (p_status <> 'paused' or en.status = 'active')
      and (p_where_lead is null or en.lead_id = p_where_lead) and (p_where_customer is null or en.customer_id = p_where_customer)
      and (p_flag is null
           or (p_flag = 'purchase' and j.stop_on_purchase) or (p_flag = 'lost' and j.stop_on_lost)
           or (p_flag = 'takeover' and j.stop_on_manual_takeover) or (p_flag = 'reply' and j.pause_on_reply))
    for update of en
  loop
    update lb_journey_enrollments set status = p_status, status_reason = p_reason, updated_at = now(), locked_at = null where id = e.id;
    perform lb__journey_event(e.id, e.current_step, case p_status when 'paused' then 'paused' else 'stopped' end, p_reason);
  end loop;
end $$;

-- Enrol a lead, resolving conflicts by journey priority (lower number wins).
create or replace function lb__enroll(p_journey uuid, p_lead uuid, p_actor uuid, p_force boolean) returns text
language plpgsql security definer set search_path = public as $$
declare j lb_journeys; l lb_leads; cur record; v_id uuid;
begin
  select * into j from lb_journeys where id = p_journey;
  select * into l from lb_leads where id = p_lead for update;
  if j.id is null or l.id is null or j.company_id <> l.company_id then return 'invalid'; end if;
  if j.status <> 'active' then return 'journey_not_active'; end if;
  if lb__closed(l.status_category) then return 'lead_closed'; end if;
  if not p_force and exists (select 1 from lb_journey_enrollments where journey_id = p_journey and lead_id = p_lead) then return 'already_enrolled_before'; end if;
  select en.id, en.journey_id, jj.priority into cur from lb_journey_enrollments en join lb_journeys jj on jj.id = en.journey_id
    where en.lead_id = p_lead and en.status in ('active','paused');
  if cur.id is not null then
    if cur.journey_id = p_journey then return 'already_running'; end if;
    if cur.priority <= j.priority and not p_force then return 'conflict_higher_priority'; end if;
    update lb_journey_enrollments set status = 'stopped', status_reason = 'superseded by ' || j.name, updated_at = now() where id = cur.id;
    perform lb__journey_event(cur.id, null, 'stopped', 'superseded by ' || j.name);
  end if;
  insert into lb_journey_enrollments (company_id, journey_id, lead_id, customer_id, enrolled_by)
  values (l.company_id, p_journey, p_lead, l.customer_id, p_actor) returning id into v_id;
  perform lb__journey_event(v_id, 1, 'enrolled', case when p_actor is null then 'automatic' else 'manual' end);
  return 'enrolled';
end $$;

-- ================================================================ runners
create or replace function lb_run_journeys(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e record; j lb_journeys; s lb_journey_steps; l lb_leads; chk jsonb; v_num uuid; v_msg uuid; v_next int; v_ok boolean;
  v_guard int; n int := 0; c jsonb;
begin
  -- Segment-triggered journeys: enrol newly matching leads (bounded per run).
  for j in select * from lb_journeys where status = 'active' and trigger_type = 'segment' and trigger_config ? 'segment_id' loop
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
    v_guard := 0;
    <<steps>>
    loop
      v_guard := v_guard + 1;
      exit steps when v_guard > 25;
      select * into l from lb_leads where id = e.lead_id;
      if j.status <> 'active' then
        update lb_journey_enrollments set next_run_at = now() + interval '15 minutes', locked_at = null where id = e.id; exit steps;
      end if;
      if lb__closed(l.status_category) then
        update lb_journey_enrollments set status = 'stopped', status_reason = 'lead closed (' || l.status_category || ')', locked_at = null, updated_at = now() where id = e.id;
        perform lb__journey_event(e.id, e.current_step, 'stopped', 'lead closed'); exit steps;
      end if;
      select * into s from lb_journey_steps where journey_id = e.journey_id and step_no = e.current_step;
      if s.id is null or s.type = 'end' then
        update lb_journey_enrollments set status = 'completed', status_reason = null, locked_at = null, updated_at = now() where id = e.id;
        perform lb__journey_event(e.id, e.current_step, 'completed', null); exit steps;
      end if;
      c := s.config;
      v_next := coalesce(s.next_step, s.step_no + 1);

      if s.type = 'delay' then
        update lb_journey_enrollments set current_step = v_next, next_run_at = now() + make_interval(mins => greatest(1, coalesce((c->>'minutes')::int, 60))),
          locked_at = null, updated_at = now() where id = e.id;
        perform lb__journey_event(e.id, s.step_no, 'step_done', 'wait ' || coalesce(c->>'minutes','60') || ' min');
        exit steps;

      elsif s.type = 'task' then
        insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, action_type)
        values (l.company_id, l.id, l.owner_id, now() + make_interval(hours => coalesce((c->>'due_in_hours')::int, 4)),
                coalesce(c->>'title', 'Journey task: ' || j.name), coalesce(nullif(c->>'action_type',''), 'call'));
        insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
        values (l.company_id, l.id, l.owner_id, 'followup_created', jsonb_build_object('journey', j.name, 'note', c->>'title'));
        perform lb__refresh_next_followup(l.id);
        perform lb__notify(l.company_id, l.owner_id, 'task', 'New task from journey: ' || j.name, c->>'title', '/leads/' || l.id, 'jt:' || e.id || ':' || s.step_no || ':' || e.enrolled_at);
        perform lb__journey_event(e.id, s.step_no, 'task_created', c->>'title');
        update lb_journey_enrollments set current_step = v_next, updated_at = now() where id = e.id;
        e.current_step := v_next;

      elsif s.type = 'branch' then
        v_ok := case c->>'condition'
          when 'replied' then exists (select 1 from lb_messages m join lb_conversations v on v.id = m.conversation_id
                                      where v.customer_id = e.customer_id and m.direction = 'in' and m.created_at > e.enrolled_at)
          when 'status_in' then l.status_category = any(array(select jsonb_array_elements_text(coalesce(c->'values','[]'))))
          when 'purchased' then exists (select 1 from lb_leads x where x.customer_id = e.customer_id and x.status_category = 'won')
          when 'opted_in' then exists (select 1 from lb_customers x where x.id = e.customer_id and x.wa_opt_in_at is not null and x.wa_opted_out_at is null)
          when 'product' then l.product_id::text = c->>'value'
          when 'priority_high' then l.priority in ('high','urgent')
          else false end;
        v_next := case when v_ok then coalesce((c->>'then_step')::int, v_next) else coalesce((c->>'else_step')::int, v_next) end;
        perform lb__journey_event(e.id, s.step_no, 'branch', (c->>'condition') || ' = ' || v_ok || ' → step ' || v_next);
        update lb_journey_enrollments set current_step = v_next, updated_at = now() where id = e.id;
        e.current_step := v_next;

      elsif s.type = 'message' then
        v_num := coalesce(nullif(c->>'number_id','')::uuid, l.number_id, j.number_id,
                          (select id from lb_wa_numbers where company_id = l.company_id and is_active and status = 'connected' order by created_at limit 1));
        chk := lb__send_check(l.company_id, e.customer_id, v_num, c->>'template_name', c->>'template_language', nullif(c->>'offer_id','')::uuid);
        if (chk->>'ok')::boolean then
          v_msg := lb__queue_automated(l.company_id, e.customer_id, l.id, v_num, c->>'template_name', c->>'template_language',
            lb__render_params(c->'params', e.customer_id, nullif(c->>'offer_id','')::uuid),
            md5(e.id::text || ':' || s.step_no || ':' || coalesce(c->>'template_name',''))::uuid, j.id, e.id, null);
          perform lb__journey_event(e.id, s.step_no, 'message_queued', c->>'template_name', v_msg);
          update lb_journey_enrollments set current_step = v_next, last_message_at = now(), updated_at = now() where id = e.id;
          e.current_step := v_next;
        elsif chk ? 'defer_until' then
          update lb_journey_enrollments set next_run_at = (chk->>'defer_until')::timestamptz, locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, s.step_no, 'deferred', chk->>'reason'); exit steps;
        elsif (chk->>'hard')::boolean then
          update lb_journey_enrollments set status = 'stopped', status_reason = chk->>'reason', locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, s.step_no, 'stopped', chk->>'reason'); exit steps;
        else
          update lb_journey_enrollments set status = 'failed', status_reason = chk->>'reason', locked_at = null, updated_at = now() where id = e.id;
          perform lb__journey_event(e.id, s.step_no, 'failed', chk->>'reason'); exit steps;
        end if;
      end if;
    end loop steps;
    update lb_journey_enrollments set locked_at = null, next_run_at = case when next_run_at <= now() then now() else next_run_at end where id = e.id and locked_at is not null;
  end loop;
  return n;
end $$;

-- Customers/leads matching a segment's rules (latest lead per customer; open leads only unless include_closed).
create or replace function lb_segment_leads(p_segment uuid) returns table (lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  with sg as (select * from lb_segments where id = p_segment), r as (select rules from sg)
  select distinct on (l.customer_id) l.id, l.customer_id
  from lb_leads l join sg on sg.company_id = l.company_id join lb_customers c on c.id = l.customer_id, r
  where (coalesce((r.rules->>'include_closed')::boolean, false) or not lb__closed(l.status_category))
    and (jsonb_array_length(coalesce(r.rules->'categories','[]')) = 0 or l.status_category in (select jsonb_array_elements_text(r.rules->'categories')))
    and (jsonb_array_length(coalesce(r.rules->'product_ids','[]')) = 0 or l.product_id::text in (select jsonb_array_elements_text(r.rules->'product_ids')))
    and (jsonb_array_length(coalesce(r.rules->'source_ids','[]')) = 0 or l.source_id::text in (select jsonb_array_elements_text(r.rules->'source_ids')))
    and (jsonb_array_length(coalesce(r.rules->'tag_ids','[]')) = 0 or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id::text in (select jsonb_array_elements_text(r.rules->'tag_ids'))))
    and (nullif(r.rules->>'number_id','') is null or l.number_id::text = r.rules->>'number_id')
    and (nullif(r.rules->>'priority','') is null or l.priority = any(string_to_array(r.rules->>'priority', ',')))
    and (nullif(r.rules->>'inactive_days','') is null or l.last_activity_at < now() - make_interval(days => (r.rules->>'inactive_days')::int))
    and (nullif(r.rules->>'created_within_days','') is null or l.created_at > now() - make_interval(days => (r.rules->>'created_within_days')::int))
    and (coalesce(r.rules->>'purchased','any') = 'any'
         or (r.rules->>'purchased' = 'yes') = exists (select 1 from lb_leads w where w.customer_id = l.customer_id and w.status_category = 'won'))
    and (coalesce(r.rules->>'replied_days','') = '' or exists (select 1 from lb_messages m join lb_conversations v on v.id = m.conversation_id
         where v.customer_id = l.customer_id and m.direction = 'in' and m.created_at > now() - make_interval(days => (r.rules->>'replied_days')::int)))
  order by l.customer_id, l.created_at desc
$$;

create or replace function lb_run_campaigns(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = public as $$
declare cp lb_campaigns; r record; chk jsonb; v_msg uuid; n int := 0;
begin
  -- Start approved campaigns whose time has come: snapshot the audience once.
  for cp in select * from lb_campaigns where status = 'approved' and coalesce(scheduled_at, now()) <= now() for update skip locked loop
    insert into lb_campaign_recipients (company_id, campaign_id, customer_id, lead_id)
    select cp.company_id, cp.id, sl.customer_id, sl.lead_id from lb_segment_leads(cp.segment_id) sl
    on conflict (campaign_id, customer_id) do nothing;
    update lb_campaigns set status = 'running', launched_at = now() where id = cp.id;
  end loop;
  for r in
    select rc.*, c.number_id, c.template_name, c.template_language, c.template_params, c.offer_id, c.status cstatus
    from lb_campaign_recipients rc join lb_campaigns c on c.id = rc.campaign_id
    where rc.status = 'pending' and rc.next_try_at <= now() and c.status = 'running'
    order by rc.next_try_at limit p_limit for update of rc skip locked
  loop
    n := n + 1;
    chk := lb__send_check(r.company_id, r.customer_id, r.number_id, r.template_name, r.template_language, r.offer_id);
    if (chk->>'ok')::boolean then
      v_msg := lb__queue_automated(r.company_id, r.customer_id, r.lead_id, r.number_id, r.template_name, r.template_language,
        lb__render_params(r.template_params, r.customer_id, r.offer_id), md5('campaign:' || r.campaign_id || ':' || r.customer_id)::uuid, null, null, r.campaign_id);
      update lb_campaign_recipients set status = 'queued', message_id = v_msg, reason = null, updated_at = now() where id = r.id;
    elsif chk ? 'defer_until' then
      update lb_campaign_recipients set next_try_at = (chk->>'defer_until')::timestamptz, reason = chk->>'reason', updated_at = now() where id = r.id;
    else
      update lb_campaign_recipients set status = 'skipped', reason = chk->>'reason', updated_at = now() where id = r.id;
    end if;
  end loop;
  update lb_campaigns c set status = 'completed', completed_at = now()
  where c.status = 'running' and not exists (select 1 from lb_campaign_recipients r where r.campaign_id = c.id and r.status = 'pending');
  return n;
end $$;

-- SLA: alert the assignee (or leaders if unassigned) on breach; escalate to leaders/admins later.
create or replace function lb_run_sla() returns integer
language plpgsql security definer set search_path = public as $$
declare v record; u uuid; n int := 0; v_targets uuid[];
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
    if v.sla_alerted_at is null or v.sla_alerted_at < v.awaiting_reply_since then
      insert into lb_sla_events (company_id, conversation_id, level, awaiting_since, notified)
      values (v.company_id, v.id, 'breach', v.awaiting_reply_since, case when v.assignee_id is null then v_targets else array[v.assignee_id] end)
      on conflict do nothing;
      foreach u in array case when v.assignee_id is null then v_targets else array[v.assignee_id] end loop
        perform lb__notify(v.company_id, u, 'sla', 'Reply overdue: ' || coalesce(v.cname, v.phone_e164),
          'Waiting since ' || to_char(v.awaiting_reply_since at time zone 'Asia/Kolkata', 'HH24:MI'), '/inbox?c=' || v.id,
          'sla1:' || v.id || ':' || extract(epoch from v.awaiting_reply_since)::bigint || ':' || u);
      end loop;
      update lb_conversations set sla_alerted_at = now() where id = v.id; n := n + 1;
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

create or replace function lb_nurture_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('sla', lb_run_sla(), 'journeys', lb_run_journeys(), 'campaigns', lb_run_campaigns(), 'reminders', lb_run_reminders());
end $$;

-- ================================================================ hooks
-- Lead events: auto-enrol on creation/status entry; stop on purchase/lost; attribute conversions.
create or replace function lb__on_lead_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare j record; l lb_leads; src record;
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
    return new;
  end if;
  if new.type = 'status_change' and new.to_category in ('lost','invalid') then
    perform lb__end_enrollments(l.id, null, 'lost', 'stopped', 'lead ' || new.to_category);
    return new;
  end if;
  for j in select * from lb_journeys where company_id = l.company_id and status = 'active'
    and ((new.type in ('created','repeat_created') and trigger_type = 'lead_created')
      or (new.type = 'status_change' and trigger_type = 'status_entered' and trigger_config->>'category' = new.to_category))
    and (nullif(trigger_config->>'product_id','') is null or trigger_config->>'product_id' = l.product_id::text)
    and (nullif(trigger_config->>'source_id','') is null or trigger_config->>'source_id' = l.source_id::text)
    order by priority
  loop
    perform lb__enroll(j.id, l.id, null, false);
  end loop;
  return new;
end $$;
create trigger lb_lead_events_nurture after insert on lb_lead_events for each row execute function lb__on_lead_event();

-- Messages: reply tracking, pause on reply, reply attribution, manual takeover.
create or replace function lb__on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v lb_conversations; src record;
begin
  select * into v from lb_conversations where id = new.conversation_id;
  if new.direction = 'in' then
    update lb_conversations set awaiting_reply_since = coalesce(awaiting_reply_since, new.created_at) where id = v.id;
    perform lb__end_enrollments(null, v.customer_id, 'reply', 'paused', 'customer replied');
    select m.id, m.journey_id, m.campaign_id into src from lb_messages m join lb_conversations c on c.id = m.conversation_id
      where c.customer_id = v.customer_id and m.automated and m.direction = 'out' and m.created_at > now() - interval '7 days'
        and not exists (select 1 from lb_attributions a where a.source_message_id = m.id and a.event = 'reply')
      order by m.created_at desc limit 1;
    if src.id is not null then
      insert into lb_attributions (company_id, customer_id, lead_id, journey_id, campaign_id, source_message_id, event)
      values (v.company_id, v.customer_id, v.lead_id, src.journey_id, src.campaign_id, src.id, 'reply');
    end if;
  elsif not new.automated then
    update lb_conversations set last_outbound_at = new.created_at, awaiting_reply_since = null, sla_alerted_at = null, sla_escalated_at = null where id = v.id;
    perform lb__end_enrollments(null, v.customer_id, 'takeover', 'stopped', 'manual takeover');
  else
    update lb_conversations set last_outbound_at = new.created_at where id = v.id;
  end if;
  return new;
end $$;
create trigger lb_messages_nurture after insert on lb_messages for each row execute function lb__on_message();

-- Final failures of automated sends surface on the journey / campaign.
create or replace function lb__on_message_failed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and old.status <> 'failed' and new.automated then
    if new.enrollment_id is not null then perform lb__journey_event(new.enrollment_id, null, 'send_failed', new.error_message, new.id); end if;
    if new.campaign_id is not null then
      update lb_campaign_recipients set status = 'failed', reason = left(new.error_message, 200), updated_at = now() where message_id = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger lb_messages_failed after update of status on lb_messages for each row execute function lb__on_message_failed();

-- Consent changes are always recorded; opt-out stops every journey for the customer.
create or replace function lb__on_consent() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := coalesce(nullif(current_setting('lb.consent_source', true), ''), 'keyword');
        v_note text := nullif(current_setting('lb.consent_note', true), '');
begin
  if new.wa_opted_out_at is not null and old.wa_opted_out_at is null then
    insert into lb_consent_events (company_id, customer_id, status, source, note, actor_id) values (new.company_id, new.id, 'opt_out', v_src, v_note, auth.uid());
    perform lb__end_enrollments(null, new.id, null, 'stopped', 'opted out');
  elsif new.wa_opt_in_at is distinct from old.wa_opt_in_at and new.wa_opt_in_at is not null and new.wa_opted_out_at is null then
    insert into lb_consent_events (company_id, customer_id, status, source, note, actor_id) values (new.company_id, new.id, 'opt_in', v_src, v_note, auth.uid());
  end if;
  return new;
end $$;
create trigger lb_customers_consent after update of wa_opted_out_at, wa_opt_in_at on lb_customers for each row execute function lb__on_consent();

-- ================================================================ user RPCs
create or replace function lb__require(p_perm text) returns lb_profiles
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__me();
begin
  if not lb_can(p_perm) then raise exception 'You do not have permission for this action (%)', p_perm using errcode = '42501'; end if;
  return me;
end $$;

create or replace function lb_save_journey(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); v_id uuid := nullif(p->>'id','')::uuid; st jsonb; i int := 0; v_max int;
begin
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Journey name is required'; end if;
  if p->>'trigger_type' not in ('status_entered','lead_created','segment','manual') then raise exception 'Invalid trigger'; end if;
  if p->>'trigger_type' = 'status_entered' and coalesce(p->'trigger_config'->>'category','') = '' then raise exception 'Choose the status category that starts this journey'; end if;
  if p->>'trigger_type' = 'segment' and not exists (select 1 from lb_segments where id = nullif(p->'trigger_config'->>'segment_id','')::uuid and company_id = me.company_id) then
    raise exception 'Choose a segment for this journey'; end if;
  v_max := jsonb_array_length(coalesce(p->'steps','[]'));
  if v_max = 0 then raise exception 'Add at least one step'; end if;
  for st in select * from jsonb_array_elements(p->'steps') loop
    i := i + 1;
    if st->>'type' not in ('message','task','delay','branch','end') then raise exception 'Step %: invalid type', i; end if;
    if st->>'type' = 'message' and (coalesce(st->'config'->>'template_name','') = '' or coalesce(st->'config'->>'template_language','') = '') then
      raise exception 'Step %: choose an approved template (business-initiated WhatsApp messages must use templates)', i; end if;
    if st->>'type' = 'branch' and (coalesce((st->'config'->>'then_step')::int, 0) not between 1 and v_max + 1 or coalesce((st->'config'->>'else_step')::int, 0) not between 1 and v_max + 1) then
      raise exception 'Step %: branch targets must be existing step numbers (1–%)', i, v_max + 1; end if;
    if st->>'type' = 'message' and nullif(st->'config'->>'offer_id','') is not null
       and not exists (select 1 from lb_offers where id = (st->'config'->>'offer_id')::uuid and company_id = me.company_id) then
      raise exception 'Step %: invalid offer', i; end if;
  end loop;
  if v_id is null then
    insert into lb_journeys (company_id, name, description, trigger_type, trigger_config, priority, number_id, pause_on_reply, stop_on_purchase, stop_on_lost, stop_on_manual_takeover, created_by)
    values (me.company_id, trim(p->>'name'), p->>'description', p->>'trigger_type', coalesce(p->'trigger_config','{}'), coalesce((p->>'priority')::int, 100),
      nullif(p->>'number_id','')::uuid, coalesce((p->>'pause_on_reply')::boolean, true), coalesce((p->>'stop_on_purchase')::boolean, true),
      coalesce((p->>'stop_on_lost')::boolean, true), coalesce((p->>'stop_on_manual_takeover')::boolean, true), me.id)
    returning id into v_id;
  else
    update lb_journeys set name = trim(p->>'name'), description = p->>'description', trigger_type = p->>'trigger_type', trigger_config = coalesce(p->'trigger_config','{}'),
      priority = coalesce((p->>'priority')::int, 100), number_id = nullif(p->>'number_id','')::uuid,
      pause_on_reply = coalesce((p->>'pause_on_reply')::boolean, true), stop_on_purchase = coalesce((p->>'stop_on_purchase')::boolean, true),
      stop_on_lost = coalesce((p->>'stop_on_lost')::boolean, true), stop_on_manual_takeover = coalesce((p->>'stop_on_manual_takeover')::boolean, true), updated_at = now()
    where id = v_id and company_id = me.company_id;
    if not found then raise exception 'Journey not found'; end if;
    delete from lb_journey_steps where journey_id = v_id;
  end if;
  insert into lb_journey_steps (journey_id, step_no, type, config, next_step)
  select v_id, ord, x->>'type', coalesce(x->'config','{}'), nullif(x->>'next_step','')::int
  from jsonb_array_elements(p->'steps') with ordinality as t(x, ord);
  perform lb_audit(me.company_id, 'journey.save', 'journey', v_id::text, jsonb_build_object('name', p->>'name', 'steps', v_max));
  return v_id;
end $$;

create or replace function lb_journey_action(p_journey uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('journeys.manage'); j lb_journeys;
begin
  select * into j from lb_journeys where id = p_journey and company_id = me.company_id for update;
  if j.id is null then raise exception 'Journey not found'; end if;
  if p_action = 'activate' then
    if not exists (select 1 from lb_journey_steps where journey_id = j.id) then raise exception 'Add steps before activating'; end if;
    update lb_journeys set status = 'active', updated_at = now() where id = j.id;
  elsif p_action = 'pause' then update lb_journeys set status = 'paused', updated_at = now() where id = j.id;
  elsif p_action = 'archive' then
    update lb_journeys set status = 'archived', updated_at = now() where id = j.id;
    update lb_journey_enrollments set status = 'stopped', status_reason = 'journey archived', updated_at = now() where journey_id = j.id and status in ('active','paused');
  else raise exception 'Unknown action'; end if;
  perform lb_audit(me.company_id, 'journey.' || p_action, 'journey', j.id::text, '{}');
end $$;

create or replace function lb_enroll_lead(p_journey uuid, p_lead uuid, p_force boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('nurture.view'); r text;
begin
  if not lb_can_see_lead_id(p_lead) then raise exception 'Not permitted' using errcode='42501'; end if;
  if not exists (select 1 from lb_journeys where id = p_journey and company_id = me.company_id) then raise exception 'Journey not found'; end if;
  if p_force and not lb_can('journeys.manage') then raise exception 'Only journey managers can override a running journey' using errcode='42501'; end if;
  r := lb__enroll(p_journey, p_lead, me.id, p_force);
  if r <> 'enrolled' then
    raise exception '%', case r when 'journey_not_active' then 'Journey is not active'
      when 'lead_closed' then 'Lead is closed' when 'already_running' then 'Lead is already in this journey'
      when 'already_enrolled_before' then 'Lead already went through this journey (use override to restart)'
      when 'conflict_higher_priority' then 'Lead is in another journey with equal or higher priority (override to replace it)'
      else r end;
  end if;
  return r;
end $$;

create or replace function lb_enrollment_action(p_enrollment uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('nurture.view'); e lb_journey_enrollments;
begin
  select * into e from lb_journey_enrollments where id = p_enrollment for update;
  if e.id is null or not lb_can_see_lead_id(e.lead_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_action = 'pause' and e.status = 'active' then
    update lb_journey_enrollments set status = 'paused', status_reason = 'paused by ' || me.full_name, updated_at = now() where id = e.id;
  elsif p_action = 'resume' and e.status in ('paused','failed') then
    update lb_journey_enrollments set status = 'active', status_reason = null, next_run_at = now(), locked_at = null, updated_at = now() where id = e.id;
  elsif p_action = 'stop' and e.status in ('active','paused','failed') then
    update lb_journey_enrollments set status = 'stopped', status_reason = 'stopped by ' || me.full_name, updated_at = now() where id = e.id;
  else raise exception 'This action is not available for a % enrollment', e.status; end if;
  perform lb__journey_event(e.id, e.current_step, case p_action when 'resume' then 'resumed' when 'pause' then 'paused' else 'stopped' end, 'by ' || me.full_name);
end $$;

create or replace function lb_save_segment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); v_id uuid := nullif(p->>'id','')::uuid;
begin
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Segment name is required'; end if;
  if v_id is null then
    insert into lb_segments (company_id, name, rules, created_by) values (me.company_id, trim(p->>'name'), coalesce(p->'rules','{}'), me.id) returning id into v_id;
  else
    update lb_segments set name = trim(p->>'name'), rules = coalesce(p->'rules','{}'), updated_at = now() where id = v_id and company_id = me.company_id;
  end if;
  perform lb_audit(me.company_id, 'segment.save', 'segment', v_id::text, p->'rules');
  return v_id;
end $$;

-- Audience preview: who is in, and why others would be excluded at send time.
create or replace function lb_segment_preview(p_segment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage');
begin
  if not exists (select 1 from lb_segments where id = p_segment and company_id = me.company_id) then raise exception 'Segment not found'; end if;
  return (
    with s as (select sl.*, c.name, c.phone_e164, c.wa_opt_in_at, c.wa_opted_out_at,
                 exists (select 1 from lb_suppressions x where x.company_id = me.company_id and x.phone_e164 = c.phone_e164) suppressed
               from lb_segment_leads(p_segment) sl join lb_customers c on c.id = sl.customer_id)
    select jsonb_build_object(
      'total', (select count(*) from s),
      'eligible', (select count(*) from s where wa_opted_out_at is null and wa_opt_in_at is not null and not suppressed),
      'opted_out', (select count(*) from s where wa_opted_out_at is not null),
      'no_consent', (select count(*) from s where wa_opted_out_at is null and wa_opt_in_at is null),
      'suppressed', (select count(*) from s where suppressed),
      'sample', coalesce((select jsonb_agg(row_to_json(x)) from (select name, phone_e164 from s
                   where wa_opted_out_at is null and wa_opt_in_at is not null and not suppressed limit 5) x), '[]')));
end $$;

create or replace function lb_save_offer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); v_id uuid := nullif(p->>'id','')::uuid;
begin
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Offer name is required'; end if;
  if (p->>'valid_to')::timestamptz <= (p->>'valid_from')::timestamptz then raise exception 'Offer must end after it starts'; end if;
  if v_id is null then
    insert into lb_offers (company_id, name, description, code, valid_from, valid_to, requested_by)
    values (me.company_id, trim(p->>'name'), p->>'description', nullif(p->>'code',''), (p->>'valid_from')::timestamptz, (p->>'valid_to')::timestamptz, me.id)
    returning id into v_id;
  else
    -- Any edit sends the offer back to draft: it must be approved again.
    update lb_offers set name = trim(p->>'name'), description = p->>'description', code = nullif(p->>'code',''),
      valid_from = (p->>'valid_from')::timestamptz, valid_to = (p->>'valid_to')::timestamptz, status = 'draft', approved_by = null, approved_at = null
    where id = v_id and company_id = me.company_id;
  end if;
  perform lb_audit(me.company_id, 'offer.save', 'offer', v_id::text, p);
  return v_id;
end $$;

create or replace function lb_offer_action(p_offer uuid, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); o lb_offers;
begin
  select * into o from lb_offers where id = p_offer and company_id = me.company_id for update;
  if o.id is null then raise exception 'Offer not found'; end if;
  if p_action = 'submit' then
    perform lb__require('campaigns.manage');
    if o.status not in ('draft','rejected') then raise exception 'Only draft offers can be submitted'; end if;
    update lb_offers set status = 'pending_approval', requested_by = me.id where id = o.id;
  elsif p_action in ('approve','reject') then
    perform lb__require('campaigns.approve');
    if o.status <> 'pending_approval' then raise exception 'Offer is not awaiting approval'; end if;
    if p_action = 'reject' and coalesce(trim(p_reason),'') = '' then raise exception 'Give a reason for rejecting'; end if;
    update lb_offers set status = case p_action when 'approve' then 'approved' else 'rejected' end,
      approved_by = case p_action when 'approve' then me.id end, approved_at = case p_action when 'approve' then now() end,
      rejection_reason = case p_action when 'reject' then p_reason end where id = o.id;
  else raise exception 'Unknown action'; end if;
  perform lb_audit(me.company_id, 'offer.' || p_action, 'offer', o.id::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function lb_save_campaign(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); v_id uuid := nullif(p->>'id','')::uuid; n lb_wa_numbers; t lb_wa_templates;
begin
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Campaign name is required'; end if;
  select * into n from lb_wa_numbers where id = nullif(p->>'number_id','')::uuid and company_id = me.company_id;
  if n.id is null then raise exception 'Choose a WhatsApp number'; end if;
  select * into t from lb_wa_templates where company_id = me.company_id and waba_id = n.waba_id and name = p->>'template_name' and language = p->>'template_language';
  if t.id is null or upper(t.status) <> 'APPROVED' then raise exception 'Choose an approved template for this number'; end if;
  if not exists (select 1 from lb_segments where id = nullif(p->>'segment_id','')::uuid and company_id = me.company_id) then raise exception 'Choose a segment'; end if;
  if nullif(p->>'offer_id','') is not null and not exists (select 1 from lb_offers where id = (p->>'offer_id')::uuid and company_id = me.company_id) then raise exception 'Invalid offer'; end if;
  if v_id is null then
    insert into lb_campaigns (company_id, name, segment_id, number_id, template_name, template_language, template_params, offer_id, scheduled_at, created_by)
    values (me.company_id, trim(p->>'name'), (p->>'segment_id')::uuid, n.id, t.name, t.language, coalesce(p->'template_params','[]'),
      nullif(p->>'offer_id','')::uuid, nullif(p->>'scheduled_at','')::timestamptz, me.id) returning id into v_id;
  else
    update lb_campaigns set name = trim(p->>'name'), segment_id = (p->>'segment_id')::uuid, number_id = n.id, template_name = t.name,
      template_language = t.language, template_params = coalesce(p->'template_params','[]'), offer_id = nullif(p->>'offer_id','')::uuid,
      scheduled_at = nullif(p->>'scheduled_at','')::timestamptz, status = 'draft', approved_by = null, approved_at = null
    where id = v_id and company_id = me.company_id and status in ('draft','pending_approval');
    if not found then raise exception 'Only draft campaigns can be edited'; end if;
  end if;
  perform lb_audit(me.company_id, 'campaign.save', 'campaign', v_id::text, p);
  return v_id;
end $$;

create or replace function lb_campaign_action(p_campaign uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_campaigns; o lb_offers;
begin
  select * into c from lb_campaigns where id = p_campaign and company_id = me.company_id for update;
  if c.id is null then raise exception 'Campaign not found'; end if;
  if p_action = 'submit' then
    perform lb__require('campaigns.manage');
    if c.status <> 'draft' then raise exception 'Only draft campaigns can be submitted'; end if;
    update lb_campaigns set status = 'pending_approval' where id = c.id;
  elsif p_action = 'approve' then
    perform lb__require('campaigns.approve');
    if c.status <> 'pending_approval' then raise exception 'Campaign is not awaiting approval'; end if;
    if c.offer_id is not null then
      select * into o from lb_offers where id = c.offer_id;
      if o.status <> 'approved' then raise exception 'Approve the offer first'; end if;
      if o.valid_to <= now() then raise exception 'The offer has expired'; end if;
    end if;
    update lb_campaigns set status = 'approved', approved_by = me.id, approved_at = now() where id = c.id;
  elsif p_action = 'reject' then
    perform lb__require('campaigns.approve');
    update lb_campaigns set status = 'draft' where id = c.id and status = 'pending_approval';
  elsif p_action = 'cancel' then
    perform lb__require('campaigns.manage');
    if c.status in ('completed','cancelled') then raise exception 'Campaign already finished'; end if;
    update lb_campaigns set status = 'cancelled', completed_at = now() where id = c.id;
    update lb_campaign_recipients set status = 'skipped', reason = 'campaign cancelled', updated_at = now() where campaign_id = c.id and status = 'pending';
  else raise exception 'Unknown action'; end if;
  perform lb_audit(me.company_id, 'campaign.' || p_action, 'campaign', c.id::text, '{}');
end $$;

create or replace function lb_set_consent(p_customer uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('consent.manage');
begin
  if not lb_can_see_customer(p_customer) then raise exception 'Not permitted' using errcode='42501'; end if;
  if p_status not in ('opt_in','opt_out') then raise exception 'Invalid consent status'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'Record how consent was given or withdrawn'; end if;
  perform set_config('lb.consent_source', 'manual', true);
  perform set_config('lb.consent_note', p_note, true);
  if p_status = 'opt_in' then
    update lb_customers set wa_opted_out_at = null, wa_opt_in_at = now() where id = p_customer;
  else
    update lb_customers set wa_opted_out_at = now() where id = p_customer;
  end if;
end $$;

create or replace function lb_suppression_action(p_phone text, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('consent.manage');
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if p_action = 'add' then
    if coalesce(trim(p_reason),'') = '' then raise exception 'Reason required'; end if;
    insert into lb_suppressions (company_id, phone_e164, reason, created_by) values (me.company_id, p_phone, p_reason, me.id)
    on conflict (company_id, phone_e164) do update set reason = excluded.reason;
    perform lb__end_enrollments(null, c.id, null, 'stopped', 'suppressed') from lb_customers c where c.company_id = me.company_id and c.phone_e164 = p_phone;
  elsif p_action = 'remove' then
    delete from lb_suppressions where company_id = me.company_id and phone_e164 = p_phone;
  else raise exception 'Unknown action'; end if;
  perform lb_audit(me.company_id, 'suppression.' || p_action, 'phone', p_phone, jsonb_build_object('reason', p_reason));
end $$;

-- Change status and set the next action in one step (open leads always keep a next action).
create or replace function lb_change_status_with_action(p_lead uuid, p_status uuid, p_reason text, p_won_value numeric,
  p_action_type text, p_action_note text, p_due timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_cat text; v_req boolean;
begin
  if p_due is not null then
    if p_due < now() - interval '5 minutes' then raise exception 'Next action must be in the future'; end if;
    if p_action_type not in ('call','whatsapp','meeting','payment','email','other') then raise exception 'Invalid action type'; end if;
    perform lb_add_followup(p_lead, p_due, p_action_note);
    update lb_followups set action_type = p_action_type
    where id = (select id from lb_followups where lead_id = p_lead and status = 'pending' order by created_at desc limit 1);
  end if;
  perform lb_change_status(p_lead, p_status, p_reason, p_won_value);
  select category into v_cat from lb_lead_statuses where id = p_status;
  select require_next_action into v_req from lb_companies where id = me.company_id;
  if v_req and not lb__closed(v_cat) and not exists (select 1 from lb_followups where lead_id = p_lead and status = 'pending') then
    raise exception 'Open leads need a next action: set what happens next and when';
  end if;
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
end $$;

-- ================================================================ queues (RLS-scoped)
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
      where p_queue = 'hot' and (priority in ('urgent','high') or status_category in ('interested','scheduled'))
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
      where p_queue = 'journeys' and e.status in ('paused','failed')
  )
  select jsonb_build_object('total', (select count(*) from rows),
    'rows', coalesce((select jsonb_agg(r) from (select r from rows order by sort_at asc nulls last limit least(p_limit, 200) offset p_offset) x), '[]'))
$$;

create or replace function lb_nurture_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_object_agg(q, (lb_nurture_queue(q, 1, 0)->>'total')::int)
  from unnest(array['unassigned','unanswered','overdue','no_next_action','hot','payments','failed','recovery','journeys']) q
$$;

-- ================================================================ grants
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('lb__quiet_until','lb__send_check','lb__render_params','lb__queue_automated','lb__journey_event',
      'lb__end_enrollments','lb__enroll','lb_run_journeys','lb_segment_leads','lb_run_campaigns','lb_run_sla','lb_nurture_tick',
      'lb__on_lead_event','lb__on_message','lb__on_message_failed','lb__on_consent','lb__require','lb_save_journey','lb_journey_action',
      'lb_enroll_lead','lb_enrollment_action','lb_save_segment','lb_segment_preview','lb_save_offer','lb_offer_action','lb_save_campaign',
      'lb_campaign_action','lb_set_consent','lb_suppression_action','lb_change_status_with_action','lb_set_payment','lb_nurture_queue','lb_nurture_counts')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname not like 'lb\_\_%' and f.proname not in ('lb_run_journeys','lb_run_campaigns','lb_run_sla','lb_nurture_tick','lb_segment_leads') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Used inside invoker functions / policies by signed-in users.
grant execute on function lb__require(text) to authenticated;

-- Open leads must keep a next action, including direct status changes.
do $$ declare def text := pg_get_functiondef('lb_change_status(uuid,uuid,text,numeric)'::regprocedure);
  old text := E'p_won_value, true);\nend';
begin
  if (length(def) - length(replace(def, old, ''))) / length(old) <> 1 then raise exception 'lb_change_status patch did not match'; end if;
  execute replace(def, old, E'p_won_value, true);\n  if (select require_next_action from lb_companies where id = me.company_id)\n     and not lb__closed((select category from lb_lead_statuses where id = p_status))\n     and not exists (select 1 from lb_followups where lead_id = p_lead and status = ''pending'') then\n    raise exception ''Open leads need a next action: set what happens next and when'';\n  end if;\nend');
end $$;

select cron.schedule('lb-nurture-tick', '* * * * *', 'select public.lb_nurture_tick()');
select cron.unschedule('lb-followup-reminders');

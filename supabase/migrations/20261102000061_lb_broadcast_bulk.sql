-- WhatsApp broadcast to lead segments + bulk lead actions.
--
--   1. Segment rules gain status_ids / sub_status_ids (exact statuses, not just
--      categories). The rule matching moves into lb__rule_leads(company, rules)
--      so a broadcast can preview an audience before anything is saved.
--      Soft-deleted leads never enter a segment.
--   2. lb_broadcast(p): one call from the UI = audience (picked leads or
--      filters) + segment + campaign, submitted, and approved straight away when
--      the caller may approve campaigns. dry_run returns the audience preview.
--      All send-time guards (opt-in, opt-out, suppression, frequency cap, quiet
--      hours) stay in lb_run_campaigns.
--   3. lb_campaign_report(campaign): delivery/read funnel + per-recipient rows.
--   4. lb_bulk_update_leads(ids, p): status / sub-status / tags / priority for
--      many leads, each through the same checks as a single edit.
-- Everything is scoped to the caller's (acting) company.

-- ------------------------------------------------------------ 1. segments
create or replace function public.lb__rule_leads(p_company uuid, p_rules jsonb) returns table (lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  select x.lead_id, x.customer_id from (
    select distinct on (l.customer_id) l.id lead_id, l.customer_id, l.created_at
    from lb_leads l, (select coalesce(p_rules, '{}'::jsonb) rules) r
    where l.company_id = p_company and l.deleted_at is null
      and (coalesce((r.rules->>'include_closed')::boolean, false) or not lb__closed(l.status_category))
      and (jsonb_array_length(coalesce(r.rules->'categories','[]')) = 0 or l.status_category in (select jsonb_array_elements_text(r.rules->'categories')))
      and (jsonb_array_length(coalesce(r.rules->'status_ids','[]')) = 0 or l.status_id::text in (select jsonb_array_elements_text(r.rules->'status_ids')))
      and (jsonb_array_length(coalesce(r.rules->'sub_status_ids','[]')) = 0 or l.sub_status_id::text in (select jsonb_array_elements_text(r.rules->'sub_status_ids')))
      and (jsonb_array_length(coalesce(r.rules->'product_ids','[]')) = 0 or l.product_id::text in (select jsonb_array_elements_text(r.rules->'product_ids')))
      and (jsonb_array_length(coalesce(r.rules->'source_ids','[]')) = 0 or l.source_id::text in (select jsonb_array_elements_text(r.rules->'source_ids')))
      and (jsonb_array_length(coalesce(r.rules->'tag_ids','[]')) = 0 or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id::text in (select jsonb_array_elements_text(r.rules->'tag_ids'))))
      and (jsonb_array_length(coalesce(r.rules->'owner_ids','[]')) = 0 or l.owner_id::text in (select jsonb_array_elements_text(r.rules->'owner_ids')))
      and (nullif(r.rules->>'number_id','') is null or l.number_id::text = r.rules->>'number_id')
      and (nullif(r.rules->>'priority','') is null or l.priority = any(string_to_array(r.rules->>'priority', ',')))
      and (nullif(r.rules->>'inactive_days','') is null or l.last_activity_at < now() - make_interval(days => (r.rules->>'inactive_days')::int))
      and (nullif(r.rules->>'created_within_days','') is null or l.created_at > now() - make_interval(days => (r.rules->>'created_within_days')::int))
      and (coalesce(r.rules->>'purchased','any') = 'any'
           or (r.rules->>'purchased' = 'yes') = exists (select 1 from lb_leads w where w.customer_id = l.customer_id and w.status_category = 'won' and w.deleted_at is null))
      and (coalesce(r.rules->>'replied_days','') = '' or exists (select 1 from lb_messages m join lb_conversations v on v.id = m.conversation_id
           where v.customer_id = l.customer_id and m.direction = 'in' and m.created_at > now() - make_interval(days => (r.rules->>'replied_days')::int)))
    order by l.customer_id, l.created_at desc
  ) x
$$;
revoke all on function public.lb__rule_leads(uuid, jsonb) from public, anon, authenticated;

-- Same contract as 20261020000022 (rule segments + list segments), rules via lb__rule_leads.
create or replace function public.lb_segment_leads(p_segment uuid) returns table(lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  select rl.lead_id, rl.customer_id
  from lb_segments sg, lateral lb__rule_leads(sg.company_id, sg.rules) rl
  where sg.id = p_segment and coalesce(sg.rules->>'kind', 'rules') <> 'list'
  union all
  select (select l.id from lb_leads l where l.customer_id = m.customer_id and l.deleted_at is null order by l.created_at desc limit 1), m.customer_id
  from lb_segment_members m join lb_segments sg on sg.id = m.segment_id
  where m.segment_id = p_segment and sg.rules->>'kind' = 'list'
$$;

-- ------------------------------------------------------------ 2. broadcast
-- Audience for a broadcast: picked leads (only ones the caller can see) or filter rules.
create or replace function public.lb__broadcast_audience(p_company uuid, p jsonb) returns table (lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  (select distinct on (l.customer_id) l.id, l.customer_id
  from lb_leads l
  where jsonb_typeof(p->'lead_ids') = 'array'
    and l.company_id = p_company and l.deleted_at is null
    and l.id in (select (jsonb_array_elements_text(p->'lead_ids'))::uuid)
    and lb_can_see_lead(l.company_id, l.team_id, l.owner_id)
  order by l.customer_id, l.created_at desc)
  union all
  select * from lb__rule_leads(p_company, p->'rules') where jsonb_typeof(p->'lead_ids') is distinct from 'array'
$$;
revoke all on function public.lb__broadcast_audience(uuid, jsonb) from public, anon, authenticated;

create or replace function public.lb_broadcast(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me lb_profiles := lb__require('campaigns.manage');
  v_name text := left(trim(coalesce(p->>'name', '')), 120);
  v_seg uuid; v_camp uuid; v_try text; i int := 1; v_opt int := 0; v_status text; v_preview jsonb;
  v_attest boolean := coalesce(trim(p->>'opt_in_note'), '') <> '';
begin
  if jsonb_typeof(p->'lead_ids') = 'array' and jsonb_array_length(p->'lead_ids') > 5000 then raise exception 'Max 5000 leads per broadcast'; end if;
  if v_attest and not lb_can('consent.manage') then raise exception 'Recording opt-in needs the consent permission' using errcode = '42501'; end if;

  if to_regclass('pg_temp.lb_tmp_bc') is null then
    create temp table lb_tmp_bc (lead_id uuid, customer_id uuid) on commit drop;
  else
    truncate lb_tmp_bc;
  end if;
  insert into lb_tmp_bc select * from lb__broadcast_audience(me.company_id, p);

  with s as (select c.name, c.phone_e164, c.wa_opt_in_at, c.wa_opted_out_at,
               exists (select 1 from lb_suppressions x where x.company_id = me.company_id and x.phone_e164 = c.phone_e164) suppressed
             from lb_tmp_bc a join lb_customers c on c.id = a.customer_id)
  select jsonb_build_object(
    'total', (select count(*) from s),
    'eligible', (select count(*) from s where wa_opted_out_at is null and (wa_opt_in_at is not null or v_attest) and not suppressed),
    'opted_out', (select count(*) from s where wa_opted_out_at is not null),
    'no_consent', (select count(*) from s where wa_opted_out_at is null and wa_opt_in_at is null),
    'suppressed', (select count(*) from s where suppressed),
    'sample', coalesce((select jsonb_agg(row_to_json(x)) from (select name, phone_e164 from s
                 where wa_opted_out_at is null and (wa_opt_in_at is not null or v_attest) and not suppressed limit 5) x), '[]'))
  into v_preview;

  if coalesce((p->>'dry_run')::boolean, false) then return jsonb_build_object('preview', v_preview); end if;
  if (v_preview->>'total')::int = 0 then raise exception 'No leads match this audience'; end if;
  if v_name = '' then raise exception 'Name the broadcast'; end if;

  -- Unique campaign name (and matching segment name) inside the company.
  v_try := v_name;
  while exists (select 1 from lb_campaigns where company_id = me.company_id and name = v_try)
     or exists (select 1 from lb_segments where company_id = me.company_id and name = 'Broadcast · ' || v_try) loop
    i := i + 1; v_try := v_name || ' (' || i || ')';
  end loop;

  if jsonb_typeof(p->'lead_ids') = 'array' then
    insert into lb_segments (company_id, name, rules, created_by) values (me.company_id, 'Broadcast · ' || v_try, '{"kind":"list"}', me.id) returning id into v_seg;
    insert into lb_segment_members (segment_id, customer_id, company_id)
    select v_seg, customer_id, me.company_id from lb_tmp_bc on conflict do nothing;
  else
    insert into lb_segments (company_id, name, rules, created_by) values (me.company_id, 'Broadcast · ' || v_try, coalesce(p->'rules', '{}'), me.id) returning id into v_seg;
  end if;

  if v_attest then
    perform set_config('lb.consent_source', 'manual', true);
    perform set_config('lb.consent_note', trim(p->>'opt_in_note'), true);
    update lb_customers c set wa_opt_in_at = now()
    where c.id in (select customer_id from lb_tmp_bc) and c.wa_opted_out_at is null and c.wa_opt_in_at is null;
    get diagnostics v_opt = row_count;
  end if;

  v_camp := lb_save_campaign(jsonb_build_object(
    'name', v_try, 'segment_id', v_seg, 'number_id', p->>'number_id', 'template_name', p->>'template_name',
    'template_language', p->>'template_language', 'template_params', coalesce(p->'template_params', '[]'), 'scheduled_at', p->>'scheduled_at'));
  perform lb_campaign_action(v_camp, 'submit');
  if lb_can('campaigns.approve') then perform lb_campaign_action(v_camp, 'approve'); end if;
  select status into v_status from lb_campaigns where id = v_camp;
  perform lb_audit(me.company_id, 'campaign.broadcast', 'campaign', v_camp::text,
    jsonb_build_object('audience', v_preview - 'sample', 'opted_in', v_opt, 'opt_in_note', p->>'opt_in_note', 'picked', jsonb_typeof(p->'lead_ids') = 'array'));
  return jsonb_build_object('campaign_id', v_camp, 'status', v_status, 'name', v_try, 'opted_in', v_opt, 'preview', v_preview);
end $$;
revoke all on function public.lb_broadcast(jsonb) from public, anon;
grant execute on function public.lb_broadcast(jsonb) to authenticated;

-- ------------------------------------------------------------ 3. report
create or replace function public.lb_campaign_report(p_campaign uuid, p_limit int default 1000) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage');
begin
  if not exists (select 1 from lb_campaigns where id = p_campaign and company_id = me.company_id) then raise exception 'Campaign not found'; end if;
  return (
    with r as (
      select rc.id, rc.status rstatus, rc.reason, rc.updated_at, rc.next_try_at, cu.name, cu.phone_e164, rc.lead_id, l.lead_no,
             m.status mstatus, m.error_code, m.error_message, m.sent_at, m.delivered_at, m.read_at, m.failed_at, m.created_at queued_at,
             exists (select 1 from lb_attributions a where a.campaign_id = p_campaign and a.customer_id = rc.customer_id and a.event = 'reply') replied,
             exists (select 1 from lb_attributions a where a.campaign_id = p_campaign and a.customer_id = rc.customer_id and a.event = 'conversion') converted
      from lb_campaign_recipients rc
      join lb_customers cu on cu.id = rc.customer_id
      left join lb_leads l on l.id = rc.lead_id
      left join lb_messages m on m.id = rc.message_id
      where rc.campaign_id = p_campaign and rc.company_id = me.company_id)
    select jsonb_build_object(
      'audience', (select count(*) from r),
      'waiting', (select count(*) from r where rstatus = 'pending'),
      'skipped', (select count(*) from r where rstatus = 'skipped'),
      'queued', (select count(*) from r where rstatus = 'queued' and mstatus in ('queued','sending')),
      'sent', (select count(*) from r where mstatus in ('sent','delivered','read')),
      'delivered', (select count(*) from r where mstatus in ('delivered','read')),
      'read', (select count(*) from r where mstatus = 'read'),
      'failed', (select count(*) from r where mstatus = 'failed' or rstatus = 'failed'),
      'replied', (select count(*) from r where replied),
      'converted', (select count(*) from r where converted),
      'reasons', coalesce((select jsonb_object_agg(k, n) from (select coalesce(reason, 'other') k, count(*) n from r where rstatus in ('skipped','pending') and reason is not null group by 1) z), '{}'),
      'errors', coalesce((select jsonb_object_agg(k, n) from (select coalesce(nullif(error_message, ''), error_code, 'unknown') k, count(*) n from r where mstatus = 'failed' group by 1) z), '{}'),
      'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
        select id, name, phone_e164, lead_id, lead_no, rstatus, reason, mstatus, error_message, queued_at, sent_at, delivered_at, read_at, failed_at, replied, converted, next_try_at
        from r order by coalesce(read_at, delivered_at, sent_at, failed_at, queued_at, updated_at) desc nulls last limit greatest(1, least(p_limit, 5000))) x), '[]'))
  );
end $$;
revoke all on function public.lb_campaign_report(uuid, int) from public, anon;
grant execute on function public.lb_campaign_report(uuid, int) to authenticated;

-- ------------------------------------------------------------ 4. bulk lead actions
-- p.action: status {status_id, reason?, won_value?, due?} | sub_status {sub_status_id|null}
--           | tags_add {tag_ids} | tags_remove {tag_ids} | priority {priority}
-- Each lead runs in its own sub-transaction: one failure does not undo the rest.
create or replace function public.lb_bulk_update_leads(p_leads uuid[], p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me lb_profiles := lb__me(); v_act text := p->>'action'; v_id uuid; l lb_leads; ok int := 0; bad int := 0; errs jsonb := '{}';
  v_tags uuid[]; v_msg text;
begin
  if coalesce(array_length(p_leads, 1), 0) = 0 then raise exception 'Select at least one lead'; end if;
  if array_length(p_leads, 1) > 500 then raise exception 'Max 500 leads at a time'; end if;
  if v_act in ('status','sub_status') and not lb_can('leads.status') then raise exception 'You do not have permission to change lead status' using errcode = '42501'; end if;
  if v_act in ('tags_add','tags_remove','priority') and not lb_can('leads.edit') then raise exception 'You do not have permission to edit leads' using errcode = '42501'; end if;
  if v_act = 'priority' and coalesce(p->>'priority', '') not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
  if v_act in ('tags_add','tags_remove') then
    select array_agg(t.id) into v_tags from lb_tags t
    where t.company_id = me.company_id and t.id::text in (select jsonb_array_elements_text(coalesce(p->'tag_ids', '[]')));
    if v_tags is null then raise exception 'Choose at least one tag'; end if;
  end if;
  if v_act not in ('status','sub_status','tags_add','tags_remove','priority') then raise exception 'Unknown bulk action'; end if;

  foreach v_id in array p_leads loop
    begin
      select * into l from lb_leads where id = v_id;
      if l.id is null or l.company_id <> me.company_id or l.deleted_at is not null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
        raise exception 'Not permitted';
      end if;
      if v_act = 'status' then
        perform lb_change_status_with_action(v_id, (p->>'status_id')::uuid, nullif(trim(p->>'reason'), ''),
          nullif(p->>'won_value', '')::numeric, 'call', null, nullif(p->>'due', '')::timestamptz);
      elsif v_act = 'sub_status' then
        perform lb_set_sub_status(v_id, nullif(p->>'sub_status_id', '')::uuid);
      elsif v_act = 'tags_add' then
        insert into lb_lead_tags (lead_id, tag_id) select v_id, unnest(v_tags) on conflict do nothing;
        update lb_leads set updated_at = now() where id = v_id;
      elsif v_act = 'tags_remove' then
        delete from lb_lead_tags where lead_id = v_id and tag_id = any(v_tags);
        update lb_leads set updated_at = now() where id = v_id;
      elsif v_act = 'priority' then
        if l.priority is distinct from p->>'priority' then
          update lb_leads set priority = p->>'priority', updated_at = now() where id = v_id;
          insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
          values (l.company_id, v_id, me.id, l.owner_id, 'field_update', true, jsonb_build_object('priority', p->>'priority', 'from_priority', l.priority));
        end if;
      end if;
      ok := ok + 1;
    exception when others then
      bad := bad + 1;
      v_msg := left(sqlerrm, 160);
      errs := jsonb_set(errs, array[v_msg], to_jsonb(coalesce((errs->>v_msg)::int, 0) + 1));
    end;
  end loop;
  perform lb_audit(me.company_id, 'lead.bulk_' || v_act, 'lead', null, jsonb_build_object('n', array_length(p_leads, 1), 'ok', ok, 'failed', bad, 'p', p));
  return jsonb_build_object('ok', ok, 'failed', bad, 'errors', errs);
end $$;
revoke all on function public.lb_bulk_update_leads(uuid[], jsonb) from public, anon;
grant execute on function public.lb_bulk_update_leads(uuid[], jsonb) to authenticated;

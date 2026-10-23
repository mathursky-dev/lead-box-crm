-- CSV audience (ported from wacrm broadcasts): a "list" segment holds explicit customers. Additive only.
create table if not exists lb_segment_members (
  segment_id uuid not null references lb_segments(id) on delete cascade,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  company_id uuid not null references lb_companies(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (segment_id, customer_id)
);
alter table lb_segment_members enable row level security;
create policy lb_segment_members_read on lb_segment_members for select to authenticated using (company_id = lb_my_company() or lb_is_super());

-- List segments return their members (with the customer's latest lead, if any); rule segments unchanged.
create or replace function lb_segment_leads(p_segment uuid) returns table(lead_id uuid, customer_id uuid)
language sql stable security definer set search_path = public as $$
  with sg as (select * from lb_segments where id = p_segment), r as (select rules from sg)
  select x.lead_id, x.customer_id from (
    select distinct on (l.customer_id) l.id lead_id, l.customer_id, l.created_at
    from lb_leads l join sg on sg.company_id = l.company_id join lb_customers c on c.id = l.customer_id, r
    where coalesce(r.rules->>'kind', 'rules') <> 'list'
      and (coalesce((r.rules->>'include_closed')::boolean, false) or not lb__closed(l.status_category))
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
  ) x
  union all
  select (select l.id from lb_leads l where l.customer_id = m.customer_id order by l.created_at desc limit 1), m.customer_id
  from lb_segment_members m, r where m.segment_id = p_segment and r.rules->>'kind' = 'list'
$$;

-- Import a CSV list: rows = [{phone (E.164), name}]. Creates missing customers, never touches opted-out
-- customers' consent, and records opt-in only when an authorised user attests to it.
create or replace function lb_import_segment_list(p_name text, p_rows jsonb, p_opt_in boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('campaigns.manage'); v_seg uuid; x jsonb; v_cust uuid; v_new int := 0; v_found int := 0; v_opt int := 0; v_bad int := 0;
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'Name the list'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No rows'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Max 5000 rows per list'; end if;
  if p_opt_in then
    if not lb_can('consent.manage') then raise exception 'Recording opt-in needs the consent permission' using errcode='42501'; end if;
    if coalesce(trim(p_note),'') = '' then raise exception 'Describe how these contacts gave WhatsApp opt-in'; end if;
    perform set_config('lb.consent_source', 'import', true);
    perform set_config('lb.consent_note', p_note, true);
  end if;
  insert into lb_segments (company_id, name, rules, created_by) values (me.company_id, trim(p_name), '{"kind":"list"}', me.id) returning id into v_seg;
  for x in select * from jsonb_array_elements(p_rows) loop
    if coalesce(x->>'phone','') !~ '^\+[1-9][0-9]{6,14}$' then v_bad := v_bad + 1; continue; end if;
    select id into v_cust from lb_customers where company_id = me.company_id and phone_e164 = x->>'phone';
    if v_cust is null then
      insert into lb_customers (company_id, phone_e164, name) values (me.company_id, x->>'phone', nullif(left(trim(x->>'name'), 120), ''))
      on conflict (company_id, phone_e164) do nothing returning id into v_cust;
      if v_cust is null then select id into v_cust from lb_customers where company_id = me.company_id and phone_e164 = x->>'phone'; else v_new := v_new + 1; end if;
    else
      v_found := v_found + 1;
    end if;
    if p_opt_in then
      update lb_customers set wa_opt_in_at = now() where id = v_cust and wa_opted_out_at is null and wa_opt_in_at is null;
      if found then v_opt := v_opt + 1; end if;
    end if;
    insert into lb_segment_members (segment_id, customer_id, company_id) values (v_seg, v_cust, me.company_id) on conflict do nothing;
  end loop;
  perform lb_audit(me.company_id, 'segment.import_list', 'segment', v_seg::text,
    jsonb_build_object('rows', jsonb_array_length(p_rows), 'new', v_new, 'existing', v_found, 'opted_in', v_opt, 'invalid', v_bad, 'note', p_note));
  return jsonb_build_object('segment_id', v_seg, 'new', v_new, 'existing', v_found, 'opted_in', v_opt, 'invalid', v_bad);
end $$;

revoke execute on function lb_import_segment_list(text, jsonb, boolean, text) from public, anon;
grant execute on function lb_import_segment_list(text, jsonb, boolean, text) to authenticated, service_role;

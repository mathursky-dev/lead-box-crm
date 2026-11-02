-- Duplicate leads: find leads of the same phone number (same customer) in the
-- open company and let a company admin merge them into one lead.
--
--   1. lb_leads.merged_into: a merged lead is soft deleted (deleted_at) and points
--      at the lead it was merged into. Old links to it redirect there
--      (lb_merged_target). It cannot be restored (lb_restore_leads skips it).
--   2. lb_duplicate_leads(p): groups of 2+ active leads with the same number in
--      the acting company (company admin / switched super admin only).
--   3. lb_merge_preview(primary, others): what will move and which empty fields
--      of the kept lead get filled. Read only.
--   4. lb_merge_leads(primary, others): moves EVERYTHING that points at the other
--      leads (history, notes, follow-ups, tags, tasks, chats, journeys, campaign
--      / attribution rows, Facebook lead rows, and any table added later with a
--      foreign key to lb_leads) onto the kept lead, fills its empty fields, logs
--      the merge on the timeline + audit log, then soft deletes the others.
-- Safe to re-run.

-- ------------------------------------------------------------ 1. column + restore
alter table public.lb_leads add column if not exists merged_into uuid references public.lb_leads(id) on delete set null;
create index if not exists lb_leads_merged_into on public.lb_leads (merged_into) where merged_into is not null;
create index if not exists lb_leads_customer_active on public.lb_leads (customer_id) where deleted_at is null;

-- Same as 20261102000041, but a merged lead stays merged (its history now lives on the kept lead).
create or replace function public.lb_restore_leads(p_leads uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_ids uuid[];
begin
  select array_agg(id) into v_ids from lb_leads
  where id = any(p_leads) and deleted_at is not null and merged_into is null and lb_is_admin_of(company_id);
  if v_ids is null then return 0; end if;
  update lb_leads set deleted_at = null, deleted_by = null, updated_at = now() where id = any(v_ids);
  perform lb_audit(me.company_id, 'leads.restore', 'lead', null, jsonb_build_object('lead_ids', to_jsonb(v_ids)));
  return array_length(v_ids, 1);
end $$;

-- Where did a merged lead go? Only answers when the caller can see the kept lead.
create or replace function public.lb_merged_target(p_lead uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := p_lead; i int := 0;
begin
  loop
    select merged_into into v from lb_leads where id = v;
    exit when v is null or i > 10;
    i := i + 1;
    if exists (select 1 from lb_leads l where l.id = v and l.deleted_at is null and lb_can_see_lead(l.company_id, l.team_id, l.owner_id)) then
      return v;
    end if;
  end loop;
  return null;
end $$;

-- ------------------------------------------------------------ 2. find duplicates
create or replace function public.lb_duplicate_leads(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := lb_my_company();
  v_q text := nullif(trim(coalesce(p->>'q', '')), '');
  v_open boolean := coalesce((p->>'open_only')::boolean, false);
  v_customer uuid := nullif(p->>'customer_id', '')::uuid;
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_total int; v_rows jsonb;
begin
  if v_company is null or not lb_is_admin_of(v_company) then
    raise exception 'Only a company admin can manage duplicate leads' using errcode = '42501';
  end if;

  with g as (
    select l.customer_id, count(*) n,
           count(*) filter (where l.status_category not in ('won','lost','closed')) n_open,
           max(l.last_activity_at) last_act
    from lb_leads l
    where l.company_id = v_company and l.deleted_at is null
      and (v_customer is null or l.customer_id = v_customer)
    group by l.customer_id
    having count(*) > 1
  ), f as (
    select g.*, c.name, c.phone_e164 from g join lb_customers c on c.id = g.customer_id
    where (not v_open or g.n_open > 1)
      and (v_q is null or c.name ilike '%' || v_q || '%' or c.phone_e164 like '%' || regexp_replace(v_q, '\D', '', 'g') || '%'
           or exists (select 1 from lb_leads x where x.customer_id = g.customer_id and x.deleted_at is null and 'LB-' || x.lead_no = upper(v_q)))
  ), page as (
    select * from f order by n desc, last_act desc nulls last, customer_id limit v_limit offset v_offset
  )
  select (select count(*) from f),
         coalesce(jsonb_agg(jsonb_build_object(
           'customer_id', page.customer_id, 'name', page.name, 'phone', page.phone_e164,
           'count', page.n, 'open', page.n_open, 'last_activity_at', page.last_act,
           'leads', (
             select jsonb_agg(jsonb_build_object(
               'id', l.id, 'lead_no', l.lead_no, 'status', s.name, 'category', l.status_category,
               'owner', o.full_name, 'source', src.name, 'product', pr.name, 'priority', l.priority,
               'expected_value', l.expected_value, 'created_at', l.created_at, 'last_activity_at', l.last_activity_at,
               'next_followup_at', l.next_followup_at, 'is_repeat', l.is_repeat,
               'events', (select count(*) from lb_lead_events e where e.lead_id = l.id),
               'notes', (select count(*) from lb_notes nn where nn.lead_id = l.id),
               'followups', (select count(*) from lb_followups fu where fu.lead_id = l.id and fu.status = 'pending')
             ) order by l.created_at)
             from lb_leads l
             join lb_lead_statuses s on s.id = l.status_id
             left join lb_profiles o on o.id = l.owner_id
             left join lb_sources src on src.id = l.source_id
             left join lb_products pr on pr.id = l.product_id
             where l.customer_id = page.customer_id and l.deleted_at is null)
         ) order by page.n desc, page.last_act desc nulls last, page.customer_id), '[]'::jsonb)
  into v_total, v_rows
  from page;

  return jsonb_build_object('total', v_total, 'groups', v_rows);
end $$;

-- ------------------------------------------------------------ 3 + 4. preview / merge
-- Every single-column foreign key that points at lb_leads(id).
create or replace function public.lb__lead_fk_columns()
returns table (tbl text, col text) language sql stable security definer set search_path = public as $$
  select c.conrelid::regclass::text, a.attname::text
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'public.lb_leads'::regclass and array_length(c.conkey, 1) = 1
  order by 1, 2
$$;

-- Shared checks. Returns the kept lead, locked.
create or replace function public.lb__merge_check(p_primary uuid, p_others uuid[], p_lock boolean)
returns lb_leads language plpgsql security definer set search_path = public as $$
declare k lb_leads; v_others uuid[]; n int;
begin
  select array_agg(distinct x) into v_others from unnest(p_others) x where x is not null and x <> p_primary;
  if v_others is null then raise exception 'Pick at least one other lead to merge'; end if;
  if array_length(v_others, 1) > 20 then raise exception 'At most 20 leads can be merged at once'; end if;
  if p_lock then
    perform 1 from lb_leads where id = p_primary or id = any(v_others) order by id for update;
  end if;
  select * into k from lb_leads where id = p_primary;
  if k.id is null or k.deleted_at is not null then raise exception 'The lead to keep was not found'; end if;
  if k.company_id is distinct from lb_my_company() or not lb_is_admin_of(k.company_id) then
    raise exception 'Only a company admin can merge leads' using errcode = '42501';
  end if;
  select count(*) into n from lb_leads
  where id = any(v_others) and company_id = k.company_id and customer_id = k.customer_id and deleted_at is null;
  if n <> array_length(v_others, 1) then
    raise exception 'Only active leads of the same number can be merged';
  end if;
  return k;
end $$;

create or replace function public.lb_merge_preview(p_primary uuid, p_others uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lb_leads; r record; n bigint; v_moves jsonb := '{}'; v_fills text[] := '{}'; v_others uuid[];
  d lb_leads;
begin
  k := lb__merge_check(p_primary, p_others, false);
  select array_agg(distinct x) into v_others from unnest(p_others) x where x is not null and x <> p_primary;
  for r in select * from lb__lead_fk_columns() loop
    if r.tbl in ('lb_leads', 'lb_lead_tags') then continue; end if;
    execute format('select count(*) from %s where %I = any($1)', r.tbl, r.col) into n using v_others;
    if n > 0 then v_moves := v_moves || jsonb_build_object(r.tbl, n); end if;
  end loop;
  select count(*) into n from lb_lead_tags t where t.lead_id = any(v_others)
    and not exists (select 1 from lb_lead_tags t2 where t2.lead_id = p_primary and t2.tag_id = t.tag_id);
  v_moves := v_moves || jsonb_build_object('new_tags', n);

  -- First non-empty value among the other leads, newest activity first (same rule as the merge).
  for d in select * from lb_leads where id = any(v_others) order by last_activity_at desc loop
    if k.owner_id is null and d.owner_id is not null then v_fills := v_fills || 'owner'::text; k.owner_id := d.owner_id; end if;
    if k.product_id is null and d.product_id is not null then v_fills := v_fills || 'product'::text; k.product_id := d.product_id; end if;
    if k.source_id is null and d.source_id is not null then v_fills := v_fills || 'source'::text; k.source_id := d.source_id; end if;
    if k.branch_id is null and d.branch_id is not null then v_fills := v_fills || 'branch'::text; k.branch_id := d.branch_id; end if;
    if k.department_id is null and d.department_id is not null then v_fills := v_fills || 'department'::text; k.department_id := d.department_id; end if;
    if k.expected_value is null and d.expected_value is not null then v_fills := v_fills || 'expected value'::text; k.expected_value := d.expected_value; end if;
    if nullif(trim(k.notes), '') is null and nullif(trim(d.notes), '') is not null then v_fills := v_fills || 'notes'::text; k.notes := d.notes; end if;
    if k.payment_status = 'none' and d.payment_status <> 'none' then v_fills := v_fills || 'payment'::text; k.payment_status := d.payment_status; end if;
    if (d.custom - array(select jsonb_object_keys(k.custom))) <> '{}'::jsonb then v_fills := v_fills || 'custom fields'::text; k.custom := d.custom || k.custom; end if;
  end loop;

  return jsonb_build_object('keep', jsonb_build_object('id', k.id, 'lead_no', k.lead_no),
    'merge', (select jsonb_agg(jsonb_build_object('id', id, 'lead_no', lead_no) order by lead_no) from lb_leads where id = any(v_others)),
    'moves', v_moves, 'fills', to_jsonb(v_fills));
end $$;

create or replace function public.lb_merge_leads(p_primary uuid, p_others uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me lb_profiles := lb__me(); k lb_leads; d lb_leads; r record; n bigint; rid record;
  v_others uuid[]; v_nos bigint[]; v_moves jsonb := '{}'; v_fills text[] := '{}'; v_owner uuid;
begin
  k := lb__merge_check(p_primary, p_others, true);
  select array_agg(distinct x) into v_others from unnest(p_others) x where x is not null and x <> p_primary;
  select array_agg(lead_no order by lead_no) into v_nos from lb_leads where id = any(v_others);

  -- a) Fill the kept lead's empty fields from the others (newest activity first).
  for d in select * from lb_leads where id = any(v_others) order by last_activity_at desc loop
    if k.owner_id is null and v_owner is null and d.owner_id is not null
       and exists (select 1 from lb_profiles u where u.id = d.owner_id and u.is_active) then
      v_owner := d.owner_id; v_fills := v_fills || 'owner'::text;
    end if;
    if k.product_id is null and d.product_id is not null then k.product_id := d.product_id; v_fills := v_fills || 'product'::text; end if;
    if k.source_id is null and d.source_id is not null then k.source_id := d.source_id; v_fills := v_fills || 'source'::text; end if;
    if k.branch_id is null and d.branch_id is not null then k.branch_id := d.branch_id; v_fills := v_fills || 'branch'::text; end if;
    if k.department_id is null and d.department_id is not null then k.department_id := d.department_id; v_fills := v_fills || 'department'::text; end if;
    if k.team_id is null and d.team_id is not null then k.team_id := d.team_id; end if;
    if k.expected_value is null and d.expected_value is not null then k.expected_value := d.expected_value; v_fills := v_fills || 'expected value'::text; end if;
    if nullif(trim(k.notes), '') is null and nullif(trim(d.notes), '') is not null then k.notes := d.notes; v_fills := v_fills || 'notes'::text; end if;
    if k.payment_status = 'none' and d.payment_status <> 'none' then
      k.payment_status := d.payment_status; k.payment_due_amount := d.payment_due_amount; k.payment_due_at := d.payment_due_at;
      v_fills := v_fills || 'payment'::text;
    end if;
    if (d.custom - array(select jsonb_object_keys(k.custom))) <> '{}'::jsonb then k.custom := d.custom || k.custom; v_fills := v_fills || 'custom fields'::text; end if;
    if d.remark_at is not null and (k.remark_at is null or d.remark_at > k.remark_at) then k.remark := d.remark; k.remark_at := d.remark_at; end if;
    if d.last_activity_at > k.last_activity_at then k.last_activity_at := d.last_activity_at; end if;
    if d.first_allocated_at is not null and (k.first_allocated_at is null or d.first_allocated_at < k.first_allocated_at) then
      k.first_allocated_at := d.first_allocated_at;
    end if;
  end loop;
  -- The kept lead must not stay a "repeat" of a lead that is being merged into it.
  if k.parent_lead_id = any(v_others) then
    select parent_lead_id into k.parent_lead_id from lb_leads where id = k.parent_lead_id;
    if k.parent_lead_id = any(v_others) or k.parent_lead_id = k.id then k.parent_lead_id := null; end if;
    k.is_repeat := k.parent_lead_id is not null;
  end if;
  update lb_leads set product_id = k.product_id, source_id = k.source_id, branch_id = k.branch_id,
    department_id = k.department_id, team_id = k.team_id, expected_value = k.expected_value, notes = k.notes,
    payment_status = k.payment_status, payment_due_amount = k.payment_due_amount, payment_due_at = k.payment_due_at,
    custom = k.custom, remark = k.remark, remark_at = k.remark_at, last_activity_at = k.last_activity_at,
    first_allocated_at = k.first_allocated_at, parent_lead_id = k.parent_lead_id, is_repeat = k.is_repeat,
    updated_at = now()
  where id = k.id;

  -- b) Tags (primary key lead_id + tag_id) and journeys (one active per lead).
  insert into lb_lead_tags (lead_id, tag_id) select k.id, tag_id from lb_lead_tags where lead_id = any(v_others)
  on conflict do nothing;
  get diagnostics n = row_count; v_moves := v_moves || jsonb_build_object('new_tags', n);
  delete from lb_lead_tags where lead_id = any(v_others);
  update lb_journey_enrollments set status = 'stopped', status_reason = 'lead merged into LB-' || k.lead_no
  where lead_id = any(v_others) and status in ('active', 'paused')
    and (exists (select 1 from lb_journey_enrollments x where x.lead_id = k.id and x.status in ('active', 'paused'))
         or id is distinct from (select x.id from lb_journey_enrollments x where x.lead_id = any(v_others)
                                 and x.status in ('active', 'paused') order by x.enrolled_at desc limit 1));

  -- c) Everything else that points at the other leads. Generic, so tables added
  --    later (quotations, payments, calls...) move too. A row that would break a
  --    unique rule on the kept lead (e.g. a second "conversion" attribution)
  --    stays with the merged lead.
  for r in select * from lb__lead_fk_columns() loop
    if r.tbl in ('lb_leads', 'lb_lead_tags') then continue; end if;
    begin
      execute format('update %s set %I = $1 where %I = any($2)', r.tbl, r.col, r.col) using k.id, v_others;
      get diagnostics n = row_count;
    exception when unique_violation then
      n := 0;
      for rid in execute format('select ctid as t from %s where %I = any($1)', r.tbl, r.col) using v_others loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using k.id, rid.t;
          n := n + 1;
        exception when unique_violation then null;
        end;
      end loop;
    end;
    if n > 0 then v_moves := v_moves || jsonb_build_object(r.tbl, n); end if;
  end loop;
  -- Other leads that were repeats of / merged into a merged lead now point at the kept one.
  update lb_leads set parent_lead_id = k.id where parent_lead_id = any(v_others) and id <> k.id and not (id = any(v_others));
  update lb_leads set merged_into = k.id where merged_into = any(v_others);

  -- d) Soft delete the merged leads.
  update lb_leads set deleted_at = now(), deleted_by = me.id, merged_into = k.id, next_followup_at = null, updated_at = now()
  where id = any(v_others);

  -- e) Owner (logged as an assignment), next follow-up, chat assignee.
  if v_owner is not null then perform lb__assign(k.id, v_owner, me.id, 'Owner taken from merged lead'); end if;
  perform lb__refresh_next_followup(k.id);
  select * into k from lb_leads where id = k.id;
  if k.owner_id is not null then
    update lb_followups set assigned_to = k.owner_id where lead_id = k.id and status = 'pending' and assigned_to is distinct from k.owner_id;
  end if;

  -- f) Timeline + audit.
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, data)
  values (k.company_id, k.id, me.id, k.owner_id, 'field_update',
    jsonb_build_object('merged_leads', to_jsonb(v_nos), 'moved', v_moves, 'filled', to_jsonb(v_fills)));
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, data)
  select company_id, id, me.id, owner_id, 'field_update', jsonb_build_object('merged_into', k.lead_no)
  from lb_leads where id = any(v_others);
  perform lb_audit(k.company_id, 'leads.merge', 'lead', k.id::text,
    jsonb_build_object('merged_lead_ids', to_jsonb(v_others), 'lead_nos', to_jsonb(v_nos), 'moved', v_moves, 'filled', to_jsonb(v_fills)));

  return jsonb_build_object('lead_id', k.id, 'lead_no', k.lead_no, 'merged', to_jsonb(v_nos), 'moved', v_moves, 'filled', to_jsonb(v_fills));
end $$;

-- ------------------------------------------------------------ grants
revoke all on function public.lb__lead_fk_columns() from public, anon, authenticated;
revoke all on function public.lb__merge_check(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.lb_merged_target(uuid) from public, anon;
revoke all on function public.lb_duplicate_leads(jsonb) from public, anon;
revoke all on function public.lb_merge_preview(uuid, uuid[]) from public, anon;
revoke all on function public.lb_merge_leads(uuid, uuid[]) from public, anon;
revoke all on function public.lb_restore_leads(uuid[]) from public, anon;
grant execute on function public.lb_merged_target(uuid) to authenticated;
grant execute on function public.lb_duplicate_leads(jsonb) to authenticated;
grant execute on function public.lb_merge_preview(uuid, uuid[]) to authenticated;
grant execute on function public.lb_merge_leads(uuid, uuid[]) to authenticated;
grant execute on function public.lb_restore_leads(uuid[]) to authenticated;

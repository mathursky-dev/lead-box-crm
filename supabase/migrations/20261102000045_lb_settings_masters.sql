-- Lead Settings masters (Settings page: Custom Fields, Manage Status, Tags,
-- Manage Source, Departments, Forms).
--
--   1. Colours + sequence on existing masters: lb_lead_statuses.color,
--      lb_sources.color/sort_order, lb_tags.description.
--   2. lb_custom_fields: per-company extra fields for leads; values live in
--      lb_leads.custom (jsonb, key -> value). RPC lb_set_lead_custom edits them.
--   3. lb_forms: shareable lead capture forms (public page /f/<code>).
--      lb_submit_form (service_role only) turns a submission into a lead.
--
-- Every new table is company scoped: reads only for the caller's active
-- company (lb_my_company(), which follows the Super Admin company switcher),
-- writes only through server actions (service role, filtered by company_id).
-- Safe to run more than once.

-- ------------------------------------------------------------ 1. masters
alter table public.lb_lead_statuses add column if not exists color text;
alter table public.lb_tags add column if not exists description text not null default '';

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'lb_sources' and column_name = 'sort_order') then
    alter table public.lb_sources add column sort_order integer not null default 100;
    -- first run: sequence = current A-Z order per company
    update public.lb_sources s set sort_order = r.rn
    from (select id, row_number() over (partition by company_id order by name) rn from public.lb_sources) r
    where r.id = s.id;
  end if;
end $$;
alter table public.lb_sources add column if not exists color text;

-- Default colours so the lists are not blank (only rows without one).
update public.lb_lead_statuses set color = case category
    when 'new' then '#FFFACD' when 'assigned' then '#AEC6CF' when 'contacted' then '#B0E57C'
    when 'interested' then '#CBAACB' when 'follow_up' then '#FFD1DC' when 'scheduled' then '#FFDAB9'
    when 'won' then '#B2F2BB' when 'lost' then '#E2E8F0' else '#FFB3B3' end
  where color is null;
update public.lb_sources set color = (array['#EED6C4','#FFCCCB','#D1F2EB','#E0BBE4','#DAF7A6','#D0E1FF','#FFE0BD','#F7CAC9','#F9D5A7','#F9C5D1','#D2F4F8'])
    [1 + (abs(hashtext(id::text)) % 11)]
  where color is null;

-- -------------------------------------------------------- 2. custom fields
create table if not exists public.lb_custom_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  entity text not null default 'lead' check (entity in ('lead')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  field_type text not null default 'text'
    check (field_type in ('text','textarea','number','date','dropdown','checkbox','email','phone','url')),
  options text[] not null default '{}',
  is_required boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, entity, key)
);
create index if not exists lb_custom_fields_company on public.lb_custom_fields (company_id, entity, sort_order);

alter table public.lb_leads add column if not exists custom jsonb not null default '{}'::jsonb;

-- -------------------------------------------------------------- 3. forms
create table if not exists public.lb_forms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  form_type text not null default 'lead' check (form_type in ('lead')),
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  description text not null default '',
  redirect_url text check (redirect_url is null or redirect_url ~* '^https?://'),
  thank_you text not null default 'Thank you! We will contact you shortly.',
  bg_color text not null default '#3949AB',
  font text not null default 'Nunito',
  title_size integer not null default 38 check (title_size between 16 and 72),
  label_size integer not null default 12 check (label_size between 10 and 24),
  -- [{key, label, type, required, options}] ; key = name|phone|email|location|notes|cf:<custom key>
  fields jsonb not null default '[{"key":"name","label":"Full name","type":"text","required":true},{"key":"phone","label":"Mobile number","type":"phone","required":true}]'::jsonb,
  source_id uuid references public.lb_sources(id) on delete set null,
  product_id uuid references public.lb_products(id) on delete set null,
  department_id uuid references public.lb_departments(id) on delete set null,
  tag_id uuid references public.lb_tags(id) on delete set null,
  is_active boolean not null default true,
  submissions integer not null default 0,
  last_submit_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_forms_company on public.lb_forms (company_id, created_at desc);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['lb_custom_fields','lb_forms'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.lb_my_company())', t || '_read', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- ------------------------------------------------- custom values on a lead
-- Clean one value for a field type; null = empty.
create or replace function public.lb__custom_value(f public.lb_custom_fields, v jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare s text := nullif(trim(case when jsonb_typeof(v) = 'string' then v #>> '{}' else coalesce(v::text, '') end), '');
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if f.field_type = 'checkbox' then
    return to_jsonb(coalesce(s, 'false') in ('true','on','1','yes'));
  end if;
  if s is null then return null; end if;
  s := left(s, 2000);
  if f.field_type = 'number' then
    if s !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number', f.label; end if;
    return to_jsonb(s::numeric);
  elsif f.field_type = 'date' then
    if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% must be a date', f.label; end if;
    return to_jsonb(s);
  elsif f.field_type = 'dropdown' then
    if not s = any(f.options) then raise exception '% has an invalid choice', f.label; end if;
  elsif f.field_type = 'email' and s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '% must be an email', f.label;
  end if;
  return to_jsonb(s);
end $$;

-- Merge values into lb_leads.custom. Unknown/inactive keys are rejected.
create or replace function public.lb__merge_custom(p_company uuid, p_cur jsonb, p_values jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare k text; f public.lb_custom_fields; v jsonb; out jsonb := coalesce(p_cur, '{}'::jsonb);
begin
  for k in select jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) loop
    select * into f from lb_custom_fields where company_id = p_company and entity = 'lead' and key = k and is_active;
    if f.id is null then raise exception 'Unknown field %', k; end if;
    v := lb__custom_value(f, p_values->k);
    out := case when v is null then out - k else out || jsonb_build_object(k, v) end;
  end loop;
  return out;
end $$;

create or replace function public.lb_set_lead_custom(p_lead uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lb_leads; v_new jsonb;
begin
  if not lb_can('leads.edit') then raise exception 'You do not have permission to edit leads' using errcode = '42501'; end if;
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or l.deleted_at is not null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  v_new := lb__merge_custom(l.company_id, l.custom, p_values);
  update lb_leads set custom = v_new, updated_at = now(), last_activity_at = now() where id = p_lead;
  return v_new;
end $$;
revoke all on function public.lb_set_lead_custom(uuid, jsonb) from public, anon;
grant execute on function public.lb_set_lead_custom(uuid, jsonb) to authenticated;
revoke all on function public.lb__merge_custom(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.lb__custom_value(public.lb_custom_fields, jsonb) from public, anon, authenticated;

-- --------------------------------------------------- public form submission
-- Called by the server (service role) for /f/<code>. p: {phone_e164, name,
-- email, location, notes, custom:{key:value}, answers:[{label,value}], ip}
create or replace function public.lb_submit_form(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fm lb_forms; v_phone text := p->>'phone_e164';
  v_cust lb_customers; v_existing lb_leads; v_lead lb_leads; v_status uuid; v_source uuid; v_custom jsonb;
  v_note text := 'Form "' || '' || '" submitted';
begin
  select * into fm from lb_forms where code = upper(p_code) and is_active;
  if fm.id is null then raise exception 'Form not found'; end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if not lb_company_entitled(fm.company_id) then raise exception 'This form is not accepting responses'; end if;

  v_note := 'Form "' || fm.name || '" submitted' || coalesce(E'\n' || (
    select string_agg((a->>'label') || ': ' || coalesce(a->>'value', ''), E'\n')
    from jsonb_array_elements(coalesce(p->'answers', '[]'::jsonb)) a), '');
  v_custom := lb__merge_custom(fm.company_id, '{}'::jsonb, coalesce(p->'custom', '{}'::jsonb));

  insert into lb_customers (company_id, phone_e164, name, email, location)
  values (fm.company_id, v_phone, nullif(p->>'name',''), nullif(p->>'email',''), nullif(p->>'location',''))
  on conflict (company_id, phone_e164) do update set
    name = coalesce(lb_customers.name, excluded.name),
    email = coalesce(lb_customers.email, excluded.email),
    location = coalesce(lb_customers.location, excluded.location),
    updated_at = now();
  select * into v_cust from lb_customers where company_id = fm.company_id and phone_e164 = v_phone for update;

  update lb_forms set submissions = submissions + 1, last_submit_at = now() where id = fm.id;

  -- Same person, lead still open: log on that lead instead of a duplicate.
  select * into v_existing from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_existing.id is not null and not lb__closed(v_existing.status_category) then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (fm.company_id, v_existing.id, v_existing.owner_id, 'note',
      jsonb_build_object('via','form','form_id', fm.id, 'text', v_note));
    update lb_leads set last_activity_at = now(),
      custom = custom || v_custom where id = v_existing.id;
    if fm.tag_id is not null then insert into lb_lead_tags values (v_existing.id, fm.tag_id) on conflict do nothing; end if;
    return jsonb_build_object('status','duplicate','lead_id', v_existing.id);
  end if;

  v_source := fm.source_id;
  if v_source is null then
    insert into lb_sources (company_id, name) values (fm.company_id, 'Website Form') on conflict (company_id, name) do nothing;
    select id into v_source from lb_sources where company_id = fm.company_id and name = 'Website Form';
  end if;
  v_status := lb__default_status(fm.company_id, 'new');
  insert into lb_leads (company_id, customer_id, source_id, product_id, department_id, status_id, status_category,
    priority, notes, custom, is_repeat, parent_lead_id)
  values (fm.company_id, v_cust.id, v_source, fm.product_id, fm.department_id, v_status, 'new', 'normal',
    nullif(p->>'notes',''), v_custom, v_existing.id is not null, v_existing.id)
  returning * into v_lead;

  insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
  values (fm.company_id, v_lead.id, case when v_existing.id is not null then 'repeat_created' else 'created' end,
    v_status, 'new', jsonb_build_object('via','form','form_id', fm.id, 'form', fm.name, 'text', v_note));
  if fm.tag_id is not null then insert into lb_lead_tags values (v_lead.id, fm.tag_id) on conflict do nothing; end if;
  perform lb__auto_allocate(v_lead.id, null);
  return jsonb_build_object('status','created','lead_id', v_lead.id);
end $$;
revoke all on function public.lb_submit_form(text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_submit_form(text, jsonb) to service_role;

-- Lead counts per status / source / department / tag for the Settings lists
-- (runs as the caller, so RLS keeps it to the active company).
create or replace function public.lb_master_lead_counts()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'status', coalesce((select jsonb_object_agg(status_id, n) from (select status_id, count(*) n from lb_leads where company_id = lb_my_company() and deleted_at is null group by 1) x), '{}'),
    'source', coalesce((select jsonb_object_agg(source_id, n) from (select source_id, count(*) n from lb_leads where company_id = lb_my_company() and deleted_at is null and source_id is not null group by 1) x), '{}'),
    'department', coalesce((select jsonb_object_agg(department_id, n) from (select department_id, count(*) n from lb_leads where company_id = lb_my_company() and deleted_at is null and department_id is not null group by 1) x), '{}'),
    'tag', coalesce((select jsonb_object_agg(t.tag_id, n) from (select lt.tag_id, count(*) n from lb_lead_tags lt join lb_leads l on l.id = lt.lead_id where l.company_id = lb_my_company() and l.deleted_at is null group by 1) t), '{}'));
$$;
revoke all on function public.lb_master_lead_counts() from public, anon;
grant execute on function public.lb_master_lead_counts() to authenticated;

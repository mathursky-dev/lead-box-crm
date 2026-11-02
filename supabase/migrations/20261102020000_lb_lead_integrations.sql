-- Lead source integrations, website chat widget, API keys and outgoing webhooks.
--
--   lb_lead_connectors   one row per inbound lead source a company sets up:
--                        google (Google Ads lead form webhook), indiamart (push
--                        webhook + optional CRM-key pull), justdial (push URL),
--                        widget (website WhatsApp/chat button), webhook (generic
--                        URL for Zapier / Pabbly / any software).
--   lb_connector_seen    external lead ids already processed (no double leads
--                        when a source retries or a pull window overlaps).
--   lb_api_keys          REST API keys (/api/v1), stored as sha256 hash only.
--   lb_webhooks          outgoing webhooks (lead.created / lead.status_changed /
--                        lead.assigned) signed with HMAC-SHA256.
--   lb_webhook_deliveries queue + log of outgoing webhook calls.
--
-- All tables are service-role only (RLS on, no policies): the admin pages and
-- the public endpoints use the service role and filter by company_id.
-- Leads are created by lb_ingest_external_lead / lb_api_ingest_lead
-- (service_role only), which follow the same rules as forms and Facebook:
-- same number with an open lead = note on that lead, not a duplicate.
-- Safe to run more than once.

-- ------------------------------------------------------------- tables
create table if not exists public.lb_lead_connectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  kind text not null check (kind in ('google','indiamart','justdial','widget','webhook')),
  name text not null check (length(trim(name)) between 1 and 120),
  token text not null unique check (token ~ '^[a-f0-9]{32,64}$'),
  secret_enc text,               -- google: webhook key; indiamart: CRM pull key (AES-GCM, app side)
  source_id uuid references public.lb_sources(id) on delete set null,
  product_id uuid references public.lb_products(id) on delete set null,
  department_id uuid references public.lb_departments(id) on delete set null,
  tag_id uuid references public.lb_tags(id) on delete set null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  leads_count integer not null default 0,
  duplicate_count integer not null default 0,
  last_lead_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_lead_connectors_company on public.lb_lead_connectors (company_id, kind);

create table if not exists public.lb_connector_seen (
  connector_id uuid not null references public.lb_lead_connectors(id) on delete cascade,
  ext_id text not null check (length(ext_id) between 1 and 200),
  lead_id uuid,
  created_at timestamptz not null default now(),
  primary key (connector_id, ext_id)
);

create table if not exists public.lb_api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default array['leads.read','leads.write'],
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists lb_api_keys_company on public.lb_api_keys (company_id, created_at desc);

create table if not exists public.lb_webhooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  name text not null default 'Webhook' check (length(trim(name)) between 1 and 80),
  url text not null check (url ~* '^https://[^\s]+$' and length(url) <= 1000),
  events text[] not null default array['lead.created'],
  secret_enc text not null,
  is_active boolean not null default true,
  failures integer not null default 0,
  last_status integer,
  last_error text,
  last_sent_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_webhooks_company on public.lb_webhooks (company_id) where is_active;

create table if not exists public.lb_webhook_deliveries (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  webhook_id uuid not null references public.lb_webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  response_code integer,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists lb_webhook_deliveries_due on public.lb_webhook_deliveries (next_attempt_at) where status in ('queued','sending');
create index if not exists lb_webhook_deliveries_hook on public.lb_webhook_deliveries (webhook_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['lb_lead_connectors','lb_connector_seen','lb_api_keys','lb_webhooks','lb_webhook_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- --------------------------------------------- shared lead creation core
-- p: phone_e164 (required), name, email, location, notes, custom (jsonb),
--    fields (jsonb, raw payload kept on the event), text (timeline note).
create or replace function public.lb__ingest_lead(p_company uuid, p_via text, p_source uuid, p_product uuid,
  p_department uuid, p_tags uuid[], p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := p->>'phone_e164';
  v_cust lb_customers; v_existing lb_leads; v_lead lb_leads; v_status uuid; v_custom jsonb; t uuid;
  v_text text := coalesce(nullif(p->>'text',''), 'Lead received via ' || p_via);
begin
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if not lb_company_entitled(p_company) then raise exception 'Company plan is not active'; end if;
  v_custom := case when p ? 'custom' then lb__merge_custom(p_company, '{}'::jsonb, p->'custom') else '{}'::jsonb end;

  insert into lb_customers (company_id, phone_e164, name, email, location)
  values (p_company, v_phone, nullif(left(p->>'name', 200),''), nullif(left(p->>'email', 200),''), nullif(left(p->>'location', 200),''))
  on conflict (company_id, phone_e164) do update set
    name = coalesce(lb_customers.name, excluded.name),
    email = coalesce(lb_customers.email, excluded.email),
    location = coalesce(lb_customers.location, excluded.location),
    updated_at = now();
  select * into v_cust from lb_customers where company_id = p_company and phone_e164 = v_phone for update;

  -- Same person with a lead still open: log it there instead of a duplicate.
  select * into v_existing from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_existing.id is not null and not lb__closed(v_existing.status_category) then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (p_company, v_existing.id, v_existing.owner_id, 'note',
      jsonb_build_object('via', p_via, 'text', v_text, 'fields', p->'fields'));
    update lb_leads set last_activity_at = now(), custom = custom || v_custom where id = v_existing.id;
    foreach t in array coalesce(p_tags, '{}') loop insert into lb_lead_tags values (v_existing.id, t) on conflict do nothing; end loop;
    return jsonb_build_object('status','duplicate','lead_id', v_existing.id, 'lead_no', v_existing.lead_no);
  end if;

  v_status := lb__default_status(p_company, 'new');
  insert into lb_leads (company_id, customer_id, source_id, product_id, department_id, status_id, status_category,
    priority, notes, custom, is_repeat, parent_lead_id)
  values (p_company, v_cust.id, p_source, p_product, p_department, v_status, 'new', 'normal',
    nullif(left(p->>'notes', 5000),''), v_custom, v_existing.id is not null, v_existing.id)
  returning * into v_lead;

  insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
  values (p_company, v_lead.id, case when v_existing.id is not null then 'repeat_created' else 'created' end,
    v_status, 'new', jsonb_build_object('via', p_via, 'text', v_text, 'fields', p->'fields'));
  foreach t in array coalesce(p_tags, '{}') loop insert into lb_lead_tags values (v_lead.id, t) on conflict do nothing; end loop;
  perform lb__auto_allocate(v_lead.id, null);
  return jsonb_build_object('status','created','lead_id', v_lead.id, 'lead_no', v_lead.lead_no);
end $$;
revoke all on function public.lb__ingest_lead(uuid, text, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;

create or replace function public.lb__source_named(p_company uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from lb_sources where company_id = p_company and lower(name) = lower(trim(p_name)) limit 1;
  if v is null then
    insert into lb_sources (company_id, name) values (p_company, left(trim(p_name), 60)) on conflict (company_id, name) do nothing;
    select id into v from lb_sources where company_id = p_company and name = left(trim(p_name), 60);
  end if;
  return v;
end $$;
revoke all on function public.lb__source_named(uuid, text) from public, anon, authenticated;

-- Inbound lead from a connector. p also takes ext_id (source's own lead id).
create or replace function public.lb_ingest_external_lead(p_connector uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lb_lead_connectors; v_source uuid; r jsonb; v_ext text := nullif(left(p->>'ext_id', 200), '');
begin
  select * into c from lb_lead_connectors where id = p_connector for update;
  if c.id is null or not c.is_active then raise exception 'Connector not found or paused'; end if;
  if v_ext is not null then
    insert into lb_connector_seen (connector_id, ext_id) values (c.id, v_ext) on conflict do nothing;
    if not found then return jsonb_build_object('status','already_received'); end if;
  end if;
  v_source := coalesce(c.source_id, lb__source_named(c.company_id, case c.kind
    when 'google' then 'Google Ads' when 'indiamart' then 'IndiaMART' when 'justdial' then 'JustDial'
    when 'widget' then 'Website Chat' else 'Webhook' end));
  r := lb__ingest_lead(c.company_id, c.kind, v_source, c.product_id, c.department_id,
    case when c.tag_id is null then '{}'::uuid[] else array[c.tag_id] end, p);
  update lb_lead_connectors set
    leads_count = leads_count + case when r->>'status' = 'created' then 1 else 0 end,
    duplicate_count = duplicate_count + case when r->>'status' = 'duplicate' then 1 else 0 end,
    last_lead_at = now(), last_error = null, updated_at = now()
  where id = c.id;
  if v_ext is not null then update lb_connector_seen set lead_id = (r->>'lead_id')::uuid where connector_id = c.id and ext_id = v_ext; end if;
  return r;
end $$;
revoke all on function public.lb_ingest_external_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_ingest_external_lead(uuid, jsonb) to service_role;

-- REST API create. p: phone_e164, name, email, location, notes, custom,
-- source (name), product (name), tags (array of names), ext_id ignored.
create or replace function public.lb_api_ingest_lead(p_key uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lb_api_keys; v_source uuid; v_product uuid; v_tags uuid[];
begin
  select * into k from lb_api_keys where id = p_key and revoked_at is null;
  if k.id is null then raise exception 'API key revoked'; end if;
  if not ('leads.write' = any(k.scopes)) then raise exception 'API key has no leads.write scope'; end if;
  v_source := lb__source_named(k.company_id, coalesce(nullif(trim(p->>'source'),''), 'API'));
  if nullif(trim(p->>'product'),'') is not null then
    select id into v_product from lb_products where company_id = k.company_id and lower(name) = lower(trim(p->>'product')) limit 1;
  end if;
  if jsonb_typeof(p->'tags') = 'array' then
    select array_agg(t.id) into v_tags from lb_tags t
    where t.company_id = k.company_id and lower(t.name) in (select lower(trim(x)) from jsonb_array_elements_text(p->'tags') x);
  end if;
  return lb__ingest_lead(k.company_id, 'api', v_source, v_product, null, coalesce(v_tags, '{}'),
    p || jsonb_build_object('text', 'Lead created via API (' || k.name || ')'));
end $$;
revoke all on function public.lb_api_ingest_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_api_ingest_lead(uuid, jsonb) to service_role;

-- -------------------------------------------------- outgoing webhooks
create or replace function public.lb__lead_payload(p_lead uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'lead_no', l.lead_no, 'name', c.name, 'phone', c.phone_e164, 'email', c.email, 'location', c.location,
    'source', s.name, 'product', pr.name, 'status', st.name, 'status_category', l.status_category,
    'owner', o.full_name, 'owner_email', o.email, 'priority', l.priority, 'expected_value', l.expected_value,
    'notes', l.notes, 'custom', l.custom, 'created_at', l.created_at, 'updated_at', l.updated_at)
  from lb_leads l join lb_customers c on c.id = l.customer_id
  left join lb_sources s on s.id = l.source_id left join lb_products pr on pr.id = l.product_id
  left join lb_lead_statuses st on st.id = l.status_id left join lb_profiles o on o.id = l.owner_id
  where l.id = p_lead
$$;
revoke all on function public.lb__lead_payload(uuid) from public, anon, authenticated;
grant execute on function public.lb__lead_payload(uuid) to service_role;

create or replace function public.lb__webhook_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_event text; v_payload jsonb;
begin
  if not exists (select 1 from lb_webhooks where company_id = new.company_id and is_active) then return new; end if;
  if tg_op = 'INSERT' then v_event := 'lead.created';
  elsif new.status_id is distinct from old.status_id then v_event := 'lead.status_changed';
  elsif new.owner_id is distinct from old.owner_id and new.owner_id is not null then v_event := 'lead.assigned';
  else return new; end if;
  if new.deleted_at is not null then return new; end if;
  begin
    v_payload := lb__lead_payload(new.id);
    insert into lb_webhook_deliveries (company_id, webhook_id, event, payload)
    select new.company_id, w.id, v_event, jsonb_build_object('event', v_event, 'sent_at', now(), 'lead', v_payload)
    from lb_webhooks w where w.company_id = new.company_id and w.is_active and v_event = any(w.events);
  exception when others then
    raise warning 'webhook enqueue failed: %', sqlerrm; -- never block the lead write
  end;
  return new;
end $$;
revoke all on function public.lb__webhook_enqueue() from public, anon, authenticated;

drop trigger if exists lb_leads_webhook on public.lb_leads;
create trigger lb_leads_webhook after insert or update of status_id, owner_id on public.lb_leads
  for each row execute function public.lb__webhook_enqueue();

create or replace function public.lb_claim_webhook_deliveries(p_limit integer default 20)
returns setof public.lb_webhook_deliveries language sql security definer set search_path = public as $$
  update lb_webhook_deliveries q set status = 'sending', locked_at = now(), attempts = q.attempts + 1
  where q.id in (select id from lb_webhook_deliveries
    where (status = 'queued' and next_attempt_at <= now()) or (status = 'sending' and locked_at < now() - interval '5 minutes')
    order by id limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning q.*
$$;
revoke all on function public.lb_claim_webhook_deliveries(integer) from public, anon, authenticated;
grant execute on function public.lb_claim_webhook_deliveries(integer) to service_role;

-- --------------------------------------- wake the job runner when needed
-- (queued webhook calls, or IndiaMART CRM keys due for a pull every 10 min)
do $$ declare def text := pg_get_functiondef('lb__call_jobs()'::regprocedure);
  old text := 'or exists (select 1 from lb_messages where direction = ''in'' and media_status = ''failed''';
begin
  if position('lb_webhook_deliveries' in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'patch target not found in lb__call_jobs'; end if;
  execute replace(def, old,
    'or exists (select 1 from lb_webhook_deliveries where status = ''queued'' and next_attempt_at <= now()) '
    || 'or exists (select 1 from lb_lead_connectors where kind = ''indiamart'' and is_active and secret_enc is not null '
    || 'and (last_sync_at is null or last_sync_at < now() - interval ''10 minutes'')) ' || old);
end $$;

-- Old delivery log rows are pruned after 30 days.
create or replace function public.lb__prune_webhook_log() returns void
language sql security definer set search_path = public as $$
  delete from lb_webhook_deliveries where created_at < now() - interval '30 days' and status in ('sent','failed');
$$;
revoke all on function public.lb__prune_webhook_log() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('lb-webhook-prune') where exists (select 1 from cron.job where jobname = 'lb-webhook-prune');
  perform cron.schedule('lb-webhook-prune', '15 22 * * *', 'select public.lb__prune_webhook_log()');
end $$;

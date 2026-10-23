-- Facebook Lead Ads integration (Quick Setup > Integration > Facebook Integration)
-- Secrets (tokens) are only readable by the service role: RLS on, no policies.

create table if not exists lb_fb_accounts (
  company_id uuid primary key references lb_companies(id) on delete cascade,
  fb_user_id text not null,
  fb_user_name text,
  user_token_enc text not null,
  token_expires_at timestamptz,
  only_selected boolean not null default false,   -- "Process FB Leads only for Selected Pages and Ads"
  connected_by uuid references lb_profiles(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lb_fb_pages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete cascade,
  page_id text not null,
  page_name text,
  page_token_enc text,
  subscribed boolean not null default false,
  is_selected boolean not null default true,
  last_lead_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, page_id)
);
create unique index if not exists lb_fb_pages_page_id_uq on lb_fb_pages(page_id);

create table if not exists lb_fb_ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete cascade,
  page_id text,
  ad_account_id text not null,
  ad_account_name text,
  ad_id text not null,
  ad_name text,
  created_at timestamptz not null default now(),
  unique (company_id, ad_id)
);

create table if not exists lb_fb_lead_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references lb_companies(id) on delete cascade,
  leadgen_id text not null unique,
  page_id text, form_id text, ad_id text, adgroup_id text,
  payload jsonb,
  lead_id uuid references lb_leads(id) on delete set null,
  status text not null default 'received',  -- received | created | duplicate | skipped | error
  error text,
  created_at timestamptz not null default now()
);
create index if not exists lb_fb_lead_events_company_idx on lb_fb_lead_events(company_id, created_at desc);

alter table lb_fb_accounts enable row level security;
alter table lb_fb_pages enable row level security;
alter table lb_fb_ads enable row level security;
alter table lb_fb_lead_events enable row level security;

-- "Facebook" lead source for every company (and future ones via app code)
insert into lb_sources (company_id, name, is_system, is_active)
select c.id, 'Facebook', true, true from lb_companies c
where not exists (select 1 from lb_sources s where s.company_id = c.id and s.name = 'Facebook');

-- Webhook ingest, called by the server with the service role only.
-- p: company_id, leadgen_id, page_id, form_id, ad_id, phone_e164, name, email, location, notes, fields (jsonb)
create or replace function lb_ingest_fb_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := (p->>'company_id')::uuid;
  v_phone text := p->>'phone_e164';
  v_cust lb_customers; v_existing lb_leads; v_lead lb_leads; v_status uuid; v_source uuid;
begin
  if v_company is null or v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('status','skipped','reason','no_valid_phone');
  end if;

  insert into lb_customers (company_id, phone_e164, name, email, location)
  values (v_company, v_phone, nullif(p->>'name',''), nullif(p->>'email',''), nullif(p->>'location',''))
  on conflict (company_id, phone_e164) do update set
    name = coalesce(lb_customers.name, excluded.name),
    email = coalesce(lb_customers.email, excluded.email),
    location = coalesce(lb_customers.location, excluded.location),
    updated_at = now();
  select * into v_cust from lb_customers where company_id = v_company and phone_e164 = v_phone for update;

  select * into v_existing from lb_leads where customer_id = v_cust.id order by created_at desc limit 1;
  if v_existing.id is not null and v_existing.status_category not in ('won','lost','closed') then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (v_company, v_existing.id, v_existing.owner_id, 'note',
      jsonb_build_object('via','facebook','leadgen_id', p->>'leadgen_id','text','Facebook lead form submitted again'));
    update lb_leads set last_activity_at = now() where id = v_existing.id;
    return jsonb_build_object('status','duplicate','lead_id', v_existing.id);
  end if;

  select id into v_source from lb_sources where company_id = v_company and name = 'Facebook';
  v_status := lb__default_status(v_company, 'new');
  insert into lb_leads (company_id, customer_id, source_id, status_id, status_category, priority, notes,
    is_repeat, parent_lead_id)
  values (v_company, v_cust.id, v_source, v_status, 'new', 'normal', nullif(p->>'notes',''),
    v_existing.id is not null, v_existing.id)
  returning * into v_lead;

  insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
  values (v_company, v_lead.id, case when v_existing.id is not null then 'repeat_created' else 'created' end,
    v_status, 'new', jsonb_build_object('via','facebook','leadgen_id', p->>'leadgen_id',
      'page_id', p->>'page_id','form_id', p->>'form_id','ad_id', p->>'ad_id','fields', p->'fields'));
  perform lb__auto_allocate(v_lead.id, null);
  return jsonb_build_object('status','created','lead_id', v_lead.id, 'customer_id', v_cust.id);
end $$;

revoke all on function lb_ingest_fb_lead(jsonb) from public, anon, authenticated;
grant execute on function lb_ingest_fb_lead(jsonb) to service_role;

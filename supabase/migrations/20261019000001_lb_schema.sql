-- LEAD BOX core schema. Additive only: every object is prefixed lb_ and
-- nothing outside that prefix is touched.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- org
create table lb_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Kolkata',
  auto_create_leads boolean not null default true,
  auto_allocate boolean not null default true,
  default_country text not null default 'IN',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table lb_branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  branch_id uuid references lb_branches(id) on delete set null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, branch_id, name)
);

create table lb_teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  branch_id uuid references lb_branches(id) on delete set null,
  department_id uuid references lb_departments(id) on delete set null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, department_id, name)
);

create table lb_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  company_id uuid not null references lb_companies(id) on delete restrict,
  role text not null check (role in ('super_admin','company_admin','team_leader','agent')),
  full_name text not null,
  email text not null,
  phone text,
  branch_id uuid references lb_branches(id) on delete set null,
  department_id uuid references lb_departments(id) on delete set null,
  team_id uuid references lb_teams(id) on delete set null,
  permissions text[] not null default '{}',
  is_active boolean not null default true,
  accepts_auto_allocation boolean not null default true,
  allocation_limit integer check (allocation_limit is null or allocation_limit >= 0),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on lb_profiles (company_id, role);
create index on lb_profiles (team_id);

-- Extra teams a team leader may see (own team is implicit).
create table lb_user_team_access (
  user_id uuid not null references lb_profiles(id) on delete cascade,
  team_id uuid not null references lb_teams(id) on delete cascade,
  primary key (user_id, team_id)
);

-- --------------------------------------------------------- catalogs
create table lb_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_tags (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  color text not null default '#0f766e',
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- Stable reporting categories; admin-managed status names map onto them.
create table lb_lead_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  category text not null check (category in
    ('new','assigned','contacted','interested','follow_up','scheduled','won','lost','invalid')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create unique index lb_lead_statuses_one_default on lb_lead_statuses (company_id, category) where is_default;

-- ------------------------------------------------------ WhatsApp numbers
create table lb_wa_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  label text not null,
  phone_number_id text not null unique,
  waba_id text not null,
  display_phone text,
  verified_name text,
  quality_rating text,
  branch_id uuid references lb_branches(id) on delete set null,
  department_id uuid references lb_departments(id) on delete set null,
  team_id uuid references lb_teams(id) on delete set null,
  product_id uuid references lb_products(id) on delete set null,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  last_error text,
  last_checked_at timestamptz,
  last_webhook_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Server-only secrets. RLS on with no policies + revoked grants.
create table lb_wa_number_secrets (
  number_id uuid primary key references lb_wa_numbers(id) on delete cascade,
  access_token text not null,
  app_secret text,
  updated_at timestamptz not null default now()
);

create table lb_wa_number_teams (
  number_id uuid not null references lb_wa_numbers(id) on delete cascade,
  team_id uuid not null references lb_teams(id) on delete cascade,
  primary key (number_id, team_id)
);
create table lb_wa_number_users (
  number_id uuid not null references lb_wa_numbers(id) on delete cascade,
  user_id uuid not null references lb_profiles(id) on delete cascade,
  primary key (number_id, user_id)
);

create table lb_wa_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  waba_id text not null,
  wa_template_id text,
  name text not null,
  language text not null,
  category text,
  status text not null,
  components jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  unique (company_id, waba_id, name, language)
);

-- ------------------------------------------------------ customers/leads
create table lb_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text,
  phone_e164 text not null,
  email text,
  location text,
  wa_profile_name text,
  wa_opt_in_at timestamptz,
  wa_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, phone_e164)
);
create index lb_customers_search on lb_customers using gin (to_tsvector('simple', coalesce(name,'') || ' ' || phone_e164 || ' ' || coalesce(email,'')));

create table lb_leads (
  id uuid primary key default gen_random_uuid(),
  lead_no bigint generated always as identity unique,
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete restrict,
  branch_id uuid references lb_branches(id) on delete set null,
  department_id uuid references lb_departments(id) on delete set null,
  team_id uuid references lb_teams(id) on delete set null,
  product_id uuid references lb_products(id) on delete set null,
  source_id uuid references lb_sources(id) on delete set null,
  number_id uuid references lb_wa_numbers(id) on delete set null,
  status_id uuid not null references lb_lead_statuses(id) on delete restrict,
  status_category text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  owner_id uuid references lb_profiles(id) on delete restrict,
  original_owner_id uuid references lb_profiles(id) on delete restrict,
  first_allocated_at timestamptz,
  assigned_at timestamptz,
  converted_owner_id uuid references lb_profiles(id) on delete restrict,
  converted_at timestamptz,
  closed_at timestamptz,
  expected_value numeric(14,2),
  won_value numeric(14,2),
  next_followup_at timestamptz,
  last_activity_at timestamptz not null default now(),
  lost_reason text,
  notes text,
  is_repeat boolean not null default false,
  parent_lead_id uuid references lb_leads(id) on delete set null,
  created_by uuid references lb_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on lb_leads (company_id, owner_id, status_category);
create index on lb_leads (company_id, created_at desc);
create index on lb_leads (company_id, team_id);
create index on lb_leads (customer_id, created_at desc);
create index on lb_leads (company_id, converted_at) where converted_at is not null;
create index on lb_leads (company_id, first_allocated_at) where first_allocated_at is not null;
create index on lb_leads (company_id, next_followup_at) where next_followup_at is not null;
create index lb_leads_unassigned on lb_leads (company_id, created_at) where owner_id is null;

create table lb_lead_tags (
  lead_id uuid not null references lb_leads(id) on delete cascade,
  tag_id uuid not null references lb_tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- Immutable history: status, assignment and work activity.
create table lb_lead_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  lead_id uuid not null references lb_leads(id) on delete restrict,
  actor_id uuid references lb_profiles(id) on delete restrict,
  owner_id uuid references lb_profiles(id) on delete restrict,  -- owner at event time
  type text not null check (type in ('created','status_change','assignment','note','call',
    'message_out','message_in','followup_created','followup_done','field_update','import','repeat_created')),
  is_work boolean not null default false,
  from_status_id uuid references lb_lead_statuses(id),
  to_status_id uuid references lb_lead_statuses(id),
  to_category text,
  from_user_id uuid references lb_profiles(id),
  to_user_id uuid references lb_profiles(id),
  reason text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on lb_lead_events (lead_id, created_at);
create index on lb_lead_events (company_id, type, created_at);
create index on lb_lead_events (company_id, actor_id, created_at) where is_work;

create table lb_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  lead_id uuid not null references lb_leads(id) on delete cascade,
  assigned_to uuid references lb_profiles(id) on delete restrict,
  due_at timestamptz not null,
  note text,
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  reminded_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references lb_profiles(id),
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now()
);
create index on lb_followups (company_id, assigned_to, due_at) where status = 'pending';
create index on lb_followups (lead_id);

create table lb_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  lead_id uuid references lb_leads(id) on delete cascade,
  conversation_id uuid,
  author_id uuid references lb_profiles(id),
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index on lb_notes (customer_id, created_at desc);

-- ------------------------------------------------------- conversations
create table lb_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  number_id uuid not null references lb_wa_numbers(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete restrict,
  lead_id uuid references lb_leads(id) on delete set null,
  team_id uuid references lb_teams(id) on delete set null,
  assignee_id uuid references lb_profiles(id) on delete restrict,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (number_id, customer_id)
);
create index on lb_conversations (company_id, assignee_id, last_message_at desc);
create index on lb_conversations (company_id, status, last_message_at desc);
alter table lb_notes add constraint lb_notes_conversation_fk
  foreign key (conversation_id) references lb_conversations(id) on delete cascade;

create table lb_conversation_tags (
  conversation_id uuid not null references lb_conversations(id) on delete cascade,
  tag_id uuid not null references lb_tags(id) on delete cascade,
  primary key (conversation_id, tag_id)
);

create table lb_conversation_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id),
  conversation_id uuid not null references lb_conversations(id) on delete cascade,
  from_user_id uuid references lb_profiles(id),
  to_user_id uuid references lb_profiles(id),
  actor_id uuid references lb_profiles(id),
  reason text,
  created_at timestamptz not null default now()
);

create table lb_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  conversation_id uuid not null references lb_conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  type text not null,
  body text,
  media_wa_id text,
  media_path text,
  media_mime text,
  media_filename text,
  media_status text check (media_status in ('pending','stored','failed')),
  template_name text,
  template_language text,
  template_params jsonb,
  wa_message_id text unique,
  client_id uuid unique,
  status text not null check (status in ('received','queued','sending','sent','delivered','read','failed')),
  status_rank smallint not null default 0,
  error_code text,
  error_message text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  sent_by uuid references lb_profiles(id),
  wa_timestamp timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on lb_messages (conversation_id, created_at desc);
create index lb_messages_outbox on lb_messages (next_attempt_at) where status = 'queued';
create index lb_messages_search on lb_messages using gin (to_tsvector('simple', coalesce(body,'')));

-- Status callbacks keyed by wamid; lets us apply events that arrive
-- before the send response was persisted, and dedupe retries.
create table lb_message_status_events (
  wa_message_id text not null,
  status text not null,
  occurred_at timestamptz not null,
  error_code text,
  error_message text,
  received_at timestamptz not null default now(),
  primary key (wa_message_id, status)
);

create table lb_webhook_events (
  id uuid primary key default gen_random_uuid(),
  body_sha256 text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text
);
create index lb_webhook_pending on lb_webhook_events (received_at) where processed_at is null;

create table lb_quick_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  shortcut text not null,
  title text not null,
  body text not null,
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  unique (company_id, shortcut)
);

-- ------------------------------------------------------- allocation
create table lb_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  match_number_id uuid references lb_wa_numbers(id) on delete cascade,
  match_branch_id uuid references lb_branches(id) on delete cascade,
  match_department_id uuid references lb_departments(id) on delete cascade,
  match_product_id uuid references lb_products(id) on delete cascade,
  match_source_id uuid references lb_sources(id) on delete cascade,
  last_user_id uuid references lb_profiles(id),
  created_at timestamptz not null default now()
);
create table lb_allocation_rule_users (
  rule_id uuid not null references lb_allocation_rules(id) on delete cascade,
  user_id uuid not null references lb_profiles(id) on delete cascade,
  primary key (rule_id, user_id)
);

-- ------------------------------------------------------- misc
create table lb_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  user_id uuid not null references lb_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on lb_notifications (user_id, created_at desc);

create table lb_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references lb_companies(id) on delete restrict,
  actor_id uuid references lb_profiles(id),
  action text not null,
  entity text,
  entity_id text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on lb_audit_log (company_id, created_at desc);

create table lb_import_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  created_by uuid references lb_profiles(id),
  filename text,
  total_rows integer not null default 0,
  created_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table lb_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

create table lb_settings (
  key text primary key,
  value text not null
);

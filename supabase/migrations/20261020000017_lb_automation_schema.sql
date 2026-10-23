-- Automation engine extension: schema.

-- Agent availability, working hours (IST) and backup assignee.
alter table lb_profiles
  add column availability text not null default 'available' check (availability in ('available','away','offline')),
  add column working_hours jsonb,            -- {"mon":["09:30","18:30"], ...}; null = any time
  add column backup_user_id uuid references lb_profiles(id) on delete set null;
alter table lb_allocation_rules
  add column strategy text not null default 'round_robin' check (strategy in ('round_robin','least_loaded')),
  add column fallback_to_backup boolean not null default true;

-- Company automation controls and detection keywords.
alter table lb_companies
  add column automation_paused boolean not null default false,
  add column automation_paused_reason text,
  add column ai_enabled boolean not null default false,
  add column complaint_keywords text[] not null default '{complaint,refund,fraud,cheated,cheat,worst,"not happy",legal,"consumer court",scam}',
  add column buying_keywords text[] not null default '{price,cost,"how much",buy,order,payment,book,booking,interested,discount,emi,quotation,quote}',
  add column digest_hour integer not null default 9 check (digest_hour between 0 and 23);

alter table lb_customers add column automation_paused_until timestamptz;
alter table lb_suppressions add column scope text not null default 'all' check (scope in ('all','marketing'));
alter table lb_messages add column template_category text;

-- Journeys: versions, more triggers/steps, extra stop rules.
alter table lb_journeys
  add column runs_on_closed boolean not null default false,
  add column stop_on_payment boolean not null default false,
  add column stop_on_complaint boolean not null default true,
  add column current_version integer not null default 0,
  add column draft_updated_at timestamptz not null default now();
alter table lb_journeys drop constraint lb_journeys_trigger_type_check;
alter table lb_journeys add constraint lb_journeys_trigger_type_check check (trigger_type in
  ('status_entered','lead_created','segment','manual','inbound_message','buying_signal','sla_breach','payment_pending','won','days_after_won','complaint'));
alter table lb_journey_steps drop constraint lb_journey_steps_type_check;
alter table lb_journey_steps add constraint lb_journey_steps_type_check check (type in
  ('message','task','delay','branch','end','assign','set_status','tag','notify','wait_reply','ai_summary'));

create table lb_journey_versions (
  journey_id uuid not null references lb_journeys(id) on delete cascade,
  version integer not null,
  steps jsonb not null,
  settings jsonb not null,
  published_by uuid references lb_profiles(id),
  published_at timestamptz not null default now(),
  primary key (journey_id, version)
);
-- Existing journeys: publish their current steps as version 1.
insert into lb_journey_versions (journey_id, version, steps, settings)
select j.id, 1, coalesce((select jsonb_agg(jsonb_build_object('type', s.type, 'config', s.config, 'next_step', s.next_step) order by s.step_no)
  from lb_journey_steps s where s.journey_id = j.id), '[]'), to_jsonb(j) from lb_journeys j;
update lb_journeys set current_version = 1;

alter table lb_journey_enrollments
  add column version integer not null default 1,
  add column attempts integer not null default 0,
  add column last_error text,
  add column wait_reply_then integer,
  add column wait_reply_else integer;

-- Durable async jobs run by the app (AI work). Bounded retries; failed rows form the failed-job queue.
create table lb_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  kind text not null check (kind in ('ai_summary')),
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dismissed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  result jsonb,
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lb_jobs_due on lb_jobs (next_run_at) where status = 'queued';

create table lb_complaints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  conversation_id uuid references lb_conversations(id) on delete set null,
  lead_id uuid references lb_leads(id) on delete set null,
  message_id uuid references lb_messages(id) on delete set null,
  source text not null check (source in ('keyword','manual')),
  matched text,
  note text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references lb_profiles(id),
  resolved_at timestamptz
);
create index on lb_complaints (company_id, status, created_at desc);

create table lb_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  conversation_id uuid references lb_conversations(id) on delete cascade,
  lead_id uuid references lb_leads(id) on delete set null,
  message_id uuid unique references lb_messages(id) on delete cascade,
  matched text,
  created_at timestamptz not null default now()
);
create index on lb_signals (conversation_id, created_at desc);

create table lb_knowledge (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  title text not null,
  content text not null check (length(content) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  created_by uuid references lb_profiles(id),
  approved_by uuid references lb_profiles(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table lb_ai_outputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  conversation_id uuid references lb_conversations(id) on delete cascade,
  lead_id uuid references lb_leads(id) on delete set null,
  kind text not null check (kind in ('summary','suggestion')),
  content text not null,
  model text,
  knowledge_ids uuid[] not null default '{}',
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now()
);
create index on lb_ai_outputs (conversation_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['lb_journey_versions','lb_jobs','lb_complaints','lb_signals','lb_knowledge','lb_ai_outputs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
  end loop;
end $$;
create policy lb_journey_versions_read on lb_journey_versions for select to authenticated
  using (exists (select 1 from lb_journeys j where j.id = journey_id and (j.company_id = lb_my_company() or lb_is_super())));
create policy lb_jobs_read on lb_jobs for select to authenticated
  using ((company_id = lb_my_company() and (lb_can('journeys.manage') or created_by = auth.uid())) or lb_is_super());
create policy lb_complaints_read on lb_complaints for select to authenticated
  using (lb_can_see_customer(customer_id));
create policy lb_signals_read on lb_signals for select to authenticated
  using (conversation_id is null or lb_can_see_conversation_id(conversation_id));
create policy lb_knowledge_read on lb_knowledge for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_ai_outputs_read on lb_ai_outputs for select to authenticated
  using (conversation_id is not null and lb_can_see_conversation_id(conversation_id));

insert into lb_permission_catalog values
  ('ai.use',             'Use AI summaries & suggested replies', 'Automation', 160, true,  true),
  ('knowledge.manage',   'Manage approved AI knowledge',         'Automation', 170, false, false),
  ('automation.control', 'Pause automation globally',            'Automation', 180, false, false),
  ('complaints.manage',  'Raise & resolve complaints',           'Automation', 190, true,  true)
on conflict (key) do nothing;

-- Customer Nurturing & Lead Recovery: schema.

-- ------------------------------------------------ company policy settings
alter table lb_companies
  add column sla_first_response_minutes integer not null default 15 check (sla_first_response_minutes between 1 and 1440),
  add column sla_escalation_minutes integer not null default 60 check (sla_escalation_minutes between 1 and 4320),
  add column quiet_hours_start time not null default '21:00',
  add column quiet_hours_end time not null default '09:00',
  add column marketing_cap_per_week integer not null default 2 check (marketing_cap_per_week between 0 and 50),
  add column require_next_action boolean not null default true;

-- ------------------------------------------------ leads: next action, payments
alter table lb_followups add column action_type text not null default 'call'
  check (action_type in ('call','whatsapp','meeting','payment','email','other'));
alter table lb_leads
  add column payment_status text not null default 'none' check (payment_status in ('none','pending','partial','paid')),
  add column payment_due_amount numeric(14,2),
  add column payment_due_at timestamptz;

-- ------------------------------------------------ conversations: reply tracking + SLA
alter table lb_conversations
  add column last_outbound_at timestamptz,
  add column awaiting_reply_since timestamptz,
  add column sla_alerted_at timestamptz,
  add column sla_escalated_at timestamptz;
create index on lb_conversations (company_id, awaiting_reply_since) where awaiting_reply_since is not null;

-- ------------------------------------------------ consent + suppression
create table lb_consent_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  status text not null check (status in ('opt_in','opt_out')),
  source text not null check (source in ('keyword','manual','import','form','api')),
  note text,
  actor_id uuid references lb_profiles(id),
  created_at timestamptz not null default now()
);
create index on lb_consent_events (customer_id, created_at desc);

create table lb_suppressions (
  company_id uuid not null references lb_companies(id) on delete restrict,
  phone_e164 text not null,
  reason text not null,
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  primary key (company_id, phone_e164)
);

-- ------------------------------------------------ segments + offers
create table lb_segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  rules jsonb not null default '{}',
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  description text,
  code text,
  valid_from timestamptz not null,
  valid_to timestamptz not null check (valid_to > valid_from),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected')),
  requested_by uuid references lb_profiles(id),
  approved_by uuid references lb_profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------ journeys
create table lb_journeys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  trigger_type text not null check (trigger_type in ('status_entered','lead_created','segment','manual')),
  trigger_config jsonb not null default '{}',   -- {category, product_id, source_id, segment_id}
  priority integer not null default 100,       -- lower wins when journeys conflict
  number_id uuid references lb_wa_numbers(id),  -- default sender when the lead has none
  pause_on_reply boolean not null default true,
  stop_on_purchase boolean not null default true,
  stop_on_lost boolean not null default true,
  stop_on_manual_takeover boolean not null default true,
  created_by uuid references lb_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references lb_journeys(id) on delete cascade,
  step_no integer not null check (step_no >= 1),
  type text not null check (type in ('message','task','delay','branch','end')),
  config jsonb not null default '{}',
  next_step integer,                            -- null = step_no + 1
  unique (journey_id, step_no)
);

create table lb_journey_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  journey_id uuid not null references lb_journeys(id) on delete restrict,
  lead_id uuid not null references lb_leads(id) on delete cascade,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','completed','stopped','failed')),
  current_step integer not null default 1,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  status_reason text,
  enrolled_by uuid references lb_profiles(id),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);
-- One running journey per lead (prevents conflicting/duplicate journeys).
create unique index lb_enrollments_one_active on lb_journey_enrollments (lead_id) where status in ('active','paused');
create index lb_enrollments_due on lb_journey_enrollments (next_run_at) where status = 'active';

create table lb_journey_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  enrollment_id uuid not null references lb_journey_enrollments(id) on delete cascade,
  journey_id uuid not null references lb_journeys(id) on delete cascade,
  step_no integer,
  event text not null,          -- enrolled, step_done, message_queued, deferred, skipped, branch, task_created, paused, resumed, stopped, completed, failed
  detail text,
  message_id uuid references lb_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on lb_journey_events (enrollment_id, created_at);

-- ------------------------------------------------ campaigns
create table lb_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  name text not null,
  segment_id uuid not null references lb_segments(id) on delete restrict,
  number_id uuid not null references lb_wa_numbers(id) on delete restrict,
  template_name text not null,
  template_language text not null,
  template_params jsonb not null default '[]',
  offer_id uuid references lb_offers(id) on delete restrict,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','running','completed','cancelled')),
  created_by uuid references lb_profiles(id),
  approved_by uuid references lb_profiles(id),
  approved_at timestamptz,
  launched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table lb_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  campaign_id uuid not null references lb_campaigns(id) on delete cascade,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  lead_id uuid references lb_leads(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','queued','skipped','failed')),
  reason text,
  message_id uuid references lb_messages(id) on delete set null,
  next_try_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
create index on lb_campaign_recipients (next_try_at) where status = 'pending';

-- ------------------------------------------------ message attribution
alter table lb_messages
  add column journey_id uuid references lb_journeys(id) on delete set null,
  add column enrollment_id uuid references lb_journey_enrollments(id) on delete set null,
  add column campaign_id uuid references lb_campaigns(id) on delete set null,
  add column automated boolean not null default false;
create index on lb_messages (company_id, automated, created_at) where automated;

create table lb_attributions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  customer_id uuid not null references lb_customers(id) on delete cascade,
  lead_id uuid references lb_leads(id) on delete set null,
  journey_id uuid references lb_journeys(id) on delete set null,
  campaign_id uuid references lb_campaigns(id) on delete set null,
  source_message_id uuid references lb_messages(id) on delete set null,
  event text not null check (event in ('reply','conversion')),
  amount numeric(14,2),
  created_at timestamptz not null default now()
);
create unique index lb_attr_once_conversion on lb_attributions (lead_id, event) where event = 'conversion';
create index on lb_attributions (company_id, created_at);

-- SLA alert log (dedupe + history)
create table lb_sla_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references lb_companies(id) on delete restrict,
  conversation_id uuid not null references lb_conversations(id) on delete cascade,
  level text not null check (level in ('breach','escalation')),
  awaiting_since timestamptz not null,
  notified uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (conversation_id, level, awaiting_since)
);

-- ------------------------------------------------ RLS
do $$ declare t text; begin
  foreach t in array array['lb_consent_events','lb_suppressions','lb_segments','lb_offers','lb_journeys','lb_journey_steps',
    'lb_journey_enrollments','lb_journey_events','lb_campaigns','lb_campaign_recipients','lb_attributions','lb_sla_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
  end loop;
end $$;

create policy lb_consent_read on lb_consent_events for select to authenticated using (lb_can_see_customer(customer_id));
create policy lb_suppressions_read on lb_suppressions for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_segments_read on lb_segments for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_offers_read on lb_offers for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_journeys_read on lb_journeys for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_journey_steps_read on lb_journey_steps for select to authenticated
  using (exists (select 1 from lb_journeys j where j.id = journey_id and (j.company_id = lb_my_company() or lb_is_super())));
create policy lb_enrollments_read on lb_journey_enrollments for select to authenticated using (lb_can_see_lead_id(lead_id));
create policy lb_journey_events_read on lb_journey_events for select to authenticated
  using (exists (select 1 from lb_journey_enrollments e where e.id = enrollment_id and lb_can_see_lead_id(e.lead_id)));
create policy lb_campaigns_read on lb_campaigns for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_campaign_recipients_read on lb_campaign_recipients for select to authenticated
  using (lb_can('campaigns.manage') and (company_id = lb_my_company() or lb_is_super()));
create policy lb_attributions_read on lb_attributions for select to authenticated using (company_id = lb_my_company() or lb_is_super());
create policy lb_sla_events_read on lb_sla_events for select to authenticated using (lb_can_see_conversation_id(conversation_id));

-- ------------------------------------------------ permissions
insert into lb_permission_catalog values
  ('nurture.view',      'View nurture & recovery queues', 'Nurturing', 110, true,  true),
  ('journeys.manage',   'Manage nurturing journeys',      'Nurturing', 120, false, false),
  ('campaigns.manage',  'Create campaigns & segments',    'Nurturing', 130, false, false),
  ('campaigns.approve', 'Approve campaigns & offers',     'Nurturing', 140, false, false),
  ('consent.manage',    'Record consent & suppressions',  'Nurturing', 150, true,  true)
on conflict (key) do nothing;

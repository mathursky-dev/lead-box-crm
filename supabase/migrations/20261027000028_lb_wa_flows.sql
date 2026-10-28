-- Visual WhatsApp chatbot flows (flow editor at /whatsapp/flows).
-- Safe to run more than once in the Supabase SQL editor.

-- Interactive / location / contact / link-media sends carry their WhatsApp object here.
alter table public.lb_messages add column if not exists payload jsonb;

create table if not exists public.lb_wa_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text,
  trigger_type text not null default 'keywords' check (trigger_type in ('keywords','any','new_contact','manual')),
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('exact','contains','starts')),
  number_id uuid references public.lb_wa_numbers(id) on delete set null,
  tag_names text[] not null default '{}',
  priority integer not null default 10,
  is_active boolean not null default false,
  graph jsonb not null default '{"nodes":[],"edges":[],"settings":{}}',
  version integer not null default 0,
  run_count integer not null default 0,
  created_by uuid references public.lb_profiles(id),
  updated_by uuid references public.lb_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_wa_flows_company_idx on public.lb_wa_flows(company_id, is_active, priority);

create table if not exists public.lb_wa_flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.lb_wa_flows(id) on delete cascade,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  note text,
  created_by uuid references public.lb_profiles(id),
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);

-- One running flow per chat: where it is waiting and what it has collected.
create table if not exists public.lb_wa_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  flow_id uuid not null references public.lb_wa_flows(id) on delete cascade,
  conversation_id uuid not null references public.lb_conversations(id) on delete cascade,
  node_id text,
  vars jsonb not null default '{}',
  retries integer not null default 0,
  status text not null default 'waiting' check (status in ('waiting','done','expired','stopped','handoff')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create unique index if not exists lb_wa_flow_sessions_one_live on public.lb_wa_flow_sessions(conversation_id) where status = 'waiting';
create index if not exists lb_wa_flow_sessions_flow_idx on public.lb_wa_flow_sessions(flow_id, started_at desc);

-- Per-block counters for the Stats view, plus one 'inbound' marker per handled message (webhook replays are no-ops).
create table if not exists public.lb_wa_flow_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  flow_id uuid not null references public.lb_wa_flows(id) on delete cascade,
  session_id uuid references public.lb_wa_flow_sessions(id) on delete cascade,
  node_id text,
  kind text not null check (kind in ('inbound','enter','invalid','done','handoff','error')),
  inbound_message_id uuid references public.lb_messages(id) on delete cascade,
  detail text,
  created_at timestamptz not null default now()
);
create unique index if not exists lb_wa_flow_events_inbound_once on public.lb_wa_flow_events(inbound_message_id) where kind = 'inbound';
create index if not exists lb_wa_flow_events_flow_idx on public.lb_wa_flow_events(flow_id, created_at desc);

alter table public.lb_wa_flows enable row level security;
alter table public.lb_wa_flow_versions enable row level security;
alter table public.lb_wa_flow_sessions enable row level security;
alter table public.lb_wa_flow_events enable row level security;

drop policy if exists lb_wa_flows_read on public.lb_wa_flows;
drop policy if exists lb_wa_flows_admin on public.lb_wa_flows;
drop policy if exists lb_wa_flow_versions_read on public.lb_wa_flow_versions;
drop policy if exists lb_wa_flow_versions_admin on public.lb_wa_flow_versions;
drop policy if exists lb_wa_flow_sessions_read on public.lb_wa_flow_sessions;
drop policy if exists lb_wa_flow_events_read on public.lb_wa_flow_events;
create policy lb_wa_flows_read on public.lb_wa_flows for select to authenticated using (company_id = public.lb_my_company());
create policy lb_wa_flows_admin on public.lb_wa_flows for all to authenticated using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));
create policy lb_wa_flow_versions_read on public.lb_wa_flow_versions for select to authenticated using (company_id = public.lb_my_company());
create policy lb_wa_flow_versions_admin on public.lb_wa_flow_versions for insert to authenticated with check (public.lb_is_admin_of(company_id));
create policy lb_wa_flow_sessions_read on public.lb_wa_flow_sessions for select to authenticated using (company_id = public.lb_my_company());
create policy lb_wa_flow_events_read on public.lb_wa_flow_events for select to authenticated using (company_id = public.lb_my_company());
-- Sessions and events are written by the service role (webhook) only.

-- Same trial/paid gate every other lb_ table has.
do $$ declare t text; begin
  foreach t in array array['lb_wa_flows','lb_wa_flow_versions','lb_wa_flow_sessions','lb_wa_flow_events'] loop
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

revoke all on public.lb_wa_flows, public.lb_wa_flow_versions, public.lb_wa_flow_sessions, public.lb_wa_flow_events from anon;
grant select, insert, update, delete on public.lb_wa_flows to authenticated;
grant select, insert on public.lb_wa_flow_versions to authenticated;
grant select on public.lb_wa_flow_sessions, public.lb_wa_flow_events to authenticated;
grant all on public.lb_wa_flows, public.lb_wa_flow_versions, public.lb_wa_flow_sessions, public.lb_wa_flow_events to service_role;

-- Block counters for the editor's Stats view. SECURITY INVOKER: RLS limits it to the caller's company.
create or replace function public.lb_wa_flow_stats(p_flow uuid, p_days integer default 30)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_object_agg(node_id, n) from (
      select node_id, count(*) n from lb_wa_flow_events
      where flow_id = p_flow and kind = 'enter' and created_at > now() - make_interval(days => p_days) group by node_id) x), '{}'::jsonb),
    'started', (select count(*) from lb_wa_flow_sessions where flow_id = p_flow and started_at > now() - make_interval(days => p_days)),
    'completed', (select count(*) from lb_wa_flow_sessions where flow_id = p_flow and status in ('done','handoff') and started_at > now() - make_interval(days => p_days)),
    'handoff', (select count(*) from lb_wa_flow_sessions where flow_id = p_flow and status = 'handoff' and started_at > now() - make_interval(days => p_days)),
    'waiting', (select count(*) from lb_wa_flow_sessions where flow_id = p_flow and status = 'waiting' and expires_at > now()),
    'invalid', (select count(*) from lb_wa_flow_events where flow_id = p_flow and kind = 'invalid' and created_at > now() - make_interval(days => p_days))
  )
$$;
revoke execute on function public.lb_wa_flow_stats(uuid, integer) from public, anon;
grant execute on function public.lb_wa_flow_stats(uuid, integer) to authenticated, service_role;

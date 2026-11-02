-- WhatsApp groups through Meta's official Groups API (Cloud API numbers only).
-- Meta limits: the number must be an Official Business Account (green tick), max 8 people per group,
-- people join only through the group invite link (a business cannot add them directly),
-- text + media + templates only (no buttons/lists), no Communities.
--
--   * lb_wa_groups           groups created from the CRM (or seen in webhooks), with invite link.
--   * lb_wa_group_messages   messages sent to / received in those groups.
-- Group messages never create leads or 1-to-1 chats. All writes go through the server (service role).
-- Safe to run more than once.

create table if not exists public.lb_wa_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  number_id uuid not null references public.lb_wa_numbers(id) on delete cascade,
  wa_group_id text unique,
  request_id text,
  subject text not null check (length(trim(subject)) between 1 and 128),
  description text not null default '' check (length(description) <= 2048),
  join_approval boolean not null default false,
  invite_link text,
  participants integer not null default 0,
  status text not null default 'creating' check (status in ('creating','active','failed','suspended','deleted')),
  error text,
  lead_id uuid references public.lb_leads(id) on delete set null,
  created_by uuid references public.lb_profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lb_wa_groups_company on public.lb_wa_groups (company_id, created_at desc);
create index if not exists lb_wa_groups_request on public.lb_wa_groups (request_id) where request_id is not null;

create table if not exists public.lb_wa_group_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  group_id uuid not null references public.lb_wa_groups(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  wamid text unique,
  from_wa text,
  from_name text,
  type text not null default 'text',
  body text,
  media_url text,
  status text not null default 'sent' check (status in ('queued','sent','delivered','read','failed','received')),
  error text,
  sent_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_wa_group_messages_group on public.lb_wa_group_messages (group_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['lb_wa_groups','lb_wa_group_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.lb_my_company())', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

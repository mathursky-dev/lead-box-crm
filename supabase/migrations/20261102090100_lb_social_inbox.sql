-- Instagram DM + Facebook Messenger in the Inbox, next to WhatsApp.
--
-- * Uses the Facebook account + Pages already connected for Lead Ads (lb_fb_pages keeps the
--   page token). A page gets "Messenger" and, when it has a linked Instagram professional
--   account, "Instagram" turned on from Admin -> Instagram & Messenger.
-- * One thread per (channel, page/IG account, customer id). Instagram / Messenger users have no
--   phone number, so threads are separate from WhatsApp conversations (lb_conversations needs a
--   customer phone). A thread can be linked to a lead; "Create lead" asks for the phone number.
-- * Webhook (/api/facebook/webhook) writes through lb_ingest_social (service role only).
-- * Who sees a thread: admins all; team leaders all unassigned + their team's; agents their own
--   threads and threads on leads they can see. Writes go through server actions (service role).
-- Everything is scoped to lb_my_company(). Idempotent: safe to run more than once.

alter table public.lb_fb_pages add column if not exists messenger_enabled boolean not null default false;
alter table public.lb_fb_pages add column if not exists ig_enabled boolean not null default false;
alter table public.lb_fb_pages add column if not exists ig_user_id text;
alter table public.lb_fb_pages add column if not exists ig_username text;
create index if not exists lb_fb_pages_ig on public.lb_fb_pages (ig_user_id) where ig_user_id is not null;

create table if not exists public.lb_social_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  channel text not null check (channel in ('messenger','instagram')),
  page_id text not null,              -- Facebook page that answers (its token sends replies)
  account_id text not null,           -- page id (Messenger) or Instagram account id
  psid text not null,                 -- the customer's page-scoped / Instagram-scoped id
  name text,
  username text,
  profile_pic text,
  lead_id uuid references public.lb_leads(id) on delete set null,
  assignee_id uuid references public.lb_profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, account_id, psid)
);
create index if not exists lb_social_threads_list on public.lb_social_threads (company_id, channel, last_message_at desc);
create index if not exists lb_social_threads_lead on public.lb_social_threads (lead_id) where lead_id is not null;

create table if not exists public.lb_social_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  thread_id uuid not null references public.lb_social_threads(id) on delete cascade,
  direction text not null check (direction in ('in','out','note')),
  body text,
  attachments jsonb not null default '[]',   -- [{type, url}]
  mid text unique,                           -- Meta message id
  client_id uuid unique,                     -- idempotent sends from the CRM
  status text not null default 'received' check (status in ('received','sending','sent','failed','read')),
  error_message text,
  sent_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_social_messages_thread on public.lb_social_messages (thread_id, created_at desc);

create or replace function public.lb_can_see_social(p_company uuid, p_assignee uuid, p_lead uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if p_company is distinct from lb_my_company() then return false; end if;
  select id, role into r from lb_profiles where id = auth.uid() and is_active;
  if r.id is null then return false; end if;
  if lb_is_admin_of(p_company) or p_assignee = r.id then return true; end if;
  if r.role = 'team_leader' and (p_assignee is null or p_assignee = any(lb_visible_user_ids())) then return true; end if;
  return p_lead is not null and lb_can_see_lead_id(p_lead);
end $$;

alter table public.lb_social_threads enable row level security;
alter table public.lb_social_messages enable row level security;
revoke all on public.lb_social_threads, public.lb_social_messages from anon;
revoke insert, update, delete on public.lb_social_threads, public.lb_social_messages from authenticated;
grant select on public.lb_social_threads, public.lb_social_messages to authenticated;
drop policy if exists lb_social_threads_read on public.lb_social_threads;
create policy lb_social_threads_read on public.lb_social_threads for select to authenticated
  using (public.lb_can_see_social(company_id, assignee_id, lead_id));
drop policy if exists lb_social_messages_read on public.lb_social_messages;
create policy lb_social_messages_read on public.lb_social_messages for select to authenticated
  using (exists (select 1 from public.lb_social_threads t where t.id = thread_id and public.lb_can_see_social(t.company_id, t.assignee_id, t.lead_id)));
drop policy if exists lb_paid on public.lb_social_threads;
create policy lb_paid on public.lb_social_threads as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));
drop policy if exists lb_paid on public.lb_social_messages;
create policy lb_paid on public.lb_social_messages as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Realtime hints for the inbox (the page refetches on every event).
do $$ begin
  alter publication supabase_realtime add table public.lb_social_threads, public.lb_social_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- One inbound or echoed message from the webhook. Service role only.
-- p: {channel, page_id, account_id, psid, mid, body, attachments, at, echo}
-- Returns {thread_id, message_id (null when duplicate), new_thread, company_id}.
create or replace function public.lb_ingest_social(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pg lb_fb_pages; t lb_social_threads; v_new boolean := false; v_id uuid; v_echo boolean := coalesce((p->>'echo')::boolean, false);
  v_at timestamptz := coalesce((p->>'at')::timestamptz, now()); v_preview text;
begin
  if p->>'channel' not in ('messenger','instagram') or coalesce(p->>'psid','') = '' or coalesce(p->>'page_id','') = '' then
    raise exception 'Invalid social message';
  end if;
  select * into pg from lb_fb_pages where page_id = p->>'page_id'
    and ((p->>'channel' = 'messenger' and messenger_enabled) or (p->>'channel' = 'instagram' and ig_enabled)) limit 1;
  if pg.id is null then return jsonb_build_object('skipped', 'page not enabled'); end if;
  if p->>'mid' is not null and exists (select 1 from lb_social_messages where mid = p->>'mid') then
    return jsonb_build_object('skipped', 'duplicate');
  end if;

  select * into t from lb_social_threads where channel = p->>'channel' and account_id = p->>'account_id' and psid = p->>'psid' for update;
  if t.id is null then
    insert into lb_social_threads (company_id, channel, page_id, account_id, psid)
    values (pg.company_id, p->>'channel', pg.page_id, p->>'account_id', p->>'psid')
    on conflict (channel, account_id, psid) do nothing returning * into t;
    if t.id is null then
      select * into t from lb_social_threads where channel = p->>'channel' and account_id = p->>'account_id' and psid = p->>'psid' for update;
    else v_new := true; end if;
  end if;

  v_preview := left(coalesce(nullif(p->>'body', ''), case when jsonb_array_length(coalesce(p->'attachments', '[]')) > 0
    then '[' || coalesce(p->'attachments'->0->>'type', 'attachment') || ']' else '' end), 140);
  insert into lb_social_messages (company_id, thread_id, direction, body, attachments, mid, status, created_at)
  values (t.company_id, t.id, case when v_echo then 'out' else 'in' end, left(p->>'body', 4000), coalesce(p->'attachments', '[]'),
    p->>'mid', case when v_echo then 'sent' else 'received' end, v_at)
  on conflict (mid) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('skipped', 'duplicate'); end if;

  update lb_social_threads set
    last_message_at = greatest(coalesce(last_message_at, v_at), v_at), last_message_preview = v_preview,
    last_inbound_at = case when v_echo then last_inbound_at else greatest(coalesce(last_inbound_at, v_at), v_at) end,
    unread_count = case when v_echo then unread_count else unread_count + 1 end,
    status = case when v_echo or status = 'open' then status else 'open' end,
    updated_at = now()
  where id = t.id;

  -- Lead history on the linked lead.
  if t.lead_id is not null and not v_echo then
    insert into lb_lead_events (company_id, lead_id, type, owner_id, data)
    select t.company_id, l.id, 'message_in', l.owner_id, jsonb_build_object('body', v_preview, 'channel', t.channel, 'thread_id', t.id)
    from lb_leads l where l.id = t.lead_id;
    update lb_leads set last_activity_at = now() where id = t.lead_id;
  end if;
  -- Ping the assignee (or the company admins for a new chat).
  if not v_echo then
    begin
      if t.assignee_id is not null then
        perform lb__notify(t.company_id, t.assignee_id, 'message', initcap(t.channel) || ' message', v_preview, '/inbox?ch=' || t.channel || '&t=' || t.id, 'soc:' || v_id);
      elsif v_new then
        perform lb__notify(t.company_id, a.id, 'message', 'New ' || initcap(t.channel) || ' chat', v_preview, '/inbox?ch=' || t.channel || '&t=' || t.id, 'socnew:' || t.id || ':' || a.id)
        from lb_profiles a where a.company_id = t.company_id and a.is_active and a.role = 'company_admin';
      end if;
    exception when others then null; -- a notification never blocks the message
    end;
  end if;
  return jsonb_build_object('thread_id', t.id, 'message_id', v_id, 'new_thread', v_new, 'company_id', t.company_id);
end $$;
revoke all on function public.lb_ingest_social(jsonb) from public, anon, authenticated;
grant execute on function public.lb_ingest_social(jsonb) to service_role;

-- Lead from a chat: the agent types the customer's phone number (Instagram/Messenger don't share it).
-- Service role only (the server action checks the user first). Returns the lb__care_lead result.
create or replace function public.lb_social_lead(p_thread uuid, p_phone text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t lb_social_threads; r jsonb; v_owner uuid;
begin
  select * into t from lb_social_threads where id = p_thread for update;
  if t.id is null then raise exception 'Chat not found'; end if;
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  r := lb__care_lead(t.company_id, p_phone, coalesce(nullif(trim(p_name), ''), t.name), 'From ' || initcap(t.channel) || ' chat' ||
         coalesce(' @' || t.username, ''), initcap(t.channel), null, t.channel);
  select owner_id into v_owner from lb_leads where id = (r->>'lead_id')::uuid;
  update lb_social_threads set lead_id = (r->>'lead_id')::uuid, assignee_id = coalesce(assignee_id, v_owner), updated_at = now() where id = t.id;
  return r;
end $$;
revoke all on function public.lb_social_lead(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lb_social_lead(uuid, text, text) to service_role;

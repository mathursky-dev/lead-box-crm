-- WhatsApp Business Dashboard: team preferences, keyword chatbots, bot event log, report RPC.
-- Additive only.

create table if not exists public.lb_wa_prefs (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  pause_bots_when_assigned boolean not null default true,
  optout_enabled boolean not null default true,
  optout_keywords text not null default 'stop, stop all, stop promo, stop promotion, stop messages, unsubscribe',
  optin_keywords text not null default 'start, subscribe, unstop, resume, opt in, optin',
  optout_reply text default 'You''ve been unsubscribed and won''t receive any more promotional messages from us. Reply START if you ever want them back.',
  optin_reply text default 'You''re subscribed again — welcome back. Reply STOP at any time to unsubscribe.',
  hours_enabled boolean not null default false,
  hours_from time not null default '09:00',
  hours_to time not null default '18:00',
  hours_days smallint[] not null default '{1,2,3,4,5,6}',
  timezone text not null default 'Asia/Kolkata',
  away_message text,
  updated_by uuid references public.lb_profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.lb_wa_bots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  name text not null,
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('exact','contains','starts')),
  reply text not null,
  hours_rule text not null default 'always' check (hours_rule in ('always','inside','outside')),
  number_id uuid references public.lb_wa_numbers(id) on delete cascade,
  priority integer not null default 100,
  is_active boolean not null default true,
  reply_count integer not null default 0,
  created_by uuid references public.lb_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_wa_bots_company_idx on public.lb_wa_bots(company_id, priority);

create table if not exists public.lb_wa_bot_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  conversation_id uuid references public.lb_conversations(id) on delete cascade,
  inbound_message_id uuid references public.lb_messages(id) on delete cascade,
  bot_id uuid references public.lb_wa_bots(id) on delete set null,
  kind text not null check (kind in ('reply','unmatched','optout','optin','away','skipped')),
  body text,
  detail text,
  created_at timestamptz not null default now(),
  unique (inbound_message_id, kind)
);
create index if not exists lb_wa_bot_events_company_idx on public.lb_wa_bot_events(company_id, created_at desc);

alter table public.lb_wa_prefs enable row level security;
alter table public.lb_wa_bots enable row level security;
alter table public.lb_wa_bot_events enable row level security;

create policy lb_wa_prefs_read on public.lb_wa_prefs for select using (company_id = public.lb_my_company());
create policy lb_wa_prefs_admin on public.lb_wa_prefs for all using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));
create policy lb_wa_bots_read on public.lb_wa_bots for select using (company_id = public.lb_my_company());
create policy lb_wa_bots_admin on public.lb_wa_bots for all using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));
create policy lb_wa_bot_events_read on public.lb_wa_bot_events for select using (company_id = public.lb_my_company());
-- bot events are written by the service role only.

grant select, insert, update, delete on public.lb_wa_prefs, public.lb_wa_bots to authenticated;
grant select on public.lb_wa_bot_events to authenticated;

-- Message analytics for the dashboard. SECURITY INVOKER: respects the caller's RLS visibility.
create or replace function public.lb_wa_report(p_from timestamptz, p_to timestamptz, p_tz text default 'Asia/Kolkata')
returns jsonb language sql stable set search_path = public as $$
  with m as (
    select m.id, m.direction, m.status, m.type, m.template_name, m.error_code, m.error_message, m.automated, m.sent_by,
           m.conversation_id, m.created_at, m.template_category, v.number_id
    from lb_messages m join lb_conversations v on v.id = m.conversation_id
    where m.created_at >= p_from and m.created_at < p_to
  ), d as (
    select generate_series(date_trunc('day', p_from at time zone p_tz), date_trunc('day', (p_to - interval '1 second') at time zone p_tz), interval '1 day')::date as day
  )
  select jsonb_build_object(
    'sent', (select count(*) from m where direction = 'out'),
    'received', (select count(*) from m where direction = 'in'),
    'delivered', (select count(*) from m where direction = 'out' and status in ('delivered','read')),
    'read', (select count(*) from m where direction = 'out' and status = 'read'),
    'failed', (select count(*) from m where direction = 'out' and status = 'failed'),
    'queued', (select count(*) from m where direction = 'out' and status in ('queued','sending')),
    'automated', (select count(*) from m where direction = 'out' and automated),
    'chats', (select count(distinct conversation_id) from m),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day,
        'sent', (select count(*) from m where direction='out' and (created_at at time zone p_tz)::date = d.day),
        'received', (select count(*) from m where direction='in' and (created_at at time zone p_tz)::date = d.day),
        'failed', (select count(*) from m where direction='out' and status='failed' and (created_at at time zone p_tz)::date = d.day)
      ) order by d.day), '[]') from d),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h,
        'in', (select count(*) from m where direction='in' and extract(hour from created_at at time zone p_tz) = h),
        'out', (select count(*) from m where direction='out' and extract(hour from created_at at time zone p_tz) = h)) order by h), '[]')
      from generate_series(0,23) h),
    'by_number', (select coalesce(jsonb_agg(x), '[]') from (
        select n.label, n.display_phone, count(*) filter (where m.direction='out') sent, count(*) filter (where m.direction='in') received,
               count(*) filter (where m.direction='out' and m.status='failed') failed
        from m join lb_wa_numbers n on n.id = m.number_id group by n.label, n.display_phone order by count(*) desc) x),
    'templates', (select coalesce(jsonb_agg(x), '[]') from (
        select template_name as name, count(*) sent, count(*) filter (where status='read') read, count(*) filter (where status='failed') failed
        from m where direction='out' and template_name is not null group by template_name order by count(*) desc limit 10) x),
    'errors', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(error_code,'?') code, left(coalesce(error_message,'Unknown error'),160) message, count(*) n
        from m where direction='out' and status='failed' group by 1,2 order by count(*) desc limit 8) x),
    'categories', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(lower(template_category), case when type='template' then 'template' else 'service' end) category, count(*) n
        from m where direction='out' and status <> 'failed' group by 1 order by count(*) desc) x),
    'agents', (select coalesce(jsonb_agg(x), '[]') from (
        select p.full_name as name, count(*) replies, count(distinct m.conversation_id) chats
        from m join lb_profiles p on p.id = m.sent_by where m.direction='out' group by p.full_name order by count(*) desc limit 10) x),
    'bots', (select jsonb_build_object(
        'replies', count(*) filter (where kind='reply'), 'unmatched', count(*) filter (where kind='unmatched'),
        'optouts', count(*) filter (where kind='optout'), 'away', count(*) filter (where kind='away'))
      from lb_wa_bot_events e where e.created_at >= p_from and e.created_at < p_to and e.company_id = lb_my_company()),
    'automated_templates', (select count(*) from m where direction='out' and automated and template_name is not null)
  )
$$;
grant execute on function public.lb_wa_report(timestamptz, timestamptz, text) to authenticated;

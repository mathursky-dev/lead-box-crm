-- AI FAQ bot (WhatsApp, 24x7) + voice notes to text.
--
-- 1. AI FAQ bot
--    * lb_ai_bot_settings: one row per company (on/off, bot name, when it runs,
--      handover message, limits, extra instructions, who gets handed-over chats).
--    * lb_ai_faqs: the company's own FAQs (kind 'faq') and price list (kind 'price').
--      The bot answers ONLY from these (+ optionally approved Knowledge articles
--      and Store products). Admins manage them; everyone in the company can read.
--    * lb_conversations.ai_handover_at / ai_handover_reason: when the bot handed a
--      chat to a human. The bot stays quiet in that chat for handover_pause_hours.
--    * lb_wa_bot_events.kind gets 'ai_reply' and 'ai_handover' (logs + reports).
--    Runs on the server (service role) after flows and keyword bots found no match,
--    so existing chatbot flows and keyword bots keep working exactly as before.
-- 2. Voice notes to text
--    * lb_messages.transcript / transcript_status / transcript_lang / transcribed_at.
--    * lb_companies.voice_transcribe (default on): auto-transcribe inbound voice notes.
-- Idempotent: safe to run more than once.

-- ── 1. AI FAQ bot ─────────────────────────────────────────────────────────
create table if not exists public.lb_ai_bot_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  enabled boolean not null default false,
  bot_name text not null default 'Assistant' check (length(bot_name) between 1 and 60),
  hours_rule text not null default 'always' check (hours_rule in ('always','outside','inside')),
  number_id uuid references public.lb_wa_numbers(id) on delete set null,
  use_knowledge boolean not null default true,
  use_products boolean not null default true,
  handover_message text not null default 'Thank you! Our team member will reply to you here shortly. 🙏' check (length(handover_message) between 1 and 1000),
  handover_assign_to uuid references public.lb_profiles(id) on delete set null,
  handover_pause_hours int not null default 12 check (handover_pause_hours between 1 and 168),
  max_replies_per_chat int not null default 15 check (max_replies_per_chat between 1 and 100),
  daily_limit int not null default 500 check (daily_limit between 1 and 5000),
  instructions text check (length(instructions) <= 2000),
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.lb_ai_faqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  kind text not null default 'faq' check (kind in ('faq','price')),
  question text not null check (length(question) between 1 and 500),   -- faq: question · price: item name
  answer text not null default '' check (length(answer) <= 4000),       -- faq: answer · price: details / note
  price numeric(12,2) check (price is null or price >= 0),
  unit text check (length(unit) <= 40),
  category text check (length(category) <= 60),
  is_active boolean not null default true,
  sort int not null default 100,
  hit_count int not null default 0,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_ai_faqs_company on public.lb_ai_faqs (company_id, kind, sort);

alter table public.lb_conversations add column if not exists ai_handover_at timestamptz;
alter table public.lb_conversations add column if not exists ai_handover_reason text;

-- Bot log kinds: keep every existing kind, add the two AI ones.
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.lb_wa_bot_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop execute format('alter table public.lb_wa_bot_events drop constraint %I', c); end loop;
end $$;
alter table public.lb_wa_bot_events add constraint lb_wa_bot_events_kind_check
  check (kind in ('reply','unmatched','optout','optin','away','skipped','ai_reply','ai_handover'));

-- Count FAQ hits (server only).
create or replace function public.lb_ai_faq_hits(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update lb_ai_faqs set hit_count = hit_count + 1 where id = any(coalesce(p_ids, '{}'));
$$;
revoke all on function public.lb_ai_faq_hits(uuid[]) from public, anon, authenticated;

alter table public.lb_ai_bot_settings enable row level security;
alter table public.lb_ai_faqs enable row level security;
revoke all on public.lb_ai_bot_settings, public.lb_ai_faqs from anon;
grant select, insert, update, delete on public.lb_ai_bot_settings, public.lb_ai_faqs to authenticated;

drop policy if exists lb_ai_bot_settings_read on public.lb_ai_bot_settings;
create policy lb_ai_bot_settings_read on public.lb_ai_bot_settings for select to authenticated using (company_id = public.lb_my_company());
drop policy if exists lb_ai_bot_settings_admin on public.lb_ai_bot_settings;
create policy lb_ai_bot_settings_admin on public.lb_ai_bot_settings for all to authenticated
  using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));

drop policy if exists lb_ai_faqs_read on public.lb_ai_faqs;
create policy lb_ai_faqs_read on public.lb_ai_faqs for select to authenticated using (company_id = public.lb_my_company());
drop policy if exists lb_ai_faqs_admin on public.lb_ai_faqs;
create policy lb_ai_faqs_admin on public.lb_ai_faqs for all to authenticated
  using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));

do $$ declare t text; begin
  foreach t in array array['lb_ai_bot_settings','lb_ai_faqs'] loop
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- ── 2. Voice notes to text ────────────────────────────────────────────────
alter table public.lb_messages add column if not exists transcript text;
alter table public.lb_messages add column if not exists transcript_status text;
alter table public.lb_messages add column if not exists transcript_lang text;
alter table public.lb_messages add column if not exists transcribed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lb_messages_transcript_status_check') then
    alter table public.lb_messages add constraint lb_messages_transcript_status_check
      check (transcript_status is null or transcript_status in ('done','failed','empty'));
  end if;
end $$;
alter table public.lb_companies add column if not exists voice_transcribe boolean not null default true;

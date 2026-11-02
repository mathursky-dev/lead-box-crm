-- Lead routing rules + first-reply SLA.
--
-- 1. Routing rules (lb_route_rules + lb_route_members): new leads go to a rule's
--    users when the lead matches the rule's products, languages and/or sources
--    (empty = any). Each rule hands out leads by ratio (round-robin, same as the
--    source lists) or by lowest workload (fewest open leads). Rules are checked
--    first, by priority; if no rule matches or nobody in it can take the lead,
--    the existing city-wise lists and then the per-source lists are used exactly
--    as before. With no rules, allocation behaves exactly as today.
-- 2. Lead language (lb_leads.language): auto-detected from the first WhatsApp
--    message (script, plus common Hinglish words), taken from a form/custom field
--    called "language", or set by hand on the lead page.
-- 3. First-reply SLA (lb_reply_sla, per company, off by default): when a new
--    lead's owner does not reply (WhatsApp message, call, note, status change or
--    follow-up) within X minutes of getting it, the lead is reassigned through the
--    same rules / lists to someone else (never back to a user who already missed
--    it), up to N times, and the manager is alerted (in-app + push). Unassigned
--    new leads that wait X minutes alert the manager too. Only leads created after
--    the SLA is switched on are checked. Log: lb_reply_sla_log.
--    Cron job 'lb-reply-sla' runs every minute.
--
-- lb__auto_allocate keeps its signature; its picking logic moved into
-- lb__alloc_choose so the SLA job can reuse it. lb__alloc_user_ok honours an
-- optional transaction-local exclude list (setting lb.alloc_exclude), empty by
-- default, so nothing else changes.
-- Idempotent: safe to run more than once.

-- ── 1. Lead columns ───────────────────────────────────────────────────────
alter table public.lb_leads add column if not exists language text;
alter table public.lb_leads add column if not exists first_reply_at timestamptz;
alter table public.lb_leads add column if not exists reply_sla_at timestamptz;
create index if not exists lb_leads_reply_sla on public.lb_leads (company_id, created_at)
  where first_reply_at is null and deleted_at is null;

-- Language name/code -> short code (en, hi, mr, gu, pa, bn, ta, te, kn, ml, or, ur).
create or replace function public.lb__lang_code(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p, '')))
    when 'en' then 'en' when 'eng' then 'en' when 'english' then 'en'
    when 'hi' then 'hi' when 'hin' then 'hi' when 'hindi' then 'hi' when 'hinglish' then 'hi' when 'हिंदी' then 'hi' when 'हिन्दी' then 'hi'
    when 'mr' then 'mr' when 'marathi' then 'mr' when 'मराठी' then 'mr'
    when 'gu' then 'gu' when 'gujarati' then 'gu' when 'ગુજરાતી' then 'gu'
    when 'pa' then 'pa' when 'punjabi' then 'pa' when 'ਪੰਜਾਬੀ' then 'pa'
    when 'bn' then 'bn' when 'bengali' then 'bn' when 'bangla' then 'bn' when 'বাংলা' then 'bn'
    when 'ta' then 'ta' when 'tamil' then 'ta' when 'தமிழ்' then 'ta'
    when 'te' then 'te' when 'telugu' then 'te' when 'తెలుగు' then 'te'
    when 'kn' then 'kn' when 'kannada' then 'kn' when 'ಕನ್ನಡ' then 'kn'
    when 'ml' then 'ml' when 'malayalam' then 'ml' when 'മലയാളം' then 'ml'
    when 'or' then 'or' when 'odia' then 'or' when 'oriya' then 'or' when 'ଓଡ଼ିଆ' then 'or'
    when 'ur' then 'ur' when 'urdu' then 'ur' when 'اردو' then 'ur'
    else null end
$$;

-- Best guess of a message's language. Indian scripts are certain; Latin text is
-- Hindi when it has common Hinglish words, English when it has 3+ words, else unknown.
create or replace function public.lb__detect_lang(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '[઀-૿]' then 'gu'
    when p ~ '[਀-੿]' then 'pa'
    when p ~ '[ঀ-৿]' then 'bn'
    when p ~ '[஀-௿]' then 'ta'
    when p ~ '[ఀ-౿]' then 'te'
    when p ~ '[ಀ-೿]' then 'kn'
    when p ~ '[ഀ-ൿ]' then 'ml'
    when p ~ '[଀-୿]' then 'or'
    when p ~ '[؀-ۿ]' then 'ur'
    when p ~ '[ऀ-ॿ]' then 'hi'
    when p ~* '\m(hai|hain|kya|kyu|kyon|nahi|nahin|nhi|mujhe|muje|chahiye|chahie|kitna|kitne|kitni|kaise|kaisa|aap|aapka|apka|apko|bhai|bhaiya|haan|batao|bataiye|btao|karna|krna|karo|kro|wala|wali|mera|meri|mere|hamko|humko|hume|paisa|kab|kaha|kahan|abhi|thoda|accha|acha|dijiye|chaiye)\M' then 'hi'
    when (select count(*) from regexp_matches(p, '[A-Za-z]{2,}', 'g')) >= 3 then 'en'
    else null end
$$;

-- Form / API leads: a custom field called "language" fills the column.
create or replace function public.lb__lead_language() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.language is null and new.custom is not null then
    new.language := coalesce(lb__lang_code(new.custom->>'language'), lb__lang_code(new.custom->>'Language'));
  end if;
  if new.language is not null then new.language := coalesce(lb__lang_code(new.language), new.language); end if;
  return new;
end $$;
drop trigger if exists lb_leads_language on public.lb_leads;
create trigger lb_leads_language before insert or update of custom, language on public.lb_leads
  for each row execute function public.lb__lead_language();

-- Set a lead's language by hand (lead page).
create or replace function public.lb_set_lead_language(p_lead uuid, p_lang text) returns void
language plpgsql security definer set search_path = public as $$
declare l lb_leads; v text := lb__lang_code(p_lang);
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_lang, '')), '') is not null and v is null then raise exception 'Unknown language'; end if;
  update lb_leads set language = v, updated_at = now() where id = p_lead and language is distinct from v;
end $$;
revoke all on function public.lb_set_lead_language(uuid, text) from public, anon;
grant execute on function public.lb_set_lead_language(uuid, text) to authenticated;

-- ── 2. Routing rules ──────────────────────────────────────────────────────
create table if not exists public.lb_route_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  priority integer not null default 100 check (priority between 1 and 1000),
  is_active boolean not null default true,
  product_ids uuid[],          -- null = any product
  languages text[],            -- null = any language
  source_ids uuid[],           -- null = any source
  pick_mode text not null default 'ratio' check (pick_mode in ('ratio', 'least_load')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_route_rules_company on public.lb_route_rules (company_id, priority);

create table if not exists public.lb_route_members (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.lb_route_rules(id) on delete cascade,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null references public.lb_profiles(id) on delete cascade,
  ratio integer not null default 1 check (ratio between 1 and 100),
  max_per_day integer check (max_per_day is null or max_per_day between 1 and 10000),
  is_active boolean not null default true,
  rr_weight integer not null default 0,
  day date,
  day_count integer not null default 0,
  total_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (rule_id, user_id)
);
create index if not exists lb_route_members_company on public.lb_route_members (company_id);

alter table public.lb_route_rules enable row level security;
alter table public.lb_route_members enable row level security;
revoke all on public.lb_route_rules, public.lb_route_members from anon;
grant select, insert, update, delete on public.lb_route_rules, public.lb_route_members to authenticated;
grant all on public.lb_route_rules, public.lb_route_members to service_role;
do $$
declare t text;
begin
  foreach t in array array['lb_route_rules', 'lb_route_members'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.lb_my_company())', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.lb_is_admin_of(company_id))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.lb_is_admin_of(company_id))', t||'_del', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- Eligibility (unchanged) + optional exclude list for the SLA job.
create or replace function public.lb__alloc_user_ok(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.accepts_auto_allocation and lb__agent_available(p.id)
    and (p.allocation_limit is null or lb__open_load(p.id) < p.allocation_limit)
    and not coalesce(p.id::text = any(string_to_array(current_setting('lb.alloc_exclude', true), ',')), false)
    from lb_profiles p where p.id = p_user), false)
$$;
revoke all on function public.lb__alloc_user_ok(uuid) from public, anon, authenticated;

-- Pick one user of a routing rule: by ratio (smooth weighted round-robin) or lowest workload.
create or replace function public.lb__route_pick(p_rule uuid, p_company uuid) returns public.lb_route_members
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_sum integer; v_pick lb_route_members; v_mode text;
begin
  select pick_mode into v_mode from lb_route_rules where id = p_rule;
  perform 1 from lb_route_members m where m.rule_id = p_rule for update;

  if v_mode = 'least_load' then
    select m.* into v_pick
    from lb_route_members m join lb_profiles u on u.id = m.user_id
    where m.rule_id = p_rule and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
      and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day)
    order by lb__open_load(u.id), case when m.day = v_today then m.day_count else 0 end, m.total_count, m.created_at, m.id
    limit 1;
    if v_pick.id is null then return v_pick; end if;
    update lb_route_members set
      day_count = case when day = v_today then day_count + 1 else 1 end, day = v_today, total_count = total_count + 1
    where id = v_pick.id;
    return v_pick;
  end if;

  select coalesce(sum(m.ratio), 0) into v_sum
  from lb_route_members m join lb_profiles u on u.id = m.user_id
  where m.rule_id = p_rule and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);
  if v_sum = 0 then return v_pick; end if;

  update lb_route_members m set rr_weight = m.rr_weight + m.ratio
  from lb_profiles u
  where u.id = m.user_id and m.rule_id = p_rule and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day);

  select m.* into v_pick
  from lb_route_members m join lb_profiles u on u.id = m.user_id
  where m.rule_id = p_rule and m.is_active and u.company_id = p_company and lb__alloc_user_ok(u.id)
    and (m.max_per_day is null or m.day is distinct from v_today or m.day_count < m.max_per_day)
  order by m.rr_weight desc, m.ratio desc, m.created_at, m.id
  limit 1;

  update lb_route_members set
    rr_weight = rr_weight - v_sum,
    day_count = case when day = v_today then day_count + 1 else 1 end,
    day = v_today,
    total_count = total_count + 1
  where id = v_pick.id;
  return v_pick;
end $$;
revoke all on function public.lb__route_pick(uuid, uuid) from public, anon, authenticated;

-- Who should get this lead (no assignment done here): routing rules, then city lists, then source list.
create or replace function public.lb__alloc_choose(p_lead uuid, out o_user uuid, out o_reason text)
language plpgsql security definer set search_path = public as $$
declare
  l lb_leads; a lb_alloc_sources; r lb_route_rules; v_pick lb_alloc_members; v_rp lb_route_members;
  v_src text; v_loc text; v_lang text;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;

  -- Routing rules (product / language / source), by priority.
  v_lang := coalesce(lb__lang_code(l.language), l.language);
  for r in select * from lb_route_rules s
    where s.company_id = l.company_id and s.is_active
      and (s.product_ids is null or cardinality(s.product_ids) = 0 or coalesce(l.product_id = any(s.product_ids), false))
      and (s.source_ids is null or cardinality(s.source_ids) = 0 or coalesce(l.source_id = any(s.source_ids), false))
      and (s.languages is null or cardinality(s.languages) = 0 or coalesce(v_lang = any(s.languages), false))
    order by s.priority, s.created_at, s.id
  loop
    v_rp := lb__route_pick(r.id, l.company_id);
    if v_rp.id is not null then
      o_user := v_rp.user_id;
      o_reason := 'Routing rule: ' || r.name || case when r.pick_mode = 'least_load' then ' (lowest workload)' else ' (ratio ' || v_rp.ratio || ')' end;
      return;
    end if;
  end loop;

  -- City-wise lists.
  select location into v_loc from lb_customers where id = l.customer_id;
  if lb__city_key(v_loc) <> '' then
    for a in select * from lb_alloc_sources s
      where s.company_id = l.company_id and s.cities is not null and s.is_active
        and (s.source_id is null or s.source_id = l.source_id) and lb__city_match(v_loc, s.cities)
      order by (s.source_id is not null) desc, s.created_at, s.id
    loop
      v_pick := lb__alloc_pick(a.id, l.company_id);
      if v_pick.id is not null then
        o_user := v_pick.user_id;
        o_reason := 'Auto allocation: city ' || coalesce(a.name, array_to_string(a.cities, ', ')) || ' (ratio ' || v_pick.ratio || ')';
        return;
      end if;
    end loop;
  end if;

  -- The lead's own source row wins (even when switched off); otherwise "Others".
  select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.cities is null and s.source_id = l.source_id;
  if a.id is null then
    select * into a from lb_alloc_sources s where s.company_id = l.company_id and s.cities is null and s.source_id is null;
  end if;
  if a.id is null or not a.is_active then return; end if;

  v_pick := lb__alloc_pick(a.id, l.company_id);
  if v_pick.id is null then return; end if;
  select coalesce((select name from lb_sources where id = a.source_id), 'Others') into v_src;
  o_user := v_pick.user_id;
  o_reason := 'Auto allocation: ' || v_src || ' (ratio ' || v_pick.ratio || ')';
end $$;
revoke all on function public.lb__alloc_choose(uuid) from public, anon, authenticated;

create or replace function public.lb__auto_allocate(p_lead uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l lb_leads; v_auto boolean; v_user uuid; v_reason text;
begin
  select * into l from lb_leads where id = p_lead for update;
  if l.id is null or l.deleted_at is not null or l.owner_id is not null or lb__closed(l.status_category) then return l.owner_id; end if;
  select auto_allocate into v_auto from lb_companies where id = l.company_id;
  if not coalesce(v_auto, false) then return null; end if;
  select c.o_user, c.o_reason into v_user, v_reason from lb__alloc_choose(p_lead) c;
  if v_user is null then return null; end if;
  perform lb__assign(p_lead, v_user, p_actor, v_reason);
  return v_user;
end $$;
revoke all on function public.lb__auto_allocate(uuid, uuid) from public, anon, authenticated;

-- WhatsApp inbound: same as before, plus the new lead's language from the first message.
create or replace function public.lb_ingest_inbound(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  n lb_wa_numbers; co lb_companies; v_cust lb_customers; c lb_conversations; l lb_leads;
  v_msg uuid; v_e164 text := '+' || regexp_replace(p->>'from', '\D', '', 'g');
  v_ts timestamptz := coalesce(to_timestamp((p->>'timestamp')::bigint), now());
  v_body text := p->>'body'; v_kw text := upper(trim(coalesce(p->>'body','')));
  v_created boolean := false; v_prev_unread integer; v_status uuid;
begin
  select * into n from lb_wa_numbers where phone_number_id = p->>'phone_number_id';
  if n.id is null then return jsonb_build_object('skipped','unknown_number'); end if;
  if exists (select 1 from lb_messages where wa_message_id = p->>'wa_message_id') then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into co from lb_companies where id = n.company_id;
  update lb_wa_numbers set last_webhook_at = now() where id = n.id;

  insert into lb_customers (company_id, phone_e164, name, wa_profile_name)
  values (n.company_id, v_e164, nullif(p->>'profile_name',''), nullif(p->>'profile_name',''))
  on conflict (company_id, phone_e164) do update set wa_profile_name = coalesce(excluded.wa_profile_name, lb_customers.wa_profile_name);
  select * into v_cust from lb_customers where company_id = n.company_id and phone_e164 = v_e164 for update;

  if v_kw in ('STOP','UNSUBSCRIBE','STOP ALL','OPT OUT','OPTOUT','CANCEL') then
    update lb_customers set wa_opted_out_at = now() where id = v_cust.id;
  elsif v_kw in ('START','SUBSCRIBE','UNSTOP','OPT IN') then
    update lb_customers set wa_opted_out_at = null, wa_opt_in_at = now() where id = v_cust.id;
  end if;

  insert into lb_conversations (company_id, number_id, customer_id, team_id)
  values (n.company_id, n.id, v_cust.id, n.team_id)
  on conflict (number_id, customer_id) do nothing;
  select * into c from lb_conversations where number_id = n.id and customer_id = v_cust.id for update;

  -- Repeat messages attach to the existing lead; new contacts may create one.
  if c.lead_id is not null then select * into l from lb_leads where id = c.lead_id and deleted_at is null;
    if l.id is null then select * into l from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1; end if;
  else select * into l from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  end if;
  if l.id is null and co.auto_create_leads then
    v_status := lb__default_status(n.company_id, 'new');
    insert into lb_leads (company_id, customer_id, branch_id, department_id, team_id, product_id, source_id, number_id,
      status_id, status_category, language)
    values (n.company_id, v_cust.id, n.branch_id, n.department_id, n.team_id, n.product_id,
      (select id from lb_sources where company_id = n.company_id and name = 'WhatsApp'), n.id, v_status, 'new',
      lb__detect_lang(v_body))
    returning * into l;
    insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
    values (n.company_id, l.id, 'created', v_status, 'new', jsonb_build_object('via','whatsapp'));
    perform lb__auto_allocate(l.id, null);
    select * into l from lb_leads where id = l.id;
    v_created := true;
  end if;

  insert into lb_messages (company_id, conversation_id, direction, type, body, media_wa_id, media_mime, media_filename,
    media_status, wa_message_id, status, wa_timestamp, created_at)
  values (n.company_id, c.id, 'in', coalesce(p->>'type','text'), v_body, nullif(p->>'media_id',''), p->>'mime_type',
    p->>'filename', case when nullif(p->>'media_id','') is not null then 'pending' end,
    p->>'wa_message_id', 'received', v_ts, now())
  on conflict (wa_message_id) do nothing
  returning id into v_msg;
  if v_msg is null then return jsonb_build_object('duplicate', true); end if;

  v_prev_unread := c.unread_count;
  update lb_conversations set
    lead_id = coalesce(lead_id, l.id),
    assignee_id = coalesce(assignee_id, l.owner_id),
    unread_count = unread_count + 1,
    last_message_at = greatest(coalesce(last_message_at, v_ts), v_ts),
    last_message_preview = case when last_message_at is null or v_ts >= last_message_at
      then left(coalesce(v_body, '[' || coalesce(p->>'type','message') || ']'), 140) else last_message_preview end,
    last_inbound_at = greatest(coalesce(last_inbound_at, v_ts), v_ts),
    status = case when status = 'resolved' then 'open' else status end,
    updated_at = now()
  where id = c.id returning * into c;

  if l.id is not null then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (n.company_id, l.id, l.owner_id, 'message_in', jsonb_build_object('message_id', v_msg));
    update lb_leads set last_activity_at = now(),
      language = case when language is null then lb__detect_lang(v_body) else language end
    where id = l.id;
  end if;
  if v_prev_unread = 0 then
    perform lb__notify(n.company_id, c.assignee_id, 'message', 'New WhatsApp message',
      coalesce(v_cust.name, v_cust.wa_profile_name, v_e164) || ': ' || left(coalesce(v_body,'[media]'), 80),
      '/inbox?c=' || c.id, 'msg:' || v_msg);
  end if;
  return jsonb_build_object('message_id', v_msg, 'conversation_id', c.id, 'lead_id', l.id,
    'lead_created', v_created, 'company_id', n.company_id);
end $function$;

-- ── 3. First reply tracking ───────────────────────────────────────────────
-- A human WhatsApp reply in the lead's chat, or the owner logging a call / note /
-- status change / follow-up, counts as the first reply.
create or replace function public.lb__first_reply_msg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'out' and new.sent_by is not null and not coalesce(new.automated, false) then
    update lb_leads l set first_reply_at = now()
    from lb_conversations c
    where c.id = new.conversation_id and l.id = c.lead_id and l.first_reply_at is null;
  end if;
  return new;
end $$;
drop trigger if exists lb_messages_first_reply on public.lb_messages;
create trigger lb_messages_first_reply after insert on public.lb_messages
  for each row execute function public.lb__first_reply_msg();

create or replace function public.lb__first_reply_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor_id is not null and new.type in ('message_out', 'call', 'note', 'status_change', 'followup_created', 'followup_done') then
    update lb_leads set first_reply_at = now()
    where id = new.lead_id and first_reply_at is null and owner_id = new.actor_id;
  end if;
  return new;
end $$;
drop trigger if exists lb_lead_events_first_reply on public.lb_lead_events;
create trigger lb_lead_events_first_reply after insert on public.lb_lead_events
  for each row execute function public.lb__first_reply_event();

-- ── 4. First-reply SLA ────────────────────────────────────────────────────
create table if not exists public.lb_reply_sla (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  enabled boolean not null default false,
  minutes integer not null default 15 check (minutes between 1 and 1440),
  max_reassign integer not null default 2 check (max_reassign between 0 and 10),
  notify_managers boolean not null default true,
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);

create table if not exists public.lb_reply_sla_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  lead_id uuid not null references public.lb_leads(id) on delete cascade,
  action text not null check (action in ('reassigned', 'alerted', 'unassigned')),
  from_user_id uuid references public.lb_profiles(id) on delete set null,
  to_user_id uuid references public.lb_profiles(id) on delete set null,
  waited_min integer,
  created_at timestamptz not null default now()
);
create index if not exists lb_reply_sla_log_company on public.lb_reply_sla_log (company_id, created_at desc);
create index if not exists lb_reply_sla_log_lead on public.lb_reply_sla_log (lead_id);

alter table public.lb_reply_sla enable row level security;
alter table public.lb_reply_sla_log enable row level security;
revoke all on public.lb_reply_sla, public.lb_reply_sla_log from anon, authenticated;
grant select on public.lb_reply_sla, public.lb_reply_sla_log to authenticated;
grant all on public.lb_reply_sla, public.lb_reply_sla_log to service_role;
drop policy if exists lb_reply_sla_read on public.lb_reply_sla;
create policy lb_reply_sla_read on public.lb_reply_sla for select to authenticated using (company_id = public.lb_my_company());
drop policy if exists lb_reply_sla_log_read on public.lb_reply_sla_log;
create policy lb_reply_sla_log_read on public.lb_reply_sla_log for select to authenticated
  using (company_id = public.lb_my_company() and (public.lb_is_admin_of(company_id) or auth.uid() in (from_user_id, to_user_id)));
drop policy if exists lb_paid on public.lb_reply_sla;
create policy lb_paid on public.lb_reply_sla as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));
drop policy if exists lb_paid on public.lb_reply_sla_log;
create policy lb_paid on public.lb_reply_sla_log as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

create or replace function public.lb_save_reply_sla(p_enabled boolean, p_minutes integer, p_max_reassign integer, p_notify boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); v_cid uuid := lb_my_company();
begin
  if me.id is null or v_cid is null or not lb_is_admin_of(v_cid) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then raise exception 'Minutes must be between 1 and 1440'; end if;
  if p_max_reassign is null or p_max_reassign < 0 or p_max_reassign > 10 then raise exception 'Reassign count must be between 0 and 10'; end if;
  insert into lb_reply_sla (company_id, enabled, minutes, max_reassign, notify_managers, enabled_at, updated_at, updated_by)
  values (v_cid, coalesce(p_enabled, false), p_minutes, p_max_reassign, coalesce(p_notify, true),
          case when coalesce(p_enabled, false) then now() end, now(), me.id)
  on conflict (company_id) do update set
    enabled = excluded.enabled, minutes = excluded.minutes, max_reassign = excluded.max_reassign,
    notify_managers = excluded.notify_managers, updated_at = now(), updated_by = me.id,
    enabled_at = case when excluded.enabled and not lb_reply_sla.enabled then now()
                      when excluded.enabled then coalesce(lb_reply_sla.enabled_at, now()) else lb_reply_sla.enabled_at end;
end $$;
revoke all on function public.lb_save_reply_sla(boolean, integer, integer, boolean) from public, anon;
grant execute on function public.lb_save_reply_sla(boolean, integer, integer, boolean) to authenticated;

-- Every minute: leads whose owner has not replied in time.
create or replace function public.lb_run_reply_sla() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v record; l lb_leads; n integer := 0; v_cnt integer; v_tried uuid[]; v_user uuid; v_reason text;
  v_targets uuid[]; u uuid; v_wait integer; v_old text; v_new text; v_key text; v_since timestamptz;
begin
  for v in
    select ld.id, ld.company_id, ld.owner_id, ld.assigned_at, ld.created_at, ld.team_id, ld.lead_no,
           s.minutes, s.max_reassign, s.notify_managers,
           coalesce(cu.name, cu.wa_profile_name, cu.phone_e164, 'customer') cname
    from lb_reply_sla s
    join lb_leads ld on ld.company_id = s.company_id
    left join lb_customers cu on cu.id = ld.customer_id
    where s.enabled and s.enabled_at is not null
      and ld.created_at >= s.enabled_at and ld.created_at > now() - interval '3 days'
      and ld.deleted_at is null and ld.merged_into is null and ld.first_reply_at is null and not lb__closed(ld.status_category)
      and ((ld.owner_id is not null and coalesce(ld.assigned_at, ld.created_at) < now() - make_interval(mins => s.minutes)
            and ld.reply_sla_at is distinct from coalesce(ld.assigned_at, ld.created_at))
        or (ld.owner_id is null and ld.created_at < now() - make_interval(mins => s.minutes) and ld.reply_sla_at is null))
    order by ld.created_at
    limit 200
  loop
    -- Lock and re-check (an agent may have replied or the lead moved meanwhile).
    select * into l from lb_leads where id = v.id for update skip locked;
    if l.id is null or l.first_reply_at is not null or l.owner_id is distinct from v.owner_id
       or l.assigned_at is distinct from v.assigned_at then continue; end if;

    v_since := coalesce(l.assigned_at, l.created_at);
    v_wait := greatest(1, floor(extract(epoch from now() - v_since) / 60))::integer;
    v_targets := array(select p.id from lb_profiles p where p.company_id = l.company_id and p.is_active
      and (p.role = 'company_admin' or (p.role = 'team_leader' and l.team_id is not null and l.team_id = any(lb_team_ids_for(p.id)))));
    v_key := 'rsla:' || l.id || ':' || extract(epoch from v_since)::bigint;

    if l.owner_id is null then
      update lb_leads set reply_sla_at = now() where id = l.id;
      insert into lb_reply_sla_log (company_id, lead_id, action, waited_min) values (l.company_id, l.id, 'unassigned', v_wait);
      if v.notify_managers then
        foreach u in array v_targets loop
          perform lb__notify(l.company_id, u, 'sla', 'New lead waiting: LB-' || l.lead_no,
            v.cname || ' has no owner and no reply for ' || v_wait || ' min', '/leads/' || l.id, v_key || ':u:' || u);
        end loop;
      end if;
      n := n + 1;
      continue;
    end if;

    select count(*), coalesce(array_agg(from_user_id) filter (where from_user_id is not null), '{}')
      into v_cnt, v_tried
    from lb_reply_sla_log where lead_id = l.id and action = 'reassigned';
    select full_name into v_old from lb_profiles where id = l.owner_id;

    v_user := null; v_reason := null;
    if v_cnt < v.max_reassign then
      perform set_config('lb.alloc_exclude', array_to_string(array_append(v_tried, l.owner_id), ','), true);
      select c.o_user, c.o_reason into v_user, v_reason from lb__alloc_choose(l.id) c;
      perform set_config('lb.alloc_exclude', '', true);
    end if;

    if v_user is not null then
      perform lb__assign(l.id, v_user, null,
        'First-reply SLA: ' || coalesce(v_old, 'owner') || ' did not reply in ' || v.minutes || ' min. ' || coalesce(v_reason, ''));
      insert into lb_reply_sla_log (company_id, lead_id, action, from_user_id, to_user_id, waited_min)
      values (l.company_id, l.id, 'reassigned', l.owner_id, v_user, v_wait);
      select full_name into v_new from lb_profiles where id = v_user;
      perform lb__notify(l.company_id, l.owner_id, 'sla', 'Lead LB-' || l.lead_no || ' moved to ' || coalesce(v_new, 'a teammate'),
        'No reply to ' || v.cname || ' within ' || v.minutes || ' min', '/leads/' || l.id, v_key || ':o:' || l.owner_id);
      if v.notify_managers then
        foreach u in array v_targets loop
          if u <> v_user then
            perform lb__notify(l.company_id, u, 'sla', 'Reassigned (no reply): LB-' || l.lead_no,
              coalesce(v_old, 'Owner') || ' did not reply to ' || v.cname || ' in ' || v_wait || ' min. Now with ' || coalesce(v_new, 'a teammate') || '.',
              '/leads/' || l.id, v_key || ':m:' || u);
          end if;
        end loop;
      end if;
    else
      update lb_leads set reply_sla_at = v_since where id = l.id;
      insert into lb_reply_sla_log (company_id, lead_id, action, from_user_id, waited_min)
      values (l.company_id, l.id, 'alerted', l.owner_id, v_wait);
      perform lb__notify(l.company_id, l.owner_id, 'sla', 'Reply overdue: LB-' || l.lead_no,
        v.cname || ' is waiting ' || v_wait || ' min for your first reply', '/leads/' || l.id, v_key || ':o:' || l.owner_id);
      if v.notify_managers then
        foreach u in array v_targets loop
          if u <> l.owner_id then
            perform lb__notify(l.company_id, u, 'sla', 'No reply: LB-' || l.lead_no,
              coalesce(v_old, 'Owner') || ' has not replied to ' || v.cname || ' in ' || v_wait || ' min'
                || case when v_cnt >= v.max_reassign and v.max_reassign > 0 then ' (already reassigned ' || v_cnt || 'x)'
                        when v.max_reassign = 0 then ''
                        else '; nobody else is free to take it' end,
              '/leads/' || l.id, v_key || ':m:' || u);
          end if;
        end loop;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_run_reply_sla() from public, anon, authenticated;
grant execute on function public.lb_run_reply_sla() to service_role;

select cron.unschedule('lb-reply-sla') where exists (select 1 from cron.job where jobname = 'lb-reply-sla');
select cron.schedule('lb-reply-sla', '* * * * *', 'select public.lb_run_reply_sla()');

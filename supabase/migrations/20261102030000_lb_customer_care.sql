-- Customer care: customer portal, appointment booking, feedback / NPS and referral program.
--
--   * lb_care_settings: one row per company (portal, booking page, feedback and referral settings).
--   * lb_customers.portal_token / referral_code: created on demand (lb_customer_links).
--     Portal  /p/<portal_token>  : the customer's quotations, invoices, payment links, orders and appointments.
--     Referral /ref/<referral_code>: a friend leaves name + number, a new lead is created with source "Referral".
--   * lb_appointments + public booking page /b/<booking_code>: free slots from the weekly hours, capacity per slot.
--     Every booking lands on the customer's open lead (or a new lead) and becomes a "meeting" follow-up for the owner.
--   * lb_feedback: NPS 0-10 + comment at /r/<token>. When a lead is Won (and auto feedback is on) a request is
--     queued and sent on WhatsApp after the delay, if the customer's 24-hour window is open; otherwise the
--     owner gets a notification to send it by hand.
--   * lb_referrals: referrer -> referred lead. Lead Won -> "won" (reward due), admins mark "rewarded".
--
-- Reads are company scoped (lb_my_company(), follows the Super Admin company switcher). Public pages go through
-- service-role RPCs only. Nothing existing is changed except one AFTER UPDATE trigger on lb_leads whose body can
-- never block the lead update. Safe to run more than once.

-- ------------------------------------------------------------ 1. settings
create table if not exists public.lb_care_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  -- portal
  portal_enabled boolean not null default true,
  portal_note text not null default '',
  -- booking page
  booking_enabled boolean not null default false,
  booking_code text unique check (booking_code is null or booking_code ~ '^[A-Z0-9]{4,12}$'),
  booking_title text not null default 'Book an appointment',
  booking_intro text not null default '',
  booking_location text not null default '',
  slot_minutes integer not null default 30 check (slot_minutes between 10 and 480),
  slot_capacity integer not null default 1 check (slot_capacity between 1 and 50),
  days_ahead integer not null default 14 check (days_ahead between 1 and 90),
  min_notice_hours integer not null default 2 check (min_notice_hours between 0 and 168),
  -- ISO weekday ("1" = Monday … "7" = Sunday) -> ["HH:MM","HH:MM"]; a missing day is closed.
  week_hours jsonb not null default '{"1":["10:00","18:00"],"2":["10:00","18:00"],"3":["10:00","18:00"],"4":["10:00","18:00"],"5":["10:00","18:00"],"6":["10:00","14:00"]}'::jsonb,
  closed_dates date[] not null default '{}',
  booking_source_id uuid references public.lb_sources(id) on delete set null,
  booking_thank_you text not null default 'Your appointment is booked. We will confirm it on WhatsApp.',
  -- feedback / NPS
  feedback_auto boolean not null default false,
  feedback_delay_hours integer not null default 2 check (feedback_delay_hours between 0 and 720),
  feedback_question text not null default 'How likely are you to recommend us to a friend or family member?',
  feedback_message text not null default 'Hi {name}, thank you for choosing {company}! 🙏 Please rate your experience, it takes 10 seconds: {link}',
  review_url text,
  -- referral program
  referral_enabled boolean not null default true,
  referral_reward text not null default '',
  referral_message text not null default 'Hi {name}! Refer your friends to {company}. Share this link with them: {link}',
  referral_source_id uuid references public.lb_sources(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------- 2. customer links
alter table public.lb_customers add column if not exists portal_token text;
alter table public.lb_customers add column if not exists referral_code text;
create unique index if not exists lb_customers_portal_token on public.lb_customers (portal_token) where portal_token is not null;
create unique index if not exists lb_customers_referral_code on public.lb_customers (referral_code) where referral_code is not null;

-- ------------------------------------------------------ 3. appointments
create table if not exists public.lb_appointments (
  id uuid primary key default gen_random_uuid(),
  appt_no bigint generated always as identity unique,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  customer_id uuid references public.lb_customers(id) on delete set null,
  lead_id uuid references public.lb_leads(id) on delete set null,
  assigned_to uuid references public.lb_profiles(id) on delete set null,
  followup_id uuid references public.lb_followups(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','confirmed','done','cancelled','no_show')),
  channel text not null default 'link' check (channel in ('link','staff')),
  name text,
  phone_e164 text not null,
  note text,
  staff_note text,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists lb_appointments_company on public.lb_appointments (company_id, starts_at);
create index if not exists lb_appointments_lead on public.lb_appointments (lead_id);
create index if not exists lb_appointments_customer on public.lb_appointments (customer_id);

-- ---------------------------------------------------------- 4. feedback
create table if not exists public.lb_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  lead_id uuid not null references public.lb_leads(id) on delete cascade,
  customer_id uuid references public.lb_customers(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'pending' check (status in ('pending','sent','answered','not_sent')),
  send_after timestamptz,          -- auto request: when to send (null = staff sends it)
  sent_at timestamptz,
  score integer check (score between 0 and 10),
  comment text,
  answered_at timestamptz,
  requested_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists lb_feedback_lead on public.lb_feedback (lead_id);
create index if not exists lb_feedback_company on public.lb_feedback (company_id, created_at desc);
create index if not exists lb_feedback_due on public.lb_feedback (send_after) where status = 'pending' and send_after is not null;

-- --------------------------------------------------------- 5. referrals
create table if not exists public.lb_referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  referrer_customer_id uuid not null references public.lb_customers(id) on delete cascade,
  customer_id uuid references public.lb_customers(id) on delete set null,   -- the friend
  lead_id uuid references public.lb_leads(id) on delete set null,           -- the friend's lead
  status text not null default 'pending' check (status in ('pending','won','lost','rewarded')),
  channel text not null default 'link' check (channel in ('link','staff')),
  reward_note text,
  rewarded_at timestamptz,
  rewarded_by uuid references public.lb_profiles(id) on delete set null,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lb_referrals_lead on public.lb_referrals (lead_id) where lead_id is not null;
create index if not exists lb_referrals_company on public.lb_referrals (company_id, created_at desc);
create index if not exists lb_referrals_referrer on public.lb_referrals (referrer_customer_id);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['lb_care_settings','lb_appointments','lb_feedback','lb_referrals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;
create policy lb_care_settings_read on public.lb_care_settings for select to authenticated using (company_id = public.lb_my_company());
-- Rows tied to a lead follow that lead's visibility (lb_leads RLS applies inside the subquery).
create policy lb_appointments_read on public.lb_appointments for select to authenticated using (
  company_id = public.lb_my_company()
  and (lead_id is null or exists (select 1 from public.lb_leads l where l.id = lb_appointments.lead_id)));
create policy lb_feedback_read on public.lb_feedback for select to authenticated using (
  company_id = public.lb_my_company() and exists (select 1 from public.lb_leads l where l.id = lb_feedback.lead_id));
create policy lb_referrals_read on public.lb_referrals for select to authenticated using (
  company_id = public.lb_my_company()
  and (lead_id is null or exists (select 1 from public.lb_leads l where l.id = lb_referrals.lead_id)));

-- ============================================================== helpers
-- Portal token + referral code of a customer, created the first time they are needed. Service role only.
create or replace function public.lb_customer_links(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lb_customers; v_code text; i int := 0;
begin
  select * into c from lb_customers where id = p_customer for update;
  if c.id is null then raise exception 'Customer not found'; end if;
  if c.portal_token is null then
    update lb_customers set portal_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    where id = c.id returning * into c;
  end if;
  while c.referral_code is null loop
    i := i + 1;
    v_code := upper(left(translate(replace(gen_random_uuid()::text, '-', ''), '01', 'XY'), 8));
    begin
      update lb_customers set referral_code = v_code where id = c.id returning * into c;
    exception when unique_violation then
      if i > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('portal_token', c.portal_token, 'referral_code', c.referral_code);
end $$;
revoke all on function public.lb_customer_links(uuid) from public, anon, authenticated;
grant execute on function public.lb_customer_links(uuid) to service_role;

-- Customer by phone + their open lead (or a new lead). Used by booking and referral pages. No permission check.
-- Returns {customer_id, lead_id, new_lead, new_customer, had_leads}.
create or replace function public.lb__care_lead(p_company uuid, p_phone text, p_name text, p_note text,
  p_source_name text, p_source uuid, p_via text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cust lb_customers; v_lead lb_leads; v_source uuid := p_source; v_status uuid; v_new_c boolean := false; v_had boolean;
begin
  select * into v_cust from lb_customers where company_id = p_company and phone_e164 = p_phone for update;
  if v_cust.id is null then
    insert into lb_customers (company_id, phone_e164, name) values (p_company, p_phone, nullif(trim(p_name), ''))
    on conflict (company_id, phone_e164) do nothing returning * into v_cust;
    if v_cust.id is null then select * into v_cust from lb_customers where company_id = p_company and phone_e164 = p_phone for update;
    else v_new_c := true; end if;
  elsif v_cust.name is null and nullif(trim(p_name), '') is not null then
    update lb_customers set name = trim(p_name), updated_at = now() where id = v_cust.id returning * into v_cust;
  end if;
  v_had := exists (select 1 from lb_leads where customer_id = v_cust.id);

  select * into v_lead from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_lead.id is not null and not lb__closed(v_lead.status_category) then
    update lb_leads set last_activity_at = now() where id = v_lead.id;
    return jsonb_build_object('customer_id', v_cust.id, 'lead_id', v_lead.id, 'new_lead', false, 'new_customer', v_new_c, 'had_leads', v_had);
  end if;

  if v_source is null or not exists (select 1 from lb_sources where id = v_source and company_id = p_company) then
    insert into lb_sources (company_id, name) values (p_company, p_source_name) on conflict (company_id, name) do nothing;
    select id into v_source from lb_sources where company_id = p_company and name = p_source_name;
  end if;
  v_status := lb__default_status(p_company, 'new');
  insert into lb_leads (company_id, customer_id, source_id, status_id, status_category, priority, notes, is_repeat, parent_lead_id)
  values (p_company, v_cust.id, v_source, v_status, 'new', 'high', nullif(trim(p_note), ''), v_lead.id is not null, v_lead.id)
  returning * into v_lead;
  insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
  values (p_company, v_lead.id, case when v_lead.parent_lead_id is not null then 'repeat_created' else 'created' end,
    v_lead.status_id, 'new', jsonb_build_object('via', p_via));
  perform lb__auto_allocate(v_lead.id, null);
  return jsonb_build_object('customer_id', v_cust.id, 'lead_id', v_lead.id, 'new_lead', true, 'new_customer', v_new_c, 'had_leads', v_had);
end $$;
revoke all on function public.lb__care_lead(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- Lead owner + company admins (active).
create or replace function public.lb__care_notify(p_company uuid, p_lead uuid, p_type text, p_title text, p_body text, p_link text, p_key text, p_admins boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; r record;
begin
  select owner_id into v_owner from lb_leads where id = p_lead;
  for r in select id from lb_profiles where company_id = p_company and is_active
             and (id = v_owner or (p_admins and role = 'company_admin')) loop
    perform lb__notify(p_company, r.id, p_type, p_title, p_body, p_link, p_key || ':' || r.id);
  end loop;
end $$;
revoke all on function public.lb__care_notify(uuid, uuid, text, text, text, text, text, boolean) from public, anon, authenticated;

-- ============================================================== booking
-- Free slots of a company for the next days_ahead days (company time zone). Service role / internal.
create or replace function public.lb__free_slots(p_company uuid)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (
    select cs.*, co.timezone as tz, make_interval(mins => cs.slot_minutes) as len
    from lb_care_settings cs join lb_companies co on co.id = cs.company_id where cs.company_id = p_company
  ), d as (
    select s.*, ((now() at time zone s.tz)::date + g) as day from s, generate_series(0, s.days_ahead) g
  ), h as (
    select d.*, d.week_hours -> extract(isodow from d.day)::int::text as wh from d where not (d.day = any(d.closed_dates))
  ), sl as (
    select (t at time zone h.tz) as st, h.len, h.slot_capacity, h.min_notice_hours
    from h, generate_series(h.day + (h.wh->>0)::time, h.day + (h.wh->>1)::time - h.len, h.len) t
    where jsonb_typeof(h.wh) = 'array' and (h.wh->>0) ~ '^\d{2}:\d{2}$' and (h.wh->>1) ~ '^\d{2}:\d{2}$'
  )
  select sl.st, sl.st + sl.len from sl
  where sl.st >= now() + make_interval(hours => sl.min_notice_hours)
    and (select count(*) from lb_appointments a where a.company_id = p_company and a.status in ('booked','confirmed')
           and a.starts_at < sl.st + sl.len and a.ends_at > sl.st) < sl.slot_capacity
  order by 1
$$;
revoke all on function public.lb__free_slots(uuid) from public, anon, authenticated;

-- Public booking page data. Service role only.
create or replace function public.lb_booking_page(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s lb_care_settings; co lb_companies; v_days jsonb;
begin
  select * into s from lb_care_settings where booking_code = upper(p_code);
  if s.company_id is null then return null; end if;
  select * into co from lb_companies where id = s.company_id;
  select coalesce(jsonb_agg(jsonb_build_object('date', day, 'slots', slots) order by day), '[]'::jsonb) into v_days
  from (
    select (f.starts_at at time zone co.timezone)::date as day,
           jsonb_agg(jsonb_build_object('at', f.starts_at, 'label', to_char(f.starts_at at time zone co.timezone, 'HH12:MI AM')) order by f.starts_at) as slots
    from lb__free_slots(s.company_id) f group by 1
  ) x;
  return jsonb_build_object(
    'company', co.name, 'title', s.booking_title, 'intro', s.booking_intro, 'location', s.booking_location,
    'minutes', s.slot_minutes, 'thank_you', s.booking_thank_you, 'tz', co.timezone,
    'open', s.booking_enabled and co.is_active and lb_company_entitled(co.id),
    'days', case when s.booking_enabled then v_days else '[]'::jsonb end);
end $$;
revoke all on function public.lb_booking_page(text) from public, anon, authenticated;
grant execute on function public.lb_booking_page(text) to service_role;

-- Core: put an appointment on a lead, as a "meeting" follow-up for the owner, log it, notify. No permission check.
create or replace function public.lb__create_appointment(p_company uuid, p_lead uuid, p_start timestamptz, p_end timestamptz,
  p_channel text, p_name text, p_phone text, p_note text, p_actor uuid, p_assign uuid default null)
returns lb_appointments language plpgsql security definer set search_path = public as $$
declare l lb_leads; a lb_appointments; v_fu uuid; v_who uuid; v_tz text; v_when text; v_loc text;
begin
  select * into l from lb_leads where id = p_lead and company_id = p_company;
  if l.id is null then raise exception 'Lead not found'; end if;
  select timezone into v_tz from lb_companies where id = p_company;
  select nullif(booking_location, '') into v_loc from lb_care_settings where company_id = p_company;
  v_who := coalesce(p_assign, l.owner_id, p_actor);
  v_when := to_char(p_start at time zone v_tz, 'Dy DD Mon YYYY, HH12:MI AM');
  if v_who is not null then
    insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, action_type, created_by)
    values (p_company, l.id, v_who, p_start,
      left('📅 Appointment' || coalesce(' · ' || nullif(trim(p_note), ''), '') || coalesce(' · ' || v_loc, ''), 500), 'meeting', p_actor)
    returning id into v_fu;
    perform lb__refresh_next_followup(l.id);
  end if;
  insert into lb_appointments (company_id, customer_id, lead_id, assigned_to, followup_id, starts_at, ends_at, channel, name, phone_e164, note, created_by)
  values (p_company, l.customer_id, l.id, v_who, v_fu, p_start, p_end, p_channel, nullif(trim(p_name), ''), p_phone,
    nullif(left(trim(p_note), 1000), ''), p_actor)
  returning * into a;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (p_company, l.id, p_actor, l.owner_id, 'note', p_actor is not null,
    jsonb_build_object('via', 'appointment', 'appointment_id', a.id,
      'text', '📅 Appointment #' || a.appt_no || ' booked for ' || v_when
        || case p_channel when 'link' then ' (customer booked online)' else '' end
        || coalesce(E'\nNote: ' || nullif(trim(p_note), ''), '')));
  update lb_leads set last_activity_at = now() where id = l.id;
  if p_channel = 'link' then
    perform lb__care_notify(p_company, l.id, 'appointment', '📅 New appointment · ' || v_when,
      coalesce(nullif(trim(p_name), ''), p_phone) || coalesce(' · ' || nullif(trim(p_note), ''), ''),
      '/care/appointments?id=' || a.id, 'appt:' || a.id);
  elsif v_who is not null and v_who is distinct from p_actor then
    perform lb__notify(p_company, v_who, 'appointment', '📅 Appointment assigned · ' || v_when,
      coalesce(nullif(trim(p_name), ''), p_phone), '/care/appointments?id=' || a.id, 'appt:' || a.id || ':' || v_who);
  end if;
  return a;
end $$;
revoke all on function public.lb__create_appointment(uuid, uuid, timestamptz, timestamptz, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- Public booking (/b/<code>). Service role only. p: {phone_e164, name, note, starts_at}
create or replace function public.lb_book_slot(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s lb_care_settings; co lb_companies; v_phone text := p->>'phone_e164'; v_start timestamptz; v_end timestamptz; r jsonb; a lb_appointments;
begin
  select * into s from lb_care_settings where booking_code = upper(p_code);
  if s.company_id is null or not s.booking_enabled then raise exception 'Booking is closed right now'; end if;
  select * into co from lb_companies where id = s.company_id;
  if not co.is_active or not lb_company_entitled(co.id) then raise exception 'Booking is closed right now'; end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  begin v_start := (p->>'starts_at')::timestamptz; exception when others then v_start := null; end;
  if v_start is null then raise exception 'Pick a time slot'; end if;
  -- One booking at a time per company, so two people can't take the last place of a slot together.
  perform pg_advisory_xact_lock(hashtext('lb_book:' || s.company_id::text));
  select f.ends_at into v_end from lb__free_slots(s.company_id) f where f.starts_at = v_start;
  if v_end is null then raise exception 'That slot was just taken. Please pick another time.'; end if;
  -- Same number, same slot: don't double book.
  if exists (select 1 from lb_appointments where company_id = s.company_id and phone_e164 = v_phone and starts_at = v_start and status in ('booked','confirmed')) then
    raise exception 'You already have this slot booked';
  end if;
  if (select count(*) from lb_appointments where company_id = s.company_id and phone_e164 = v_phone and status in ('booked','confirmed') and starts_at > now()) >= 3 then
    raise exception 'You already have upcoming appointments. Please contact us on WhatsApp to change them.';
  end if;
  r := lb__care_lead(s.company_id, v_phone, left(p->>'name', 120), left(p->>'note', 1000), 'Appointment booking', s.booking_source_id, 'booking');
  a := lb__create_appointment(s.company_id, (r->>'lead_id')::uuid, v_start, v_end, 'link', left(p->>'name', 120), v_phone, left(p->>'note', 1000), null);
  return jsonb_build_object('appointment_id', a.id, 'appt_no', a.appt_no, 'starts_at', a.starts_at,
    'label', to_char(a.starts_at at time zone co.timezone, 'Dy DD Mon YYYY, HH12:MI AM'));
end $$;
revoke all on function public.lb_book_slot(text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_book_slot(text, jsonb) to service_role;

-- Staff: book an appointment for a lead. p_local = wall-clock time in the company time zone.
create or replace function public.lb_staff_book(p_lead uuid, p_local timestamp, p_minutes integer, p_note text, p_assign uuid default null)
returns lb_appointments language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; c lb_customers; v_tz text; v_start timestamptz;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null or l.company_id is distinct from lb_my_company() or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_local is null then raise exception 'Pick a date and time'; end if;
  if p_minutes is null or p_minutes not between 5 and 600 then raise exception 'Duration must be 5–600 minutes'; end if;
  if p_assign is not null and not exists (select 1 from lb_profiles where id = p_assign and company_id = l.company_id and is_active) then
    raise exception 'Pick an active user of this company';
  end if;
  select timezone into v_tz from lb_companies where id = l.company_id;
  v_start := p_local at time zone v_tz;
  if v_start < now() - interval '5 minutes' then raise exception 'Appointment must be in the future'; end if;
  select * into c from lb_customers where id = l.customer_id;
  return lb__create_appointment(l.company_id, l.id, v_start, v_start + make_interval(mins => p_minutes), 'staff',
    c.name, c.phone_e164, p_note, me.id, p_assign);
end $$;
revoke all on function public.lb_staff_book(uuid, timestamp, integer, text, uuid) from public, anon;
grant execute on function public.lb_staff_book(uuid, timestamp, integer, text, uuid) to authenticated;

-- Staff: change appointment status. Cancel / no-show closes the follow-up; done completes it.
create or replace function public.lb_set_appointment(p_id uuid, p_status text, p_note text default null)
returns lb_appointments language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); a lb_appointments; l lb_leads; v_old text;
begin
  select * into a from lb_appointments where id = p_id for update;
  if a.id is null or a.company_id is distinct from lb_my_company() then raise exception 'Appointment not found' using errcode = '42501'; end if;
  if a.lead_id is not null then
    select * into l from lb_leads where id = a.lead_id;
    if l.id is not null and not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  end if;
  if p_status not in ('booked','confirmed','done','cancelled','no_show') then raise exception 'Invalid status'; end if;
  v_old := a.status;
  update lb_appointments set status = p_status, staff_note = coalesce(nullif(left(trim(p_note), 1000), ''), staff_note),
    updated_at = now() where id = a.id returning * into a;
  if a.followup_id is not null and p_status in ('done','cancelled','no_show') then
    update lb_followups set status = case when p_status = 'done' then 'done' else 'cancelled' end,
      completed_at = now(), completed_by = me.id
    where id = a.followup_id and status = 'pending';
  elsif a.followup_id is not null and p_status in ('booked','confirmed') then
    update lb_followups set status = 'pending', completed_at = null, completed_by = null where id = a.followup_id and status <> 'pending';
  end if;
  if a.lead_id is not null then
    perform lb__refresh_next_followup(a.lead_id);
    if v_old <> p_status then
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
      values (a.company_id, a.lead_id, me.id, l.owner_id, 'note', true,
        jsonb_build_object('via', 'appointment', 'appointment_id', a.id, 'text', '📅 Appointment #' || a.appt_no || ': ' || v_old || ' → ' || p_status));
      update lb_leads set last_activity_at = now() where id = a.lead_id;
    end if;
  end if;
  return a;
end $$;
revoke all on function public.lb_set_appointment(uuid, text, text) from public, anon;
grant execute on function public.lb_set_appointment(uuid, text, text) to authenticated;

-- ============================================================= feedback
-- Customer answers /r/<token>. Service role only. Returns {review_url} for promoters.
create or replace function public.lb_submit_feedback(p_token text, p_score integer, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f lb_feedback; s lb_care_settings; c lb_customers; v_txt text;
begin
  select * into f from lb_feedback where token = p_token for update;
  if f.id is null then raise exception 'Link not found'; end if;
  if p_score is null or p_score not between 0 and 10 then raise exception 'Pick a score from 0 to 10'; end if;
  if f.status = 'answered' and f.answered_at < now() - interval '1 day' then raise exception 'Thank you, your feedback was already recorded'; end if;
  update lb_feedback set score = p_score, comment = nullif(left(trim(p_comment), 2000), ''), status = 'answered', answered_at = now()
  where id = f.id returning * into f;
  select * into s from lb_care_settings where company_id = f.company_id;
  select * into c from lb_customers where id = f.customer_id;
  v_txt := '⭐ Feedback: ' || p_score || '/10 (' || case when p_score >= 9 then 'promoter' when p_score >= 7 then 'passive' else 'detractor' end || ')'
    || coalesce(E'\n“' || f.comment || '”', '');
  -- One timeline entry per request (an edit within a day replaces nothing, just adds the new answer).
  insert into lb_lead_events (company_id, lead_id, type, data)
  values (f.company_id, f.lead_id, 'note', jsonb_build_object('via', 'feedback', 'feedback_id', f.id, 'text', v_txt));
  perform lb__care_notify(f.company_id, f.lead_id, 'feedback',
    case when p_score <= 6 then '⚠️ Unhappy customer: ' else '⭐ Feedback ' end || p_score || '/10 · ' || coalesce(c.name, c.phone_e164, 'Customer'),
    coalesce(left(f.comment, 140), ''), '/leads/' || f.lead_id, 'fb:' || f.id || ':' || p_score, p_score <= 6);
  return jsonb_build_object('ok', true, 'review_url', case when p_score >= 9 then nullif(s.review_url, '') end);
end $$;
revoke all on function public.lb_submit_feedback(text, integer, text) from public, anon, authenticated;
grant execute on function public.lb_submit_feedback(text, integer, text) to service_role;

create or replace function public.lb__care_fill(p_tpl text, p_name text, p_company text, p_link text) returns text
language sql immutable set search_path = public as $$
  select replace(replace(replace(coalesce(p_tpl, ''), '{name}', coalesce(nullif(trim(p_name), ''), 'there')), '{company}', coalesce(p_company, '')), '{link}', coalesce(p_link, ''))
$$;

-- Sends due auto feedback requests (pg_cron, every 5 minutes). A free-form WhatsApp text is only allowed
-- inside the 24-hour window, so outside it the owner is asked to send the link by hand.
create or replace function public.lb_run_feedback(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = public as $$
declare f record; v_conv lb_conversations; v_url text := (select rtrim(value, '/') from lb_settings where key = 'app_url'); v_body text; n int := 0;
begin
  for f in
    select fb.*, s.feedback_message, co.name as co_name, c.name as c_name, c.wa_opted_out_at, l.deleted_at as lead_deleted
    from lb_feedback fb
    join lb_companies co on co.id = fb.company_id
    join lb_leads l on l.id = fb.lead_id
    left join lb_customers c on c.id = fb.customer_id
    left join lb_care_settings s on s.company_id = fb.company_id
    where fb.status = 'pending' and fb.send_after is not null and fb.send_after <= now()
    order by fb.send_after limit p_limit
    for update of fb skip locked
  loop
    n := n + 1;
    if f.lead_deleted is not null or f.wa_opted_out_at is not null or v_url is null then
      update lb_feedback set status = 'not_sent', send_after = null where id = f.id;
      continue;
    end if;
    select v.* into v_conv from lb_conversations v
    where v.company_id = f.company_id and v.customer_id = f.customer_id
      and exists (select 1 from lb_messages m where m.conversation_id = v.id and m.direction = 'in' and m.created_at > now() - interval '23 hours 30 minutes')
    order by v.last_message_at desc nulls last limit 1;
    if v_conv.id is null then
      update lb_feedback set status = 'not_sent', send_after = null where id = f.id;
      perform lb__care_notify(f.company_id, f.lead_id, 'feedback', 'Ask for feedback: ' || coalesce(f.c_name, 'customer'),
        'WhatsApp 24-hour window is closed, so the feedback link was not sent automatically. Open the lead and send it with a template.',
        '/leads/' || f.lead_id, 'fbask:' || f.id, false);
      continue;
    end if;
    v_body := lb__care_fill(coalesce(nullif(f.feedback_message, ''), 'Please rate your experience: {link}'), f.c_name, f.co_name, v_url || '/r/' || f.token);
    if position(f.token in v_body) = 0 then v_body := v_body || E'\n' || v_url || '/r/' || f.token; end if;
    insert into lb_messages (company_id, conversation_id, direction, type, body, client_id, status, next_attempt_at, automated)
    values (f.company_id, v_conv.id, 'out', 'text', left(v_body, 4096), f.id, 'queued', now(), true)
    on conflict (client_id) do nothing;
    update lb_conversations set last_message_at = now(), last_message_preview = left(v_body, 140), updated_at = now() where id = v_conv.id;
    update lb_feedback set status = 'sent', sent_at = now() where id = f.id;
  end loop;
  return n;
end $$;
revoke all on function public.lb_run_feedback(integer) from public, anon, authenticated;

-- ============================================================= referrals
-- Public referral form (/ref/<code>). Service role only. p: {phone_e164, name, note}
create or replace function public.lb_submit_referral(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ref lb_customers; s lb_care_settings; co lb_companies; v_phone text := p->>'phone_e164'; r jsonb; v_lead uuid; v_id uuid;
begin
  select * into ref from lb_customers where referral_code = upper(p_code);
  if ref.id is null then raise exception 'Referral link not found'; end if;
  select * into s from lb_care_settings where company_id = ref.company_id;
  select * into co from lb_companies where id = ref.company_id;
  if (s.company_id is not null and not s.referral_enabled) or not co.is_active or not lb_company_entitled(co.id) then
    raise exception 'This referral program is closed right now';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if v_phone = ref.phone_e164 then raise exception 'You can''t use your own referral link. Share it with a friend instead.'; end if;

  r := lb__care_lead(ref.company_id, v_phone, left(p->>'name', 120), left(p->>'note', 1000), 'Referral', s.referral_source_id, 'referral');
  v_lead := (r->>'lead_id')::uuid;
  -- Only a brand-new contact counts as a referral (an existing customer can't be "referred" again).
  if (r->>'had_leads')::boolean is false and not exists (select 1 from lb_referrals where lead_id = v_lead) then
    insert into lb_referrals (company_id, referrer_customer_id, customer_id, lead_id, channel)
    values (ref.company_id, ref.id, (r->>'customer_id')::uuid, v_lead, 'link') returning id into v_id;
  end if;
  insert into lb_lead_events (company_id, lead_id, type, data)
  values (ref.company_id, v_lead, 'note', jsonb_build_object('via', 'referral', 'referral_id', v_id,
    'text', '🤝 Referred by ' || coalesce(ref.name, ref.phone_e164) || ' (' || ref.phone_e164 || ')'
      || case when v_id is null then ' · existing contact, not counted as a referral' else '' end
      || coalesce(E'\nNote: ' || nullif(trim(p->>'note'), ''), '')));
  perform lb__care_notify(ref.company_id, v_lead, 'referral', '🤝 New referral from ' || coalesce(ref.name, ref.phone_e164),
    left(p->>'name', 120) || ' · ' || v_phone, '/leads/' || v_lead, 'ref:' || v_lead || ':' || coalesce(v_id::text, 'x'));
  return jsonb_build_object('ok', true, 'counted', v_id is not null);
end $$;
revoke all on function public.lb_submit_referral(text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_submit_referral(text, jsonb) to service_role;

-- Staff: "Referred by" on a lead, by the referrer's phone (must already be a customer of the company).
create or replace function public.lb_add_referral(p_lead uuid, p_referrer_phone text)
returns lb_referrals language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; ref lb_customers; x lb_referrals;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null or l.company_id is distinct from lb_my_company() or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not (lb_can('leads.edit') or lb_is_admin_of(l.company_id)) then raise exception 'You do not have permission to edit leads' using errcode = '42501'; end if;
  select * into ref from lb_customers where company_id = l.company_id and phone_e164 = p_referrer_phone;
  if ref.id is null then raise exception 'No customer with that number. The referrer must already be in the CRM.'; end if;
  if ref.id = l.customer_id then raise exception 'A customer can''t refer themselves'; end if;
  if exists (select 1 from lb_referrals where lead_id = l.id) then raise exception 'This lead already has a referrer'; end if;
  insert into lb_referrals (company_id, referrer_customer_id, customer_id, lead_id, channel, created_by,
    status)
  values (l.company_id, ref.id, l.customer_id, l.id, 'staff', me.id,
    case l.status_category when 'won' then 'won' when 'lost' then 'lost' when 'invalid' then 'lost' else 'pending' end)
  returning * into x;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, l.id, me.id, l.owner_id, 'note', true,
    jsonb_build_object('via', 'referral', 'referral_id', x.id, 'text', '🤝 Referred by ' || coalesce(ref.name, ref.phone_e164) || ' (' || ref.phone_e164 || ')'));
  return x;
end $$;
revoke all on function public.lb_add_referral(uuid, text) from public, anon;
grant execute on function public.lb_add_referral(uuid, text) to authenticated;

-- Staff: mark a referral rewarded (or back to won / pending).
create or replace function public.lb_set_referral(p_id uuid, p_status text, p_note text default null)
returns lb_referrals language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); x lb_referrals;
begin
  select * into x from lb_referrals where id = p_id for update;
  if x.id is null or x.company_id is distinct from lb_my_company() then raise exception 'Referral not found' using errcode = '42501'; end if;
  if not (lb_is_admin_of(x.company_id) or lb_can('leads.edit')) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if x.lead_id is not null and not exists (select 1 from lb_leads l where l.id = x.lead_id and lb_can_see_lead(l.company_id, l.team_id, l.owner_id)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_status not in ('pending','won','lost','rewarded') then raise exception 'Invalid status'; end if;
  update lb_referrals set status = p_status,
    reward_note = coalesce(nullif(left(trim(p_note), 500), ''), reward_note),
    rewarded_at = case when p_status = 'rewarded' then coalesce(rewarded_at, now()) else null end,
    rewarded_by = case when p_status = 'rewarded' then coalesce(rewarded_by, me.id) else null end,
    updated_at = now()
  where id = x.id returning * into x;
  return x;
end $$;
revoke all on function public.lb_set_referral(uuid, text, text) from public, anon;
grant execute on function public.lb_set_referral(uuid, text, text) to authenticated;

-- ======================================================= lead won / lost
-- Feedback request + referral status when a lead is closed. Never blocks the lead update.
create or replace function public.lb__care_on_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare s lb_care_settings; x record; v_name text;
begin
  begin
    if new.status_category = 'won' then
      select * into s from lb_care_settings where company_id = new.company_id;
      if s.feedback_auto then
        insert into lb_feedback (company_id, lead_id, customer_id, send_after)
        values (new.company_id, new.id, new.customer_id, now() + make_interval(hours => s.feedback_delay_hours))
        on conflict (lead_id) do nothing;
      end if;
      for x in update lb_referrals set status = 'won', updated_at = now() where lead_id = new.id and status in ('pending','lost') returning * loop
        select coalesce(name, phone_e164) into v_name from lb_customers where id = x.referrer_customer_id;
        perform lb__care_notify(new.company_id, new.id, 'referral', '🎁 Referral reward due · ' || coalesce(v_name, 'customer'),
          'Their referral LB-' || new.lead_no || ' is Won. Mark it rewarded in Customer care → Referrals.', '/care/referrals', 'refwon:' || x.id);
      end loop;
    elsif new.status_category in ('lost','invalid') then
      update lb_referrals set status = 'lost', updated_at = now() where lead_id = new.id and status in ('pending','won');
    end if;
  exception when others then
    raise warning 'lb__care_on_lead: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists lb_care_on_lead on public.lb_leads;
create trigger lb_care_on_lead after update of status_category on public.lb_leads
  for each row when (new.status_category is distinct from old.status_category and new.status_category in ('won','lost','invalid'))
  execute function public.lb__care_on_lead();

-- ------------------------------------------------------------- schedule
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lb-feedback-requests';
    perform cron.schedule('lb-feedback-requests', '*/5 * * * *', 'select public.lb_run_feedback()');
  end if;
end $$;

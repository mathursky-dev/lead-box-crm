-- Rental desk: a fixed WhatsApp enquiry flow for rental brokerages (built for LivoraRent Ahmedabad).
-- Off for every company until a lb_rental_desk row with enabled = true exists, so nothing changes
-- for other companies. The chat steps run in the app (src/lib/rental-desk*.ts); this file holds the
-- tables, the admin actions (confirm payment → zone user) and the daily "flat mila?" follow-up job.

-- ---------------------------------------------------------------- settings (one row per company)
create table if not exists public.lb_rental_desk (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  enabled boolean not null default false,
  fee integer not null default 200 check (fee between 1 and 100000),
  upi_id text not null default '',
  upi_name text not null default '',
  qr_url text not null default '',                     -- public https image of the UPI QR
  alert_phone text,                                    -- "flat final" alerts go to this personal WhatsApp number
  alert_template text check (alert_template is null or alert_template ~ '^[a-z0-9_]{1,120}$'),
  alert_template_lang text not null default 'en',
  followup_template text check (followup_template is null or followup_template ~ '^[a-z0-9_]{1,120}$'),
  followup_template_lang text not null default 'en',
  min_followup_budget integer not null default 20000,  -- not-registered tenants below this get no follow-ups
  followup_hours integer not null default 24 check (followup_hours between 6 and 168),
  max_followups integer not null default 30 check (max_followups between 0 and 365),
  max_followups_unreg integer not null default 15 check (max_followups_unreg between 0 and 365),
  zones jsonb not null default '[]'::jsonb,            -- [{no, name, areas[], user_id}]
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);
alter table public.lb_rental_desk enable row level security;
revoke all on public.lb_rental_desk from anon;
grant select, insert, update on public.lb_rental_desk to authenticated;
grant all on public.lb_rental_desk to service_role;
drop policy if exists lb_rental_desk_read on public.lb_rental_desk;
drop policy if exists lb_rental_desk_write on public.lb_rental_desk;
drop policy if exists lb_rental_desk_update on public.lb_rental_desk;
drop policy if exists lb_paid on public.lb_rental_desk;
-- Everyone in the company may read it (the side menu shows "Rental desk" only where it is on).
create policy lb_rental_desk_read on public.lb_rental_desk for select to authenticated
  using (company_id = public.lb_my_company());
create policy lb_rental_desk_write on public.lb_rental_desk for insert to authenticated
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_rental_desk_update on public.lb_rental_desk for update to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id))
  with check (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_paid on public.lb_rental_desk as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- ---------------------------------------------------------------- enquiries (one per chat run)
create table if not exists public.lb_rental_enquiries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  conversation_id uuid not null references public.lb_conversations(id) on delete cascade,
  customer_id uuid not null references public.lb_customers(id) on delete cascade,
  lead_id uuid references public.lb_leads(id) on delete set null,
  stage text not null default 'role' check (stage in ('role','form','fee_offer','awaiting_payment','payment_review','registered','not_registered',
    'fu_ask','fu_broker','fu_rent','fu_happy','details','done','closed')),
  role text check (role in ('tenant','owner','broker','buyer')),
  answers jsonb not null default '{}'::jsonb,
  asking text,
  zone integer,
  budget integer,
  base_stage text check (base_stage in ('registered','not_registered')),
  screenshot_message_id uuid references public.lb_messages(id) on delete set null,
  screenshot_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references public.lb_profiles(id) on delete set null,
  assigned_to uuid references public.lb_profiles(id) on delete set null,
  followups integer not null default 0,
  next_followup_at timestamptz,
  found_broker text, found_rent text, happy text,
  last_in_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_rental_enq_conv_idx on public.lb_rental_enquiries(conversation_id, created_at desc);
create index if not exists lb_rental_enq_company_idx on public.lb_rental_enquiries(company_id, updated_at desc);
create index if not exists lb_rental_enq_due_idx on public.lb_rental_enquiries(next_followup_at) where next_followup_at is not null;
alter table public.lb_rental_enquiries enable row level security;
revoke all on public.lb_rental_enquiries from anon;
grant select on public.lb_rental_enquiries to authenticated;
grant all on public.lb_rental_enquiries to service_role;
drop policy if exists lb_rental_enq_read on public.lb_rental_enquiries;
drop policy if exists lb_paid on public.lb_rental_enquiries;
-- Admins see every enquiry; a zone user sees the ones given to them.
create policy lb_rental_enq_read on public.lb_rental_enquiries for select to authenticated
  using (company_id = public.lb_my_company() and (public.lb_is_admin_of(company_id) or assigned_to = auth.uid()));
create policy lb_paid on public.lb_rental_enquiries as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- One desk step per inbound message, even when Meta redelivers the webhook.
create table if not exists public.lb_rental_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  enquiry_id uuid references public.lb_rental_enquiries(id) on delete cascade,
  inbound_message_id uuid unique references public.lb_messages(id) on delete cascade,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists lb_rental_log_enq_idx on public.lb_rental_log(enquiry_id, created_at desc);
alter table public.lb_rental_log enable row level security;
revoke all on public.lb_rental_log from anon, authenticated;
grant all on public.lb_rental_log to service_role;

-- ---------------------------------------------------------------- helpers
create or replace function public.lb__rental_status(p_company uuid, p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from lb_lead_statuses where company_id = p_company and is_active and lower(name) = lower(p_name) limit 1
$$;

-- The chat's lead: the enquiry's own, else the customer's newest open one.
create or replace function public.lb__rental_lead(e lb_rental_enquiries) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from lb_leads where id = e.lead_id and deleted_at is null),
    (select id from lb_leads where company_id = e.company_id and customer_id = e.customer_id and deleted_at is null
      order by lb__closed(status_category), created_at desc limit 1))
$$;

-- ---------------------------------------------------------------- admin actions
-- Payment checked: give the lead to the zone's user, mark it registered, start daily follow-ups.
-- Returns {zone, user_id, user_name} for the app (it then sends the customer the confirmation).
create or replace function public.lb_rental_confirm_payment(p_id uuid, p_zone integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; d lb_rental_desk; z jsonb; v_user uuid; v_lead uuid; v_status uuid; v_name text; v_zone int;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage not in ('awaiting_payment','payment_review','fee_offer','not_registered') then raise exception 'This enquiry is already %', replace(e.stage, '_', ' '); end if;
  select * into d from lb_rental_desk where company_id = e.company_id;
  v_zone := coalesce(p_zone, e.zone);
  if v_zone is null then raise exception 'Pick the zone first (the area did not match any zone)'; end if;
  select x into z from jsonb_array_elements(coalesce(d.zones, '[]')) x where (x->>'no')::int = v_zone;
  if z is null then raise exception 'Zone % is not set up', v_zone; end if;
  v_user := nullif(z->>'user_id', '')::uuid;
  if v_user is null then raise exception 'No user is set for Zone %. Set it on the Rental desk page.', v_zone; end if;
  select full_name into v_name from lb_profiles where id = v_user and company_id = e.company_id and is_active;
  if v_name is null then raise exception 'The Zone % user is not active', v_zone; end if;

  v_lead := lb__rental_lead(e);
  if v_lead is not null then
    perform lb__assign(v_lead, v_user, auth.uid(), 'Rental desk: ₹' || d.fee || ' paid · Zone ' || v_zone || ' ' || coalesce(z->>'name', ''));
    v_status := lb__rental_status(e.company_id, 'Registered - Requirement Taken');
    if v_status is not null then perform lb__set_status(v_lead, v_status, auth.uid(), 'Rental desk: payment confirmed', null, false); end if;
  end if;
  update lb_rental_enquiries set stage = 'registered', base_stage = 'registered', zone = v_zone, lead_id = coalesce(v_lead, lead_id),
    paid_at = now(), paid_by = auth.uid(), assigned_to = v_user, followups = 0,
    next_followup_at = now() + make_interval(hours => d.followup_hours), updated_at = now()
  where id = e.id;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'paid', 'Zone ' || v_zone || ' → ' || v_name);
  return jsonb_build_object('zone', v_zone, 'zone_name', z->>'name', 'user_id', v_user, 'user_name', v_name, 'lead_id', v_lead);
end $$;

-- Screenshot was wrong: ask the customer again.
create or replace function public.lb_rental_reject_payment(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage <> 'payment_review' then raise exception 'No screenshot is waiting for this enquiry'; end if;
  update lb_rental_enquiries set stage = 'awaiting_payment', updated_at = now() where id = e.id;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'rejected', left(p_reason, 300));
end $$;

create or replace function public.lb_rental_set_zone(p_id uuid, p_zone integer)
returns void language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if p_zone is not null and p_zone not between 1 and 20 then raise exception 'Bad zone'; end if;
  update lb_rental_enquiries set zone = p_zone, updated_at = now() where id = e.id;
end $$;

-- Flat found, entered by an admin (e.g. told on a call). Same record the WhatsApp questions fill.
create or replace function public.lb_rental_mark_found(p_id uuid, p_broker text, p_rent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; v_lead uuid; v_status uuid;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage = 'closed' then raise exception 'Already closed'; end if;
  update lb_rental_enquiries set stage = 'closed', found_broker = left(p_broker, 120), found_rent = left(p_rent, 60), happy = coalesce(happy, '-'),
    closed_at = now(), next_followup_at = null, updated_at = now() where id = e.id;
  v_lead := lb__rental_lead(e);
  if v_lead is not null then
    insert into lb_notes (company_id, customer_id, lead_id, conversation_id, author_id, body)
    values (e.company_id, e.customer_id, v_lead, e.conversation_id, auth.uid(), '🏠 Flat final. Given by: ' || coalesce(p_broker, '-') || ' · Rent: ' || coalesce(p_rent, '-'));
    if e.paid_at is not null then
      v_status := lb__rental_status(e.company_id, 'Deal Closed');
      if v_status is not null then perform lb__set_status(v_lead, v_status, auth.uid(), 'Rental desk: flat final', null, false); end if;
    end if;
  end if;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'found', 'Marked by admin');
  return jsonb_build_object('registered', e.paid_at is not null);
end $$;

revoke all on function public.lb_rental_confirm_payment(uuid, integer) from public, anon;
revoke all on function public.lb_rental_reject_payment(uuid, text) from public, anon;
revoke all on function public.lb_rental_set_zone(uuid, integer) from public, anon;
revoke all on function public.lb_rental_mark_found(uuid, text, text) from public, anon;
grant execute on function public.lb_rental_confirm_payment(uuid, integer) to authenticated;
grant execute on function public.lb_rental_reject_payment(uuid, text) to authenticated;
grant execute on function public.lb_rental_set_zone(uuid, integer) to authenticated;
grant execute on function public.lb_rental_mark_found(uuid, text, text) to authenticated;
revoke all on function public.lb__rental_status(uuid, text) from public, anon, authenticated;
revoke all on function public.lb__rental_lead(lb_rental_enquiries) from public, anon, authenticated;

-- ---------------------------------------------------------------- daily "flat mila?" follow-up
-- Every 15 minutes, 10 AM to 8 PM IST. Inside the 24-hour window it sends Yes/No buttons; outside it
-- the approved follow-up template (body {{1}} = customer name, quick replies "Haan, mil gaya" / "Abhi nahi").
-- Without a template it waits for the customer to write again. Registered tenants: until the flat is
-- found (max_followups); not registered: only budget >= min_followup_budget (max_followups_unreg).
create or replace function public.lb_rental_tick(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_hour int := extract(hour from now() at time zone 'Asia/Kolkata'); n int := 0; v_open boolean; v_body text;
  v_client uuid; v_max int; v_lead uuid;
begin
  if v_hour < 10 or v_hour >= 20 then return 0; end if;
  for r in
    select e.*, d.followup_hours, d.followup_template, d.followup_template_lang, d.max_followups, d.max_followups_unreg, d.min_followup_budget,
      c.name as c_name, c.wa_profile_name, c.wa_opted_out_at, v.number_id, w.provider, w.is_active as num_active
    from lb_rental_enquiries e
    join lb_rental_desk d on d.company_id = e.company_id and d.enabled
    join lb_customers c on c.id = e.customer_id
    join lb_conversations v on v.id = e.conversation_id
    left join lb_wa_numbers w on w.id = v.number_id
    where e.next_followup_at is not null and e.next_followup_at <= now()
      and e.stage in ('registered','not_registered','fu_ask')
    order by e.next_followup_at limit p_limit
    for update of e skip locked
  loop
    v_max := case when coalesce(r.base_stage, 'registered') = 'registered' then r.max_followups else r.max_followups_unreg end;
    if r.wa_opted_out_at is not null or r.followups >= v_max or not coalesce(r.num_active, false)
       or (coalesce(r.base_stage, r.stage) = 'not_registered' and coalesce(r.budget, 0) < r.min_followup_budget) then
      update lb_rental_enquiries set next_followup_at = null, updated_at = now() where id = r.id;
      continue;
    end if;
    v_open := exists (select 1 from lb_messages m where m.conversation_id = r.conversation_id and m.direction = 'in' and m.created_at > now() - interval '23 hours 30 minutes');
    v_client := md5('rental-fu:' || r.id || ':' || r.followups)::uuid;
    v_body := 'Namaste 🙏 LivoraRent se follow-up: kya aapko flat mil gaya?';
    if v_open or r.provider = 'qr' then
      insert into lb_messages (company_id, conversation_id, direction, type, body, payload, client_id, status, next_attempt_at, automated)
      values (r.company_id, r.conversation_id, 'out', 'interactive', v_body || E'\n[Haan, mil gaya] [Abhi nahi]',
        jsonb_build_object('type', 'button', 'body', jsonb_build_object('text', v_body), 'action', jsonb_build_object('buttons', jsonb_build_array(
          jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'rd:fu_yes', 'title', 'Haan, mil gaya')),
          jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'rd:fu_no', 'title', 'Abhi nahi'))))),
        v_client, 'queued', now(), true)
      on conflict (client_id) do nothing;
      update lb_conversations set last_message_at = now(), last_message_preview = left(v_body, 140), updated_at = now() where id = r.conversation_id;
    elsif r.followup_template is not null then
      select coalesce(
        (select id from lb_leads where id = r.lead_id and deleted_at is null),
        (select id from lb_leads where company_id = r.company_id and customer_id = r.customer_id and deleted_at is null
          order by lb__closed(status_category), created_at desc limit 1)) into v_lead;
      perform lb__queue_automated(r.company_id, r.customer_id, v_lead, r.number_id, r.followup_template, r.followup_template_lang,
        jsonb_build_array(coalesce(nullif(trim(r.c_name), ''), nullif(trim(r.wa_profile_name), ''), 'there')), v_client, null, null, null);
    else
      -- No template: try again tomorrow (the customer may write in between).
      update lb_rental_enquiries set next_followup_at = now() + make_interval(hours => r.followup_hours), updated_at = now() where id = r.id;
      continue;
    end if;
    update lb_rental_enquiries set stage = 'fu_ask', base_stage = coalesce(base_stage, case when stage = 'fu_ask' then 'registered' else stage end),
      followups = followups + 1, next_followup_at = now() + make_interval(hours => r.followup_hours), updated_at = now()
    where id = r.id;
    insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (r.company_id, r.id, 'followup', case when v_open then 'buttons' else 'template' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lb_rental_tick(integer) from public, anon, authenticated;
grant execute on function public.lb_rental_tick(integer) to service_role;

select cron.unschedule('lb-rental-tick') where exists (select 1 from cron.job where jobname = 'lb-rental-tick');
select cron.schedule('lb-rental-tick', '*/15 * * * *', 'select public.lb_rental_tick()');

-- Customer care, part 2: loyalty points, service tickets with SLA, AMC / renewal reminders,
-- birthday & anniversary wishes.
--
--   * lb_retention_settings: one row per company (all four features). Every automatic WhatsApp send is OFF by default.
--   * Loyalty: lb_loyalty_ledger (signed points). Points are earned when a lead is Won (on the won value) and when a
--     store order is delivered; a Won lead only earns on the part of its value not already earned through its orders.
--     Leaving Won / cancelling or refunding an order reverses the points. Staff redeem points as a discount on a bill
--     (min points, max % of the bill). Optional: points lapse after N months without any purchase; birthday bonus.
--   * Tickets: lb_tickets + lb_ticket_comments. SLA by priority (first response + resolution hours). A cron marks
--     breaches and alerts the assignee and admins. Customers can raise / reply to tickets from the portal. An inbox
--     complaint (lb_complaints) opens a ticket automatically (setting, on by default; no WhatsApp is sent).
--   * Renewals: lb_renewals (AMC, subscription, warranty, service, insurance...). Reminders N days before the due date
--     create a follow-up for the owner and a notification; optionally a WhatsApp template goes to the customer.
--     "Renewed" moves the due date by the repeat period. Not renewed N days after due -> "lapsed".
--   * Wishes: lb_customers.birthday / anniversary. Every day the owners get one notification with today's list;
--     optionally a WhatsApp template wish is sent (consent + approved template required).
--   * lb_retention_log: one row per daily action (dedupe + history shown in the app).
--
-- Reads are company scoped (lb_my_company()). Writes go through RPCs (or the service role for settings).
-- Existing objects: only new columns on lb_customers and new AFTER triggers on lb_leads / lb_orders / lb_complaints
-- whose bodies can never block the original write. Safe to run more than once.

-- ------------------------------------------------------------ 1. settings
create table if not exists public.lb_retention_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  -- loyalty
  loyalty_enabled boolean not null default false,
  points_per_100 numeric(8,2) not null default 1 check (points_per_100 >= 0 and points_per_100 <= 1000),
  point_value numeric(8,2) not null default 1 check (point_value > 0 and point_value <= 1000),
  min_redeem integer not null default 100 check (min_redeem between 0 and 1000000),
  max_redeem_pct integer not null default 50 check (max_redeem_pct between 1 and 100),
  earn_on_won boolean not null default true,
  earn_on_orders boolean not null default true,
  expiry_months integer check (expiry_months is null or expiry_months between 1 and 120),
  birthday_points integer not null default 0 check (birthday_points between 0 and 100000),
  -- tickets
  ticket_categories text[] not null default '{Installation,Repair,Service,Billing,Delivery,Product quality,Other}',
  sla_response_hours jsonb not null default '{"urgent":1,"high":4,"normal":8,"low":24}'::jsonb,
  sla_resolve_hours jsonb not null default '{"urgent":8,"high":24,"normal":72,"low":168}'::jsonb,
  tickets_from_complaints boolean not null default true,
  portal_tickets boolean not null default true,
  ticket_wa_updates boolean not null default false,
  auto_close_days integer not null default 7 check (auto_close_days between 0 and 90),
  -- renewals
  renewal_remind_days integer[] not null default '{30,7,1,0}',
  renewal_lapse_days integer not null default 30 check (renewal_lapse_days between 0 and 365),
  renewal_auto_wa boolean not null default false,
  renewal_number_id uuid references public.lb_wa_numbers(id) on delete set null,
  renewal_template text,
  renewal_template_lang text,
  -- wishes
  wishes_enabled boolean not null default false,
  wish_notify_owner boolean not null default true,
  wish_hour integer not null default 10 check (wish_hour between 0 and 23),
  wish_number_id uuid references public.lb_wa_numbers(id) on delete set null,
  birthday_template text,
  birthday_template_lang text,
  anniversary_template text,
  anniversary_template_lang text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------- 2. customer dates
alter table public.lb_customers add column if not exists birthday date;
alter table public.lb_customers add column if not exists anniversary date;
create index if not exists lb_customers_birthday on public.lb_customers (company_id, (extract(month from birthday)), (extract(day from birthday))) where birthday is not null;
create index if not exists lb_customers_anniversary on public.lb_customers (company_id, (extract(month from anniversary)), (extract(day from anniversary))) where anniversary is not null;

-- ------------------------------------------------------------- 3. loyalty
create table if not exists public.lb_loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  customer_id uuid not null references public.lb_customers(id) on delete cascade,
  lead_id uuid references public.lb_leads(id) on delete set null,
  order_id uuid references public.lb_orders(id) on delete set null,
  -- won / order: purchase points (and their reversal), redeem, adjust (manual), expire, birthday bonus
  source text not null check (source in ('won','order','redeem','adjust','expire','birthday')),
  points integer not null check (points <> 0),
  amount numeric(14,2),           -- purchase value (earn) or discount in ₹ (redeem); negative on a reversal
  note text,
  ref_key text unique,            -- idempotency key for automatic rows
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_loyalty_customer on public.lb_loyalty_ledger (customer_id, created_at desc);
create index if not exists lb_loyalty_company on public.lb_loyalty_ledger (company_id, created_at desc);
create index if not exists lb_loyalty_lead on public.lb_loyalty_ledger (lead_id) where lead_id is not null;
create index if not exists lb_loyalty_order on public.lb_loyalty_ledger (order_id) where order_id is not null;

-- ------------------------------------------------------------- 4. tickets
create table if not exists public.lb_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity unique,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  customer_id uuid not null references public.lb_customers(id) on delete cascade,
  lead_id uuid references public.lb_leads(id) on delete set null,
  complaint_id uuid references public.lb_complaints(id) on delete set null,
  subject text not null check (length(trim(subject)) between 1 and 200),
  description text,
  category text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  channel text not null default 'staff' check (channel in ('staff','portal','complaint')),
  assigned_to uuid references public.lb_profiles(id) on delete set null,
  response_due_at timestamptz,
  resolve_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  response_breached boolean not null default false,
  resolve_breached boolean not null default false,
  response_alerted_at timestamptz,
  resolve_alerted_at timestamptz,
  resolution text,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_tickets_company on public.lb_tickets (company_id, status, created_at desc);
create index if not exists lb_tickets_customer on public.lb_tickets (customer_id);
create index if not exists lb_tickets_lead on public.lb_tickets (lead_id) where lead_id is not null;
create index if not exists lb_tickets_assignee on public.lb_tickets (assigned_to) where status in ('open','in_progress','waiting');
create index if not exists lb_tickets_sla on public.lb_tickets (resolve_due_at) where status in ('open','in_progress','waiting');
create unique index if not exists lb_tickets_complaint on public.lb_tickets (complaint_id) where complaint_id is not null;

create table if not exists public.lb_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  ticket_id uuid not null references public.lb_tickets(id) on delete cascade,
  kind text not null default 'reply' check (kind in ('reply','internal','customer','event')),
  author_id uuid references public.lb_profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists lb_ticket_comments_ticket on public.lb_ticket_comments (ticket_id, created_at);

-- ------------------------------------------------------------ 5. renewals
create table if not exists public.lb_renewals (
  id uuid primary key default gen_random_uuid(),
  renewal_no bigint generated always as identity unique,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  customer_id uuid not null references public.lb_customers(id) on delete cascade,
  lead_id uuid references public.lb_leads(id) on delete set null,
  product_id uuid references public.lb_products(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 160),
  kind text not null default 'amc' check (kind in ('amc','subscription','warranty','service','insurance','other')),
  start_date date,
  due_date date not null,
  repeat_months integer check (repeat_months is null or repeat_months between 1 and 120),
  amount numeric(14,2) check (amount is null or amount >= 0),
  status text not null default 'active' check (status in ('active','lapsed','cancelled','renewed')),
  assigned_to uuid references public.lb_profiles(id) on delete set null,
  notes text,
  renewed_count integer not null default 0,
  last_renewed_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_renewals_company on public.lb_renewals (company_id, status, due_date);
create index if not exists lb_renewals_customer on public.lb_renewals (customer_id);
create index if not exists lb_renewals_lead on public.lb_renewals (lead_id) where lead_id is not null;

-- ------------------------------------------------------------- 6. run log
create table if not exists public.lb_retention_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  kind text not null check (kind in ('birthday','anniversary','renewal_reminder','renewal_lapsed','points_expired','owner_digest')),
  customer_id uuid references public.lb_customers(id) on delete cascade,
  renewal_id uuid references public.lb_renewals(id) on delete cascade,
  key text not null unique,
  result text not null,           -- sent | notified | skipped:<reason> | done
  message_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists lb_retention_log_company on public.lb_retention_log (company_id, created_at desc);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['lb_retention_settings','lb_loyalty_ledger','lb_tickets','lb_ticket_comments','lb_renewals','lb_retention_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;
create policy lb_retention_settings_read on public.lb_retention_settings for select to authenticated using (company_id = public.lb_my_company());
create policy lb_loyalty_ledger_read on public.lb_loyalty_ledger for select to authenticated using (
  company_id = public.lb_my_company() and public.lb_can_see_customer(customer_id));
create policy lb_tickets_read on public.lb_tickets for select to authenticated using (
  company_id = public.lb_my_company()
  and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.lb_can_see_customer(customer_id)));
create policy lb_ticket_comments_read on public.lb_ticket_comments for select to authenticated using (
  company_id = public.lb_my_company() and exists (select 1 from public.lb_tickets t where t.id = lb_ticket_comments.ticket_id));
create policy lb_renewals_read on public.lb_renewals for select to authenticated using (
  company_id = public.lb_my_company()
  and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.lb_can_see_customer(customer_id)));
create policy lb_retention_log_read on public.lb_retention_log for select to authenticated using (
  company_id = public.lb_my_company() and (customer_id is null or public.lb_can_see_customer(customer_id)));

-- ============================================================== helpers
-- Settings of a company (a default row is created the first time).
create or replace function public.lb__retention(p_company uuid)
returns lb_retention_settings language plpgsql security definer set search_path = public as $$
declare s lb_retention_settings;
begin
  select * into s from lb_retention_settings where company_id = p_company;
  if s.company_id is null then
    insert into lb_retention_settings (company_id) values (p_company) on conflict (company_id) do nothing;
    select * into s from lb_retention_settings where company_id = p_company;
  end if;
  return s;
end $$;
revoke all on function public.lb__retention(uuid) from public, anon, authenticated;

-- Lead owner (or a given user) + company admins.
create or replace function public.lb__ret_notify(p_company uuid, p_user uuid, p_type text, p_title text, p_body text, p_link text, p_key text, p_admins boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from lb_profiles where company_id = p_company and is_active
             and (id = p_user or (p_admins and role = 'company_admin')) loop
    perform lb__notify(p_company, r.id, p_type, p_title, p_body, p_link, p_key || ':' || r.id);
  end loop;
end $$;
revoke all on function public.lb__ret_notify(uuid, uuid, text, text, text, text, text, boolean) from public, anon, authenticated;

-- Body variables ({{1}}, {{2}} ...) of an approved template.
create or replace function public.lb__tpl_var_count(p_company uuid, p_number uuid, p_template text, p_lang text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(m[1]::int), 0)
  from lb_wa_templates t
  join lb_wa_numbers n on n.waba_id = t.waba_id and n.company_id = t.company_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(t.components) = 'array' then t.components else '[]'::jsonb end) c
  cross join lateral regexp_matches(coalesce(c->>'text', ''), '\{\{\s*(\d+)\s*\}\}', 'g') m
  where n.id = p_number and t.company_id = p_company and t.name = p_template and t.language = p_lang and upper(c->>'type') = 'BODY'
$$;
revoke all on function public.lb__tpl_var_count(uuid, uuid, text, text) from public, anon, authenticated;

-- Queue an automatic template message with the usual consent / opt-out / template / cap checks.
-- Returns 'sent' or 'skipped:<reason>'. p_values fill {{1}}..{{n}} in order (extra values dropped, missing ones "-").
create or replace function public.lb__ret_send(p_company uuid, p_customer uuid, p_lead uuid, p_number uuid, p_template text, p_lang text,
  p_values text[], p_key text, out o_result text, out o_message uuid)
language plpgsql security definer set search_path = public as $$
declare chk jsonb; n int; v_params jsonb := '[]'::jsonb; i int;
begin
  if p_number is null or coalesce(p_template, '') = '' or coalesce(p_lang, '') = '' then o_result := 'skipped:no_template'; return; end if;
  chk := lb__send_check(p_company, p_customer, p_number, p_template, p_lang, null);
  if not coalesce((chk->>'ok')::boolean, false) then o_result := 'skipped:' || coalesce(chk->>'reason', 'not_allowed'); return; end if;
  n := lb__tpl_var_count(p_company, p_number, p_template, p_lang);
  for i in 1..n loop
    v_params := v_params || to_jsonb(coalesce(nullif(trim(p_values[i]), ''), '-'));
  end loop;
  o_message := lb__queue_automated(p_company, p_customer, p_lead, p_number, p_template, p_lang, v_params,
    md5('lb_ret:' || p_key)::uuid, null, null, null);
  o_result := 'sent';
end $$;
revoke all on function public.lb__ret_send(uuid, uuid, uuid, uuid, text, text, text[], text) from public, anon, authenticated;

-- Free-form WhatsApp text, only inside the customer's 24-hour window. Returns true when queued.
create or replace function public.lb__ret_text(p_company uuid, p_customer uuid, p_body text, p_client uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_conv lb_conversations; c lb_customers;
begin
  select * into c from lb_customers where id = p_customer;
  if c.id is null or c.wa_opted_out_at is not null then return false; end if;
  select v.* into v_conv from lb_conversations v
  where v.company_id = p_company and v.customer_id = p_customer
    and exists (select 1 from lb_messages m where m.conversation_id = v.id and m.direction = 'in' and m.created_at > now() - interval '23 hours 30 minutes')
  order by v.last_message_at desc nulls last limit 1;
  if v_conv.id is null then return false; end if;
  insert into lb_messages (company_id, conversation_id, direction, type, body, client_id, status, next_attempt_at, automated)
  values (p_company, v_conv.id, 'out', 'text', left(p_body, 4096), p_client, 'queued', now(), true)
  on conflict (client_id) do nothing;
  update lb_conversations set last_message_at = now(), last_message_preview = left(p_body, 140), updated_at = now() where id = v_conv.id;
  return true;
end $$;
revoke all on function public.lb__ret_text(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ============================================================== loyalty
create or replace function public.lb_loyalty_balance(p_customer uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int from lb_loyalty_ledger
  where customer_id = p_customer and ((select auth.uid()) is null or lb_can_see_customer(p_customer))
$$;
revoke all on function public.lb_loyalty_balance(uuid) from public, anon;
grant execute on function public.lb_loyalty_balance(uuid) to authenticated, service_role;

create or replace function public.lb__points_for(p_company uuid, p_amount numeric)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(floor(coalesce(p_amount, 0) * s.points_per_100 / 100), 0)::int from lb_retention_settings s where s.company_id = p_company
$$;
revoke all on function public.lb__points_for(uuid, numeric) from public, anon, authenticated;

-- Points for a Won lead (or reversal when it leaves Won). Never raises.
create or replace function public.lb__loyalty_lead(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l lb_leads; s lb_retention_settings; v_net int; v_amt numeric; v_orders numeric; v_pts int;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null then return; end if;
  select * into s from lb_retention_settings where company_id = l.company_id;
  perform 1 from lb_customers where id = l.customer_id for update;
  select coalesce(sum(points), 0), coalesce(sum(amount), 0) into v_net, v_amt from lb_loyalty_ledger where lead_id = l.id and source = 'won';
  if l.status_category = 'won' and l.deleted_at is null then
    if v_net <> 0 or s.company_id is null or not s.loyalty_enabled or not s.earn_on_won then return; end if;
    select coalesce(sum(amount), 0) into v_orders from lb_loyalty_ledger where lead_id = l.id and source = 'order';
    v_amt := greatest(coalesce(l.won_value, l.expected_value, 0) - v_orders, 0);
    v_pts := lb__points_for(l.company_id, v_amt);
    if v_pts <= 0 then return; end if;
    insert into lb_loyalty_ledger (company_id, customer_id, lead_id, source, points, amount, note)
    values (l.company_id, l.customer_id, l.id, 'won', v_pts, v_amt, 'Purchase · LB-' || l.lead_no);
  elsif v_net > 0 then
    insert into lb_loyalty_ledger (company_id, customer_id, lead_id, source, points, amount, note)
    values (l.company_id, l.customer_id, l.id, 'won', -v_net, -v_amt, 'Reversed · LB-' || l.lead_no || ' is no longer Won');
  end if;
end $$;
revoke all on function public.lb__loyalty_lead(uuid) from public, anon, authenticated;

-- Points for a delivered store order (or reversal on cancel / refund). Never raises.
create or replace function public.lb__loyalty_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o lb_orders; s lb_retention_settings; v_net int; v_amt numeric; v_pts int;
begin
  select * into o from lb_orders where id = p_order;
  if o.id is null or o.customer_id is null then return; end if;
  select * into s from lb_retention_settings where company_id = o.company_id;
  perform 1 from lb_customers where id = o.customer_id for update;
  select coalesce(sum(points), 0), coalesce(sum(amount), 0) into v_net, v_amt from lb_loyalty_ledger where order_id = o.id and source = 'order';
  if o.status = 'delivered' and o.payment_status <> 'refunded' then
    if v_net <> 0 or s.company_id is null or not s.loyalty_enabled or not s.earn_on_orders then return; end if;
    v_pts := lb__points_for(o.company_id, o.total);
    if v_pts <= 0 then return; end if;
    insert into lb_loyalty_ledger (company_id, customer_id, lead_id, order_id, source, points, amount, note)
    values (o.company_id, o.customer_id, o.lead_id, o.id, 'order', v_pts, o.total, 'Order #' || o.order_no);
  elsif v_net > 0 and (o.status = 'cancelled' or o.payment_status = 'refunded') then
    insert into lb_loyalty_ledger (company_id, customer_id, lead_id, order_id, source, points, amount, note)
    values (o.company_id, o.customer_id, o.lead_id, o.id, 'order', -v_net, -v_amt,
      'Reversed · order #' || o.order_no || ' ' || case when o.payment_status = 'refunded' then 'refunded' else 'cancelled' end);
  end if;
end $$;
revoke all on function public.lb__loyalty_order(uuid) from public, anon, authenticated;

-- Staff: redeem points as a discount on a bill. Returns {points, discount, balance}.
create or replace function public.lb_loyalty_redeem(p_customer uuid, p_points integer, p_bill numeric, p_note text, p_lead uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_customers; s lb_retention_settings; v_bal int; v_disc numeric;
begin
  select * into c from lb_customers where id = p_customer for update;
  if c.id is null or c.company_id is distinct from lb_my_company() or not lb_can_see_customer(c.id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not (lb_can('leads.edit') or lb_is_admin_of(c.company_id)) then raise exception 'You do not have permission to redeem points' using errcode = '42501'; end if;
  select * into s from lb_retention_settings where company_id = c.company_id;
  if s.company_id is null or not s.loyalty_enabled then raise exception 'Loyalty points are turned off (Customer care → Settings)'; end if;
  if p_points is null or p_points <= 0 then raise exception 'Enter the points to redeem'; end if;
  v_bal := lb_loyalty_balance(c.id);
  if p_points > v_bal then raise exception 'Only % points available', v_bal; end if;
  if p_points < s.min_redeem then raise exception 'Minimum % points can be redeemed at a time', s.min_redeem; end if;
  v_disc := round(p_points * s.point_value, 2);
  if p_bill is null or p_bill <= 0 then raise exception 'Enter the bill amount'; end if;
  if v_disc > p_bill * s.max_redeem_pct / 100.0 then
    raise exception 'Points can pay at most % percent of the bill (₹%)', s.max_redeem_pct, round(p_bill * s.max_redeem_pct / 100.0, 2);
  end if;
  if p_lead is not null and not exists (select 1 from lb_leads where id = p_lead and customer_id = c.id) then p_lead := null; end if;
  insert into lb_loyalty_ledger (company_id, customer_id, lead_id, source, points, amount, note, created_by)
  values (c.company_id, c.id, p_lead, 'redeem', -p_points, v_disc,
    coalesce(nullif(left(trim(p_note), 300), ''), 'Redeemed on bill of ₹' || p_bill), me.id);
  if p_lead is not null then
    insert into lb_lead_events (company_id, lead_id, actor_id, type, is_work, data)
    values (c.company_id, p_lead, me.id, 'note', true, jsonb_build_object('via', 'loyalty',
      'text', '🎁 Redeemed ' || p_points || ' points = ₹' || v_disc || ' discount'));
  end if;
  return jsonb_build_object('points', p_points, 'discount', v_disc, 'balance', v_bal - p_points);
end $$;
revoke all on function public.lb_loyalty_redeem(uuid, integer, numeric, text, uuid) from public, anon;
grant execute on function public.lb_loyalty_redeem(uuid, integer, numeric, text, uuid) to authenticated;

-- Admin: add / remove points by hand (goodwill, correction).
create or replace function public.lb_loyalty_adjust(p_customer uuid, p_points integer, p_note text)
returns integer language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_customers; v_bal int;
begin
  select * into c from lb_customers where id = p_customer for update;
  if c.id is null or c.company_id is distinct from lb_my_company() or not lb_is_admin_of(c.company_id) then
    raise exception 'Only a company admin can adjust points' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000000 then raise exception 'Enter the points (+ to add, − to remove)'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write a reason'; end if;
  v_bal := lb_loyalty_balance(c.id);
  if v_bal + p_points < 0 then raise exception 'Balance would go below zero (now % points)', v_bal; end if;
  insert into lb_loyalty_ledger (company_id, customer_id, source, points, note, created_by)
  values (c.company_id, c.id, 'adjust', p_points, left(trim(p_note), 300), me.id);
  return v_bal + p_points;
end $$;
revoke all on function public.lb_loyalty_adjust(uuid, integer, text) from public, anon;
grant execute on function public.lb_loyalty_adjust(uuid, integer, text) to authenticated;

-- Top balances of the company (for the Loyalty page).
create or replace function public.lb_loyalty_board(p_limit integer default 100, p_search text default null)
returns table (customer_id uuid, name text, phone_e164 text, balance integer, earned integer, redeemed integer, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone_e164,
         sum(g.points)::int,
         coalesce(sum(g.points) filter (where g.source in ('won','order','birthday') or (g.source = 'adjust' and g.points > 0)), 0)::int,
         coalesce(-sum(g.points) filter (where g.source = 'redeem'), 0)::int,
         max(g.created_at)
  from lb_loyalty_ledger g join lb_customers c on c.id = g.customer_id
  where g.company_id = lb_my_company() and lb_can_see_customer(c.id)
    and (coalesce(trim(p_search), '') = '' or c.name ilike '%' || trim(p_search) || '%'
         or (regexp_replace(p_search, '\D', '', 'g') <> '' and c.phone_e164 like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'))
  group by c.id, c.name, c.phone_e164
  having sum(g.points) <> 0 or coalesce(trim(p_search), '') <> ''
  order by 4 desc, 7 desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;
revoke all on function public.lb_loyalty_board(integer, text) from public, anon;
grant execute on function public.lb_loyalty_board(integer, text) to authenticated;

-- ============================================================== tickets
create or replace function public.lb__ticket_due(p_company uuid, p_priority text, p_from timestamptz, out o_response timestamptz, out o_resolve timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare s lb_retention_settings; r numeric; z numeric;
begin
  select * into s from lb_retention_settings where company_id = p_company;
  r := coalesce(nullif(s.sla_response_hours->>p_priority, '')::numeric,
    case p_priority when 'urgent' then 1 when 'high' then 4 when 'normal' then 8 else 24 end);
  z := coalesce(nullif(s.sla_resolve_hours->>p_priority, '')::numeric,
    case p_priority when 'urgent' then 8 when 'high' then 24 when 'normal' then 72 else 168 end);
  o_response := case when r > 0 then p_from + make_interval(secs => r * 3600) end;
  o_resolve := case when z > 0 then p_from + make_interval(secs => z * 3600) end;
end $$;
revoke all on function public.lb__ticket_due(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.lb__ticket_log(t lb_tickets, p_actor uuid, p_kind text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into lb_ticket_comments (company_id, ticket_id, kind, author_id, body) values (t.company_id, t.id, p_kind, p_actor, left(p_body, 4000))
$$;
revoke all on function public.lb__ticket_log(lb_tickets, uuid, text, text) from public, anon, authenticated;

-- Core create. No permission check. p_lead may be null (latest lead of the customer is used).
create or replace function public.lb__create_ticket(p_company uuid, p_customer uuid, p_lead uuid, p_subject text, p_description text,
  p_category text, p_priority text, p_channel text, p_assign uuid, p_actor uuid, p_complaint uuid default null)
returns lb_tickets language plpgsql security definer set search_path = public as $$
declare t lb_tickets; l lb_leads; c lb_customers; s lb_retention_settings; d record; v_who uuid; v_prio text := coalesce(nullif(p_priority, ''), 'normal');
begin
  select * into c from lb_customers where id = p_customer and company_id = p_company;
  if c.id is null then raise exception 'Customer not found'; end if;
  if v_prio not in ('low','normal','high','urgent') then v_prio := 'normal'; end if;
  if p_lead is not null then select * into l from lb_leads where id = p_lead and customer_id = c.id; end if;
  if l.id is null then
    select * into l from lb_leads where customer_id = c.id and deleted_at is null order by (status_category = 'won') desc, created_at desc limit 1;
  end if;
  v_who := coalesce(p_assign, l.owner_id, p_actor);
  if v_who is not null and not exists (select 1 from lb_profiles where id = v_who and company_id = p_company and is_active) then v_who := null; end if;
  d := lb__ticket_due(p_company, v_prio, now());
  insert into lb_tickets (company_id, customer_id, lead_id, complaint_id, subject, description, category, priority, channel, assigned_to,
    response_due_at, resolve_due_at, created_by)
  values (p_company, c.id, l.id, p_complaint, left(trim(p_subject), 200), nullif(left(trim(p_description), 4000), ''),
    nullif(left(trim(p_category), 60), ''), v_prio, p_channel, v_who, d.o_response, d.o_resolve, p_actor)
  returning * into t;
  perform lb__ticket_log(t, p_actor, 'event', 'Ticket opened' || case p_channel when 'portal' then ' by the customer (portal)' when 'complaint' then ' from a WhatsApp complaint' else '' end);
  if l.id is not null then
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
    values (p_company, l.id, p_actor, l.owner_id, 'note', p_actor is not null, jsonb_build_object('via', 'ticket', 'ticket_id', t.id,
      'text', '🛠️ Ticket TK-' || t.ticket_no || ' opened: ' || t.subject || ' (' || t.priority || ')'));
  end if;
  if v_who is not null and v_who is distinct from p_actor and p_channel <> 'complaint' then
    perform lb__notify(p_company, v_who, 'ticket', '🛠️ Ticket TK-' || t.ticket_no || ' · ' || t.priority,
      coalesce(c.name, c.phone_e164) || ' · ' || t.subject, '/care/tickets/' || t.id, 'tk:' || t.id || ':' || v_who);
  end if;
  if p_channel = 'portal' then
    perform lb__ret_notify(p_company, v_who, 'ticket', '🛠️ New complaint from portal · TK-' || t.ticket_no,
      coalesce(c.name, c.phone_e164) || ' · ' || t.subject, '/care/tickets/' || t.id, 'tkp:' || t.id, true);
  end if;
  select * into s from lb_retention_settings where company_id = p_company;
  if s.ticket_wa_updates and p_channel <> 'complaint' then
    perform lb__ret_text(p_company, c.id, '🛠️ Your request is registered. Ticket no. TK-' || t.ticket_no || ': ' || t.subject
      || E'\nWe will update you soon.', md5('lb_tk_open:' || t.id)::uuid);
  end if;
  return t;
end $$;
revoke all on function public.lb__create_ticket(uuid, uuid, uuid, text, text, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- Staff: create (no id) or edit a ticket. p: {id?, customer_id?, lead_id?, subject, description, category, priority, assigned_to}
create or replace function public.lb_ticket_save(p jsonb)
returns lb_tickets language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); t lb_tickets; c lb_customers; l lb_leads; v_id uuid := nullif(p->>'id', '')::uuid;
  v_assign uuid := nullif(p->>'assigned_to', '')::uuid; v_prio text := coalesce(nullif(p->>'priority', ''), 'normal'); d record; v_changes text[] := '{}';
begin
  if coalesce(trim(p->>'subject'), '') = '' then raise exception 'Subject is required'; end if;
  if v_prio not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
  if v_assign is not null and not exists (select 1 from lb_profiles where id = v_assign and company_id = lb_my_company() and is_active) then
    raise exception 'Pick an active user of this company';
  end if;
  if v_id is null then
    if nullif(p->>'lead_id', '') is not null then
      select * into l from lb_leads where id = (p->>'lead_id')::uuid;
      if l.id is null or l.company_id is distinct from lb_my_company() or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
        raise exception 'Not permitted' using errcode = '42501';
      end if;
      select * into c from lb_customers where id = l.customer_id;
    else
      select * into c from lb_customers where id = nullif(p->>'customer_id', '')::uuid;
      if c.id is null or c.company_id is distinct from lb_my_company() or not lb_can_see_customer(c.id) then
        raise exception 'Customer not found' using errcode = '42501';
      end if;
    end if;
    return lb__create_ticket(c.company_id, c.id, l.id, p->>'subject', p->>'description', p->>'category', v_prio, 'staff', v_assign, me.id);
  end if;

  select * into t from lb_tickets where id = v_id for update;
  if t.id is null or t.company_id is distinct from lb_my_company()
     or not (t.assigned_to = me.id or t.created_by = me.id or lb_can_see_customer(t.customer_id)) then
    raise exception 'Ticket not found' using errcode = '42501';
  end if;
  if t.priority <> v_prio then
    v_changes := v_changes || ('priority ' || t.priority || ' → ' || v_prio);
    d := lb__ticket_due(t.company_id, v_prio, t.created_at);
    t.response_due_at := d.o_response; t.resolve_due_at := d.o_resolve;
    t.response_breached := coalesce(t.first_response_at is null and d.o_response < now(), false);
    t.resolve_breached := coalesce(t.resolved_at is null and d.o_resolve < now(), false);
  end if;
  if t.assigned_to is distinct from v_assign then v_changes := v_changes || 'assignee changed'::text; end if;
  if t.subject <> trim(p->>'subject') then v_changes := v_changes || 'subject edited'::text; end if;
  if coalesce(t.category, '') <> coalesce(trim(p->>'category'), '') then v_changes := v_changes || ('category: ' || coalesce(nullif(trim(p->>'category'), ''), '—')); end if;
  update lb_tickets set subject = left(trim(p->>'subject'), 200), description = nullif(left(trim(p->>'description'), 4000), ''),
    category = nullif(left(trim(p->>'category'), 60), ''), priority = v_prio, assigned_to = v_assign,
    response_due_at = t.response_due_at, resolve_due_at = t.resolve_due_at, response_breached = t.response_breached,
    resolve_breached = t.resolve_breached, updated_at = now()
  where id = t.id returning * into t;
  if array_length(v_changes, 1) > 0 then perform lb__ticket_log(t, me.id, 'event', array_to_string(v_changes, ', ')); end if;
  if v_assign is not null and v_assign <> me.id and 'assignee changed' = any(v_changes) then
    perform lb__notify(t.company_id, v_assign, 'ticket', '🛠️ Ticket TK-' || t.ticket_no || ' assigned to you', t.subject, '/care/tickets/' || t.id, 'tka:' || t.id || ':' || v_assign || ':' || now()::text);
  end if;
  return t;
end $$;
revoke all on function public.lb_ticket_save(jsonb) from public, anon;
grant execute on function public.lb_ticket_save(jsonb) to authenticated;

create or replace function public.lb__ticket_status(t lb_tickets, p_status text, p_note text, p_actor uuid)
returns lb_tickets language plpgsql security definer set search_path = public as $$
declare v_old text := t.status; s lb_retention_settings;
begin
  if p_status not in ('open','in_progress','waiting','resolved','closed') then raise exception 'Invalid status'; end if;
  if v_old = p_status then return t; end if;
  update lb_tickets set status = p_status,
    first_response_at = case when p_actor is not null and p_status <> 'open' then coalesce(first_response_at, now()) else first_response_at end,
    resolved_at = case when p_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
    closed_at = case when p_status = 'closed' then coalesce(closed_at, now()) else null end,
    resolution = case when p_status in ('resolved','closed') and nullif(trim(p_note), '') is not null then left(trim(p_note), 2000) else resolution end,
    updated_at = now()
  where id = t.id returning * into t;
  perform lb__ticket_log(t, p_actor, 'event', 'Status: ' || replace(v_old, '_', ' ') || ' → ' || replace(p_status, '_', ' ')
    || coalesce(E'\n' || nullif(trim(p_note), ''), ''));
  if p_status in ('resolved','closed') and t.complaint_id is not null then
    update lb_complaints set status = 'resolved', resolved_by = p_actor, resolved_at = now(),
      note = coalesce(note || E'\n', '') || 'Resolved in ticket TK-' || t.ticket_no
    where id = t.complaint_id and status = 'open';
  end if;
  if t.lead_id is not null and p_status in ('resolved','closed') and v_old not in ('resolved','closed') then
    insert into lb_lead_events (company_id, lead_id, actor_id, type, is_work, data)
    values (t.company_id, t.lead_id, p_actor, 'note', p_actor is not null, jsonb_build_object('via', 'ticket', 'ticket_id', t.id,
      'text', '✅ Ticket TK-' || t.ticket_no || ' ' || p_status || coalesce(': ' || nullif(trim(p_note), ''), '')));
  end if;
  select * into s from lb_retention_settings where company_id = t.company_id;
  if s.ticket_wa_updates and p_status = 'resolved' and p_actor is not null then
    perform lb__ret_text(t.company_id, t.customer_id, '✅ Your ticket TK-' || t.ticket_no || ' (' || t.subject || ') is resolved.'
      || coalesce(E'\n' || nullif(trim(p_note), ''), '') || E'\nReply here if you still need help.', md5('lb_tk_res:' || t.id || ':' || now()::text)::uuid);
  end if;
  return t;
end $$;
revoke all on function public.lb__ticket_status(lb_tickets, text, text, uuid) from public, anon, authenticated;

create or replace function public.lb_ticket_set_status(p_id uuid, p_status text, p_note text default null)
returns lb_tickets language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); t lb_tickets;
begin
  select * into t from lb_tickets where id = p_id for update;
  if t.id is null or t.company_id is distinct from lb_my_company()
     or not (t.assigned_to = me.id or t.created_by = me.id or lb_can_see_customer(t.customer_id)) then
    raise exception 'Ticket not found' using errcode = '42501';
  end if;
  return lb__ticket_status(t, p_status, p_note, me.id);
end $$;
revoke all on function public.lb_ticket_set_status(uuid, text, text) from public, anon;
grant execute on function public.lb_ticket_set_status(uuid, text, text) to authenticated;

-- Staff reply (kind reply) or internal note. A reply counts as the first response.
create or replace function public.lb_ticket_comment(p_id uuid, p_body text, p_internal boolean default false)
returns lb_ticket_comments language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); t lb_tickets; x lb_ticket_comments;
begin
  select * into t from lb_tickets where id = p_id for update;
  if t.id is null or t.company_id is distinct from lb_my_company()
     or not (t.assigned_to = me.id or t.created_by = me.id or lb_can_see_customer(t.customer_id)) then
    raise exception 'Ticket not found' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write something'; end if;
  insert into lb_ticket_comments (company_id, ticket_id, kind, author_id, body)
  values (t.company_id, t.id, case when p_internal then 'internal' else 'reply' end, me.id, left(trim(p_body), 4000)) returning * into x;
  update lb_tickets set updated_at = now(),
    first_response_at = case when not p_internal then coalesce(first_response_at, now()) else first_response_at end
  where id = t.id;
  return x;
end $$;
revoke all on function public.lb_ticket_comment(uuid, text, boolean) from public, anon;
grant execute on function public.lb_ticket_comment(uuid, text, boolean) to authenticated;

-- Portal: raise a ticket (/p/<token>). Service role only. p: {subject, description, category}
create or replace function public.lb_portal_ticket(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lb_customers; s lb_retention_settings; ok boolean; t lb_tickets;
begin
  select * into c from lb_customers where portal_token = p_token;
  if c.id is null then raise exception 'Link not found'; end if;
  select coalesce((select portal_enabled from lb_care_settings where company_id = c.company_id), true)
     and (select is_active from lb_companies where id = c.company_id) and lb_company_entitled(c.company_id) into ok;
  s := lb__retention(c.company_id);
  if not ok or not s.portal_tickets then raise exception 'Complaints can''t be raised here right now. Please contact us on WhatsApp.'; end if;
  if coalesce(trim(p->>'subject'), '') = '' then raise exception 'Please write what the problem is'; end if;
  if (select count(*) from lb_tickets where customer_id = c.id and status in ('open','in_progress','waiting')) >= 5 then
    raise exception 'You already have 5 open requests. We are working on them.';
  end if;
  if (select count(*) from lb_tickets where customer_id = c.id and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many requests. Please try again later.';
  end if;
  if nullif(p->>'category', '') is not null and not (p->>'category' = any(s.ticket_categories)) then p := p - 'category'; end if;
  t := lb__create_ticket(c.company_id, c.id, null, left(p->>'subject', 200), left(p->>'description', 4000), p->>'category', 'normal', 'portal', null, null);
  return jsonb_build_object('ticket_no', t.ticket_no);
end $$;
revoke all on function public.lb_portal_ticket(text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_portal_ticket(text, jsonb) to service_role;

-- Portal: customer reply on their own ticket. Re-opens a resolved ticket (within 14 days) or a waiting one.
create or replace function public.lb_portal_ticket_reply(p_token text, p_ticket uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c lb_customers; t lb_tickets;
begin
  select * into c from lb_customers where portal_token = p_token;
  if c.id is null then raise exception 'Link not found'; end if;
  select * into t from lb_tickets where id = p_ticket and customer_id = c.id for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Please write a message'; end if;
  if t.status = 'closed' or (t.status = 'resolved' and t.resolved_at < now() - interval '14 days') then
    raise exception 'This ticket is closed. Please raise a new request.';
  end if;
  if (select count(*) from lb_ticket_comments where ticket_id = t.id and kind = 'customer' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many messages. Please try again later.';
  end if;
  insert into lb_ticket_comments (company_id, ticket_id, kind, body) values (t.company_id, t.id, 'customer', left(trim(p_body), 4000));
  if t.status in ('waiting','resolved') then t := lb__ticket_status(t, 'open', 'Customer replied', null);
  else update lb_tickets set updated_at = now() where id = t.id; end if;
  if t.assigned_to is not null then
    perform lb__notify(t.company_id, t.assigned_to, 'ticket', '💬 Customer replied · TK-' || t.ticket_no, left(trim(p_body), 140),
      '/care/tickets/' || t.id, 'tkr:' || t.id || ':' || now()::text);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lb_portal_ticket_reply(text, uuid, text) from public, anon, authenticated;
grant execute on function public.lb_portal_ticket_reply(text, uuid, text) to service_role;

-- Inbox complaint -> ticket (setting). Never blocks the complaint.
create or replace function public.lb__ticket_on_complaint() returns trigger
language plpgsql security definer set search_path = public as $$
declare s lb_retention_settings; v_assign uuid;
begin
  begin
    s := lb__retention(new.company_id);
    if s.tickets_from_complaints then
      select assignee_id into v_assign from lb_conversations where id = new.conversation_id;
      perform lb__create_ticket(new.company_id, new.customer_id, new.lead_id,
        'Complaint: ' || left(coalesce(nullif(trim(new.note), ''), 'matched "' || new.matched || '"', 'WhatsApp complaint'), 150),
        new.note, 'Other', 'high', 'complaint', v_assign, new.created_by, new.id);
    end if;
  exception when others then
    raise warning 'lb__ticket_on_complaint: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists lb_ticket_on_complaint on public.lb_complaints;
create trigger lb_ticket_on_complaint after insert on public.lb_complaints
  for each row execute function public.lb__ticket_on_complaint();

-- ============================================================= renewals
-- Staff: create / edit. p: {id?, lead_id? | customer_id?, title, kind, start_date, due_date, repeat_months, amount, assigned_to, notes, product_id}
create or replace function public.lb_renewal_save(p jsonb)
returns lb_renewals language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); x lb_renewals; c lb_customers; l lb_leads; v_id uuid := nullif(p->>'id', '')::uuid;
  v_assign uuid := nullif(p->>'assigned_to', '')::uuid; v_due date; v_start date; v_rep int; v_amt numeric; v_prod uuid := nullif(p->>'product_id', '')::uuid;
begin
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Title is required (e.g. AC AMC 2026)'; end if;
  if coalesce(p->>'kind', 'amc') not in ('amc','subscription','warranty','service','insurance','other') then raise exception 'Invalid type'; end if;
  begin v_due := (p->>'due_date')::date; exception when others then v_due := null; end;
  if v_due is null then raise exception 'Due date is required'; end if;
  begin v_start := nullif(p->>'start_date', '')::date; exception when others then raise exception 'Invalid start date'; end;
  v_rep := nullif(p->>'repeat_months', '')::int;
  if v_rep is not null and v_rep not between 1 and 120 then raise exception 'Repeat every 1–120 months'; end if;
  v_amt := nullif(p->>'amount', '')::numeric;
  if v_amt is not null and v_amt < 0 then raise exception 'Amount can''t be negative'; end if;
  if v_assign is not null and not exists (select 1 from lb_profiles where id = v_assign and company_id = lb_my_company() and is_active) then
    raise exception 'Pick an active user of this company';
  end if;
  if v_prod is not null and not exists (select 1 from lb_products where id = v_prod and company_id = lb_my_company()) then v_prod := null; end if;
  if not (lb_can('leads.edit') or lb_is_admin_of(lb_my_company())) then raise exception 'You do not have permission to edit' using errcode = '42501'; end if;

  if v_id is null then
    if nullif(p->>'lead_id', '') is not null then
      select * into l from lb_leads where id = (p->>'lead_id')::uuid;
      if l.id is null or l.company_id is distinct from lb_my_company() or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
        raise exception 'Not permitted' using errcode = '42501';
      end if;
      select * into c from lb_customers where id = l.customer_id;
    else
      select * into c from lb_customers where id = nullif(p->>'customer_id', '')::uuid;
      if c.id is null or c.company_id is distinct from lb_my_company() or not lb_can_see_customer(c.id) then
        raise exception 'Customer not found' using errcode = '42501';
      end if;
      select * into l from lb_leads where customer_id = c.id and deleted_at is null order by (status_category = 'won') desc, created_at desc limit 1;
    end if;
    insert into lb_renewals (company_id, customer_id, lead_id, product_id, title, kind, start_date, due_date, repeat_months, amount, assigned_to, notes, created_by)
    values (c.company_id, c.id, l.id, coalesce(v_prod, l.product_id), left(trim(p->>'title'), 160), coalesce(p->>'kind', 'amc'), v_start, v_due, v_rep, v_amt,
      coalesce(v_assign, l.owner_id, me.id), nullif(left(trim(p->>'notes'), 2000), ''), me.id)
    returning * into x;
    if l.id is not null then
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
      values (x.company_id, l.id, me.id, l.owner_id, 'note', true, jsonb_build_object('via', 'renewal', 'renewal_id', x.id,
        'text', '🔁 ' || x.title || ' · due ' || to_char(x.due_date, 'DD Mon YYYY') || coalesce(' · ₹' || x.amount, '')));
    end if;
    return x;
  end if;

  select * into x from lb_renewals where id = v_id for update;
  if x.id is null or x.company_id is distinct from lb_my_company()
     or not (x.assigned_to = me.id or x.created_by = me.id or lb_can_see_customer(x.customer_id)) then
    raise exception 'Renewal not found' using errcode = '42501';
  end if;
  update lb_renewals set title = left(trim(p->>'title'), 160), kind = coalesce(p->>'kind', kind), start_date = v_start, due_date = v_due,
    repeat_months = v_rep, amount = v_amt, assigned_to = v_assign, notes = nullif(left(trim(p->>'notes'), 2000), ''),
    product_id = v_prod, status = case when status = 'lapsed' and v_due >= current_date then 'active' else status end, updated_at = now()
  where id = x.id returning * into x;
  return x;
end $$;
revoke all on function public.lb_renewal_save(jsonb) from public, anon;
grant execute on function public.lb_renewal_save(jsonb) to authenticated;

-- Staff: renewed (moves the due date by repeat_months, or closes a one-time one) / cancel / reactivate.
create or replace function public.lb_renewal_action(p_id uuid, p_action text, p_note text default null, p_amount numeric default null)
returns lb_renewals language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); x lb_renewals; v_txt text;
begin
  select * into x from lb_renewals where id = p_id for update;
  if x.id is null or x.company_id is distinct from lb_my_company()
     or not (x.assigned_to = me.id or x.created_by = me.id or lb_can_see_customer(x.customer_id)) then
    raise exception 'Renewal not found' using errcode = '42501';
  end if;
  if p_action = 'renewed' then
    if x.status = 'cancelled' then raise exception 'This renewal is cancelled'; end if;
    update lb_renewals set renewed_count = renewed_count + 1, last_renewed_at = now(),
      amount = coalesce(p_amount, amount),
      due_date = case when repeat_months is not null then (due_date + make_interval(months => repeat_months))::date else due_date end,
      status = case when repeat_months is not null then 'active' else 'renewed' end,
      notes = case when nullif(trim(p_note), '') is not null then left(coalesce(notes || E'\n', '') || to_char(now(), 'DD Mon YYYY') || ': ' || trim(p_note), 2000) else notes end,
      updated_at = now()
    where id = x.id returning * into x;
    v_txt := '🔁 Renewed: ' || x.title || case when x.status = 'active' then ' · next due ' || to_char(x.due_date, 'DD Mon YYYY') else '' end
      || coalesce(' · ₹' || coalesce(p_amount, x.amount), '');
    -- Close the pending renewal follow-ups of this renewal.
    update lb_followups set status = 'done', completed_at = now(), completed_by = me.id
    where lead_id = x.lead_id and status = 'pending' and note like '🔁 Renewal due%RN-' || x.renewal_no || ' ·%';
  elsif p_action = 'cancel' then
    update lb_renewals set status = 'cancelled', updated_at = now(),
      notes = case when nullif(trim(p_note), '') is not null then left(coalesce(notes || E'\n', '') || 'Cancelled: ' || trim(p_note), 2000) else notes end
    where id = x.id returning * into x;
    v_txt := '🔁 Renewal cancelled: ' || x.title || coalesce(' · ' || nullif(trim(p_note), ''), '');
    update lb_followups set status = 'cancelled', completed_at = now(), completed_by = me.id
    where lead_id = x.lead_id and status = 'pending' and note like '🔁 Renewal due%RN-' || x.renewal_no || ' ·%';
  elsif p_action = 'reactivate' then
    update lb_renewals set status = 'active', updated_at = now() where id = x.id returning * into x;
  else
    raise exception 'Unknown action';
  end if;
  if x.lead_id is not null then
    perform lb__refresh_next_followup(x.lead_id);
    if v_txt is not null then
      insert into lb_lead_events (company_id, lead_id, actor_id, type, is_work, data)
      values (x.company_id, x.lead_id, me.id, 'note', true, jsonb_build_object('via', 'renewal', 'renewal_id', x.id, 'text', v_txt));
    end if;
  end if;
  return x;
end $$;
revoke all on function public.lb_renewal_action(uuid, text, text, numeric) from public, anon;
grant execute on function public.lb_renewal_action(uuid, text, text, numeric) to authenticated;

-- ============================================================ customer dates
create or replace function public.lb_set_customer_dates(p_customer uuid, p_birthday date, p_anniversary date)
returns void language plpgsql security definer set search_path = public as $$
declare c lb_customers;
begin
  select * into c from lb_customers where id = p_customer;
  if c.id is null or c.company_id is distinct from lb_my_company() or not lb_can_see_customer(c.id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not (lb_can('leads.edit') or lb_is_admin_of(c.company_id)) then raise exception 'You do not have permission to edit' using errcode = '42501'; end if;
  if p_birthday > current_date or p_anniversary > current_date then raise exception 'Date can''t be in the future'; end if;
  if p_birthday < date '1900-01-01' or p_anniversary < date '1900-01-01' then raise exception 'Invalid date'; end if;
  update lb_customers set birthday = p_birthday, anniversary = p_anniversary, updated_at = now() where id = c.id;
end $$;
revoke all on function public.lb_set_customer_dates(uuid, date, date) from public, anon;
grant execute on function public.lb_set_customer_dates(uuid, date, date) to authenticated;

-- Does a yearly date (birthday / anniversary) fall on p_day? 29 Feb is celebrated on 28 Feb in other years.
create or replace function public.lb__same_day(p_date date, p_day date)
returns boolean language sql immutable as $$
  select p_date is not null and (
    (extract(month from p_date) = extract(month from p_day) and extract(day from p_date) = extract(day from p_day))
    or (extract(month from p_date) = 2 and extract(day from p_date) = 29 and extract(month from p_day) = 2 and extract(day from p_day) = 28
        and extract(day from (date_trunc('year', p_day) + interval '2 months' - interval '1 day')) = 28))
$$;

-- Birthdays / anniversaries of the next p_days days (for the Wishes page).
create or replace function public.lb_upcoming_wishes(p_days integer default 30)
returns table (customer_id uuid, name text, phone_e164 text, kind text, on_date date, years integer, owner_id uuid)
language sql stable security definer set search_path = public as $$
  with co as (select id, timezone from lb_companies where id = lb_my_company()),
  days as (select ((now() at time zone co.timezone)::date + g) d from co, generate_series(0, least(greatest(coalesce(p_days, 30), 0), 366)) g)
  select c.id, c.name, c.phone_e164, k.kind, days.d,
         case when extract(year from k.dt) > 1904 then (extract(year from days.d) - extract(year from k.dt))::int end,
         (select l.owner_id from lb_leads l where l.customer_id = c.id and l.deleted_at is null order by l.created_at desc limit 1)
  from lb_customers c
  cross join lateral (values ('birthday', c.birthday), ('anniversary', c.anniversary)) k(kind, dt)
  join days on lb__same_day(k.dt, days.d)
  where c.company_id = lb_my_company() and k.dt is not null and lb_can_see_customer(c.id)
  order by days.d, c.name
  limit 1000
$$;
revoke all on function public.lb_upcoming_wishes(integer) from public, anon;
grant execute on function public.lb_upcoming_wishes(integer) to authenticated;

-- =============================================================== triggers
create or replace function public.lb__ret_on_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform lb__loyalty_lead(new.id);
  exception when others then
    raise warning 'lb__ret_on_lead: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists lb_ret_on_lead on public.lb_leads;
create trigger lb_ret_on_lead after update of status_category, deleted_at on public.lb_leads
  for each row when ((new.status_category is distinct from old.status_category and (new.status_category = 'won' or old.status_category = 'won'))
                     or (new.deleted_at is distinct from old.deleted_at and new.status_category = 'won'))
  execute function public.lb__ret_on_lead();

create or replace function public.lb__ret_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform lb__loyalty_order(new.id);
  exception when others then
    raise warning 'lb__ret_on_order: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists lb_ret_on_order on public.lb_orders;
create trigger lb_ret_on_order after insert or update of status, payment_status on public.lb_orders
  for each row when (new.status in ('delivered','cancelled') or new.payment_status = 'refunded')
  execute function public.lb__ret_on_order();

-- ============================================================ scheduled job
-- Every 5 minutes: ticket SLA alerts + auto close. Once a day per company (after wish_hour, company time):
-- birthday / anniversary wishes, renewal reminders, lapsed renewals, points expiry.
create or replace function public.lb_run_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; tk lb_tickets; co record; s lb_retention_settings; r record; v_today date; v_key text; v_result text; v_msg uuid;
  n_sla int := 0; n_close int := 0; n_wish int := 0; n_ren int := 0; v_owner uuid; v_title text; v_fu uuid; v_url text;
begin
  -- 1. SLA: first response
  for t in
    select k.*, c.name c_name, c.phone_e164 from lb_tickets k join lb_customers c on c.id = k.customer_id
    where k.status = 'open' and k.first_response_at is null and k.response_due_at < now() and k.response_alerted_at is null
    order by k.response_due_at limit 500 for update of k skip locked
  loop
    update lb_tickets set response_breached = true, response_alerted_at = now() where id = t.id;
    perform lb__ret_notify(t.company_id, t.assigned_to, 'ticket', '⏰ SLA: no response yet · TK-' || t.ticket_no,
      coalesce(t.c_name, t.phone_e164) || ' · ' || t.subject, '/care/tickets/' || t.id, 'tksla1:' || t.id, true);
    n_sla := n_sla + 1;
  end loop;
  -- 2. SLA: resolution
  for t in
    select k.*, c.name c_name, c.phone_e164 from lb_tickets k join lb_customers c on c.id = k.customer_id
    where k.status in ('open','in_progress','waiting') and k.resolve_due_at < now() and k.resolve_alerted_at is null
    order by k.resolve_due_at limit 500 for update of k skip locked
  loop
    update lb_tickets set resolve_breached = true, resolve_alerted_at = now() where id = t.id;
    perform lb__ret_notify(t.company_id, t.assigned_to, 'ticket', '🚨 SLA breached · TK-' || t.ticket_no || ' not resolved',
      coalesce(t.c_name, t.phone_e164) || ' · ' || t.subject, '/care/tickets/' || t.id, 'tksla2:' || t.id, true);
    n_sla := n_sla + 1;
  end loop;
  -- 3. Auto close resolved tickets
  for tk in
    select k.* from lb_tickets k join lb_retention_settings s2 on s2.company_id = k.company_id
    where k.status = 'resolved' and s2.auto_close_days > 0 and k.resolved_at < now() - make_interval(days => s2.auto_close_days)
    limit 500 for update of k skip locked
  loop
    perform lb__ticket_status(tk, 'closed', 'Closed automatically', null);
    n_close := n_close + 1;
  end loop;

  -- 4. Daily work per company
  v_url := (select rtrim(value, '/') from lb_settings where key = 'app_url');
  for co in
    select c.id, c.name, c.timezone, (now() at time zone c.timezone) as lnow from lb_companies c
    where c.is_active and lb_company_entitled(c.id)
      and (exists (select 1 from lb_retention_settings x where x.company_id = c.id)
           or exists (select 1 from lb_customers x where x.company_id = c.id and (x.birthday is not null or x.anniversary is not null))
           or exists (select 1 from lb_renewals x where x.company_id = c.id and x.status = 'active'))
  loop
    begin
      s := lb__retention(co.id);
      if extract(hour from co.lnow) < s.wish_hour then continue; end if;
      v_today := co.lnow::date;
      if exists (select 1 from lb_retention_log where key = 'day:' || co.id || ':' || v_today) then continue; end if;
      insert into lb_retention_log (company_id, kind, key, result) values (co.id, 'owner_digest', 'day:' || co.id || ':' || v_today, 'done');

      -- 4a. wishes
      for r in
        select c.id, c.name, c.phone_e164, k.kind,
          (select l.id from lb_leads l where l.customer_id = c.id and l.deleted_at is null order by l.created_at desc limit 1) lead_id,
          (select l.owner_id from lb_leads l where l.customer_id = c.id and l.deleted_at is null order by l.created_at desc limit 1) owner_id
        from lb_customers c
        cross join lateral (values ('birthday', c.birthday), ('anniversary', c.anniversary)) k(kind, dt)
        where c.company_id = co.id and k.dt is not null and lb__same_day(k.dt, v_today)
        limit 2000
      loop
        v_key := r.kind || ':' || r.id || ':' || extract(year from v_today);
        if exists (select 1 from lb_retention_log where key = v_key) then continue; end if;
        v_result := null; v_msg := null;
        if s.wishes_enabled then
          if r.kind = 'birthday' then
            select o_result, o_message into v_result, v_msg from lb__ret_send(co.id, r.id, r.lead_id, s.wish_number_id, s.birthday_template, s.birthday_template_lang,
              array[coalesce(nullif(trim(r.name), ''), 'there'), co.name], v_key);
          else
            select o_result, o_message into v_result, v_msg from lb__ret_send(co.id, r.id, r.lead_id, s.wish_number_id, s.anniversary_template, s.anniversary_template_lang,
              array[coalesce(nullif(trim(r.name), ''), 'there'), co.name], v_key);
          end if;
        end if;
        insert into lb_retention_log (company_id, kind, customer_id, key, result, message_id)
        values (co.id, r.kind, r.id, v_key, coalesce(v_result, 'notified'), v_msg);
        if r.kind = 'birthday' and s.loyalty_enabled and s.birthday_points > 0 then
          insert into lb_loyalty_ledger (company_id, customer_id, source, points, note, ref_key)
          values (co.id, r.id, 'birthday', s.birthday_points, '🎂 Birthday bonus ' || extract(year from v_today), 'bday:' || r.id || ':' || extract(year from v_today))
          on conflict (ref_key) do nothing;
        end if;
        n_wish := n_wish + 1;
      end loop;
      if s.wish_notify_owner then
        for r in
          select x.owner_id, count(*) n, string_agg(coalesce(nullif(x.name, ''), x.phone_e164) || case x.kind when 'birthday' then ' 🎂' else ' 💍' end, ', ' order by x.name) who
          from (
            select c.name, c.phone_e164, k.kind,
              coalesce((select l.owner_id from lb_leads l where l.customer_id = c.id and l.deleted_at is null order by l.created_at desc limit 1),
                       (select p.id from lb_profiles p where p.company_id = co.id and p.role = 'company_admin' and p.is_active order by p.created_at limit 1)) owner_id
            from lb_customers c
            cross join lateral (values ('birthday', c.birthday), ('anniversary', c.anniversary)) k(kind, dt)
            where c.company_id = co.id and k.dt is not null and lb__same_day(k.dt, v_today)
          ) x where x.owner_id is not null group by x.owner_id
        loop
          perform lb__notify(co.id, r.owner_id, 'wishes', '🎉 ' || r.n || ' customer' || case when r.n = 1 then '' else 's' end || ' to wish today',
            left(r.who, 300), '/care/wishes', 'wish:' || r.owner_id || ':' || v_today);
        end loop;
      end if;

      -- 4b. renewal reminders
      for r in
        select x.*, c.name c_name, c.phone_e164, (x.due_date - v_today) as days_left
        from lb_renewals x join lb_customers c on c.id = x.customer_id
        where x.company_id = co.id and x.status = 'active' and (x.due_date - v_today) = any(s.renewal_remind_days)
        limit 2000
      loop
        v_key := 'ren:' || r.id || ':' || r.due_date || ':' || r.days_left;
        if exists (select 1 from lb_retention_log where key = v_key) then continue; end if;
        v_owner := coalesce(r.assigned_to, (select owner_id from lb_leads where id = r.lead_id));
        v_title := '🔁 Renewal due ' || case when r.days_left = 0 then 'today' when r.days_left = 1 then 'tomorrow' else 'in ' || r.days_left || ' days' end
          || ' · ' || r.title;
        v_fu := null;
        if r.lead_id is not null and v_owner is not null and exists (select 1 from lb_leads where id = r.lead_id and deleted_at is null)
           and not exists (select 1 from lb_followups f where f.lead_id = r.lead_id and f.status = 'pending' and f.note like '🔁 Renewal due%RN-' || r.renewal_no || ' ·%') then
          insert into lb_followups (company_id, lead_id, assigned_to, due_at, note, action_type)
          values (co.id, r.lead_id, v_owner, (v_today::timestamp + interval '11 hours') at time zone co.timezone,
            left('🔁 Renewal due ' || to_char(r.due_date, 'DD Mon YYYY') || ' · RN-' || r.renewal_no || ' · ' || r.title || coalesce(' · ₹' || r.amount, ''), 500), 'call')
          returning id into v_fu;
          perform lb__refresh_next_followup(r.lead_id);
        end if;
        perform lb__ret_notify(co.id, v_owner, 'renewal', v_title, coalesce(r.c_name, r.phone_e164) || ' · due ' || to_char(r.due_date, 'DD Mon YYYY')
          || coalesce(' · ₹' || r.amount, ''), '/care/renewals?id=' || r.id, v_key, v_owner is null);
        v_result := null; v_msg := null;
        if s.renewal_auto_wa then
          select o_result, o_message into v_result, v_msg from lb__ret_send(co.id, r.customer_id, r.lead_id, s.renewal_number_id, s.renewal_template, s.renewal_template_lang,
            array[coalesce(nullif(trim(r.c_name), ''), 'there'), r.title, to_char(r.due_date, 'DD Mon YYYY'), co.name, coalesce(r.amount::text, '')], v_key);
        end if;
        insert into lb_retention_log (company_id, kind, customer_id, renewal_id, key, result, message_id)
        values (co.id, 'renewal_reminder', r.customer_id, r.id, v_key, coalesce(v_result, 'notified'), v_msg);
        n_ren := n_ren + 1;
      end loop;

      -- 4c. lapsed renewals
      for r in
        select x.* from lb_renewals x where x.company_id = co.id and x.status = 'active' and x.due_date < v_today - s.renewal_lapse_days
        limit 2000
      loop
        update lb_renewals set status = 'lapsed', updated_at = now() where id = r.id;
        v_key := 'lapse:' || r.id || ':' || r.due_date;
        insert into lb_retention_log (company_id, kind, customer_id, renewal_id, key, result)
        values (co.id, 'renewal_lapsed', r.customer_id, r.id, v_key, 'done') on conflict (key) do nothing;
        perform lb__ret_notify(co.id, r.assigned_to, 'renewal', '⚠️ Renewal lapsed · ' || r.title,
          'Due ' || to_char(r.due_date, 'DD Mon YYYY') || ', not renewed', '/care/renewals?id=' || r.id, v_key, r.assigned_to is null);
      end loop;

      -- 4d. points expiry (no purchase for expiry_months)
      if s.loyalty_enabled and s.expiry_months is not null then
        for r in
          select g.customer_id, sum(g.points)::int bal from lb_loyalty_ledger g
          where g.company_id = co.id group by g.customer_id
          having sum(g.points) > 0
             and max(g.created_at) filter (where g.source in ('won','order') and g.points > 0) < now() - make_interval(months => s.expiry_months)
             and max(g.created_at) < now() - make_interval(months => s.expiry_months)
          limit 5000
        loop
          insert into lb_loyalty_ledger (company_id, customer_id, source, points, note, ref_key)
          values (co.id, r.customer_id, 'expire', -r.bal, 'Expired · no purchase in ' || s.expiry_months || ' months', 'exp:' || r.customer_id || ':' || v_today)
          on conflict (ref_key) do nothing;
          insert into lb_retention_log (company_id, kind, customer_id, key, result)
          values (co.id, 'points_expired', r.customer_id, 'exp:' || r.customer_id || ':' || v_today, 'done') on conflict (key) do nothing;
        end loop;
      end if;
    exception when others then
      raise warning 'lb_run_retention company %: %', co.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('sla_alerts', n_sla, 'closed', n_close, 'wishes', n_wish, 'renewal_reminders', n_ren);
end $$;
revoke all on function public.lb_run_retention() from public, anon, authenticated;

-- ------------------------------------------------------------- schedule
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lb-retention';
    perform cron.schedule('lb-retention', '*/5 * * * *', 'select public.lb_run_retention()');
  end if;
end $$;

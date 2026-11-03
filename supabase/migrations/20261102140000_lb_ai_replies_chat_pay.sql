-- Lead Box CRM · AI reply suggestions (auto drafts + one-click send) and
-- WhatsApp catalog + payment inside the inbox chat.
--
-- 1. lb_companies.ai_auto_suggest     AI drafts 3 replies as soon as a customer writes (default on)
-- 2. lb_ai_reply_cache                 one set of AI replies per customer message (shared by agents, saves AI calls)
-- 3. lb_stores                         upi_id, upi_name, wa_catalog_id, wa_pay_config
-- 4. lb_orders                         pay_token, pay_method, paid_at, upi_utr
-- 5. lb_payment_links.order_id         Razorpay link for an order; paid link => order paid (trigger)
-- 6. lb_enqueue_rich()                 agent sends product cards / catalog / WhatsApp Pay messages (same checks as normal send)
-- 7. lb_chat_order()                   agent creates an order from the chat (prices always from lb_products)
-- 8. lb_order_paid() / lb_order_utr()  service role: WhatsApp Pay webhook, customer UTR on /o/<token>
--
-- Safe to run more than once. Needs the Store SQL (20261102000063) and the
-- Quotes & Payments SQL (20261102000053) first.

-- ------------------------------------------------------------ 1. AI setting
alter table public.lb_companies add column if not exists ai_auto_suggest boolean not null default true;

-- ---------------------------------------------------------- 2. AI cache
create table if not exists public.lb_ai_reply_cache (
  conversation_id uuid primary key references public.lb_conversations(id) on delete cascade,
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  upto_message_id uuid not null,            -- the customer message these replies answer
  replies jsonb not null default '[]'::jsonb, -- [{label, text}]
  model text,
  used_label text,                          -- which one the agent sent
  used_at timestamptz,
  used_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.lb_ai_reply_cache enable row level security;
revoke all on public.lb_ai_reply_cache from anon, authenticated;
grant all on public.lb_ai_reply_cache to service_role;

-- ------------------------------------------------------- 3. store payments
alter table public.lb_stores add column if not exists upi_id text;
alter table public.lb_stores add column if not exists upi_name text;
alter table public.lb_stores add column if not exists wa_catalog_id text;
alter table public.lb_stores add column if not exists wa_pay_config text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lb_stores_upi_chk') then
    alter table public.lb_stores add constraint lb_stores_upi_chk
      check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9.-]{1,63}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lb_stores_catalog_chk') then
    alter table public.lb_stores add constraint lb_stores_catalog_chk
      check ((wa_catalog_id is null or wa_catalog_id ~ '^[0-9]{5,30}$') and (wa_pay_config is null or length(wa_pay_config) between 1 and 60));
  end if;
end $$;

-- ---------------------------------------------------------- 4. order pay
alter table public.lb_orders add column if not exists pay_token text;
alter table public.lb_orders add column if not exists pay_method text;
alter table public.lb_orders add column if not exists paid_at timestamptz;
alter table public.lb_orders add column if not exists upi_utr text;
create unique index if not exists lb_orders_pay_token on public.lb_orders (pay_token) where pay_token is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lb_orders_pay_method_chk') then
    alter table public.lb_orders add constraint lb_orders_pay_method_chk
      check (pay_method is null or pay_method in ('upi','razorpay','whatsapp_pay','cod'));
  end if;
end $$;

-- ------------------------------------------------- 5. Razorpay link -> order
alter table public.lb_payment_links add column if not exists order_id uuid references public.lb_orders(id) on delete set null;
create index if not exists lb_payment_links_order on public.lb_payment_links (order_id) where order_id is not null;

create or replace function public.lb__payment_link_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null and new.status = 'paid' and old.status is distinct from 'paid' then
    update lb_orders set payment_status = 'paid', paid_at = coalesce(paid_at, now()), pay_method = coalesce(pay_method, 'razorpay'), updated_at = now()
    where id = new.order_id and payment_status = 'unpaid';
  end if;
  return new;
end $$;
revoke all on function public.lb__payment_link_paid() from public, anon, authenticated;
drop trigger if exists lb_payment_link_paid on public.lb_payment_links;
create trigger lb_payment_link_paid after update of status on public.lb_payment_links
  for each row execute function public.lb__payment_link_paid();

-- ------------------------------------------- 6. rich messages from an agent
-- p_type: 'interactive' (WhatsApp catalog product / product_list / order_details) or 'image' (photo by public link).
-- Same checks as lb_enqueue_message: can see chat, number access, number active, send permission, 24h window.
create or replace function public.lb_enqueue_rich(p_conv uuid, p_client_id uuid, p_type text, p_body text, p_payload jsonb)
returns lb_messages language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_conversations; m lb_messages;
begin
  select * into m from lb_messages where client_id = p_client_id;
  if m.id is not null then return m; end if;
  select * into c from lb_conversations where id = p_conv;
  if c.id is null or not lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not lb_can('chats.send') then raise exception 'You do not have permission to send WhatsApp messages' using errcode = '42501'; end if;
  if c.assignee_id is distinct from me.id and not lb_can_use_number(c.number_id) then
    raise exception 'You do not have access to this business number' using errcode = '42501';
  end if;
  if not exists (select 1 from lb_wa_numbers where id = c.number_id and is_active) then raise exception 'This business number is disabled'; end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then
    raise exception 'The 24-hour customer service window is closed. Send an approved template instead.';
  end if;
  if p_type not in ('interactive','image') then raise exception 'Unsupported message type'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Message content missing'; end if;
  if p_type = 'image' and coalesce(p_payload->>'link', '') !~ '^https://' then raise exception 'Image link missing'; end if;
  if p_type = 'interactive' and coalesce(p_payload->>'type', '') not in ('product','product_list','order_details') then raise exception 'Unsupported interactive message'; end if;
  if length(p_payload::text) > 20000 then raise exception 'Message is too big'; end if;

  insert into lb_messages (company_id, conversation_id, direction, type, body, payload, client_id, status, next_attempt_at, sent_by)
  values (c.company_id, p_conv, 'out', p_type, nullif(left(coalesce(p_body, ''), 4000), ''), p_payload, p_client_id, 'queued', now(), me.id)
  on conflict (client_id) do nothing
  returning * into m;
  if m.id is null then select * into m from lb_messages where client_id = p_client_id; return m; end if;
  update lb_conversations set last_message_at = now(), updated_at = now(),
    last_message_preview = left(coalesce(m.body, '[' || p_type || ']'), 140),
    status = case when status = 'resolved' then 'open' else status end
  where id = p_conv;
  return m;
end $$;
revoke all on function public.lb_enqueue_rich(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.lb_enqueue_rich(uuid, uuid, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------- 7. order from the chat
-- p_items: [{product_id, qty}]. Prices come from lb_products (active, priced).
create or replace function public.lb_chat_order(p_conv uuid, p_items jsonb, p_delivery numeric, p_note text, p_address text)
returns lb_orders language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_conversations; v_items jsonb; v_want int; v_got int; o lb_orders;
begin
  select * into c from lb_conversations where id = p_conv;
  if c.id is null or not lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not lb_can('chats.send') then raise exception 'You do not have permission to send WhatsApp messages' using errcode = '42501'; end if;
  if coalesce(p_delivery, 0) < 0 or coalesce(p_delivery, 0) > 100000 then raise exception 'Invalid delivery charge'; end if;

  with want as (
    select (i->>'product_id')::uuid pid, sum(least(greatest(coalesce((i->>'qty')::int, 0), 0), 999)) qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
    where (i->>'product_id') ~ '^[0-9a-f-]{36}$'
    group by 1 having sum(coalesce((i->>'qty')::int, 0)) > 0
  )
  select (select count(*) from want), count(pr.id),
         coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'price', pr.price, 'qty', w.qty)
           order by pr.sort_order, pr.name) filter (where pr.id is not null), '[]'::jsonb)
    into v_want, v_got, v_items
  from want w
  left join lb_products pr on pr.id = w.pid and pr.company_id = c.company_id and pr.is_active and pr.price is not null;
  if v_want = 0 then raise exception 'Pick at least one product'; end if;
  if v_want > 50 then raise exception 'Too many items in one order'; end if;
  if v_got < v_want then raise exception 'Some products have no price or are inactive'; end if;

  o := lb__create_order(c.company_id, 'manual', (select phone_e164 from lb_customers where id = c.customer_id), null,
    left(p_address, 500), left(p_note, 1000), v_items, coalesce(p_delivery, 0), 'WhatsApp', null, c.customer_id, null);
  update lb_orders set pay_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    updated_by = me.id
  where id = o.id returning * into o;
  if c.lead_id is null then update lb_conversations set lead_id = o.lead_id where id = c.id; end if;
  return o;
end $$;
revoke all on function public.lb_chat_order(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function public.lb_chat_order(uuid, jsonb, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------- 8. payment updates (service role)
-- WhatsApp Pay (order_details) webhook: reference_id = first 32 chars of lb_orders.pay_token (Meta allows 35).
create or replace function public.lb_order_paid(p_token text, p_method text, p_ref text)
returns boolean language plpgsql security definer set search_path = public as $$
declare o lb_orders;
begin
  if coalesce(length(p_token), 0) < 32 then return false; end if;
  select * into o from lb_orders where pay_token = p_token or left(pay_token, 32) = p_token limit 1 for update;
  if o.id is null or o.payment_status <> 'unpaid' then return false; end if;
  update lb_orders set payment_status = 'paid', paid_at = now(), pay_method = coalesce(p_method, pay_method),
    staff_note = concat_ws(E'\n', staff_note, 'Paid via ' || coalesce(p_method, 'online') || coalesce(' · ref ' || nullif(p_ref, ''), '')),
    updated_at = now()
  where id = o.id;
  if o.lead_id is not null then
    insert into lb_lead_events (company_id, lead_id, type, data)
    values (o.company_id, o.lead_id, 'note', jsonb_build_object('via', 'order', 'order_id', o.id,
      'text', '✅ Order #' || o.order_no || ' paid ' || lb__inr(o.total) || ' (' || coalesce(p_method, 'online') || ')'));
  end if;
  perform lb__notify(o.company_id, p.id, 'order', 'Order #' || o.order_no || ' paid · ' || lb__inr(o.total),
      coalesce(o.name, o.phone_e164), '/store?order=' || o.id, 'orderpaid:' || o.id || ':' || p.id)
  from lb_profiles p
  where p.company_id = o.company_id and p.is_active
    and (p.role = 'company_admin' or p.id = (select owner_id from lb_leads where id = o.lead_id));
  return true;
end $$;

-- Customer says "I paid by UPI" on /o/<token> with the 12-digit UTR. Staff verify and mark paid.
create or replace function public.lb_order_utr(p_token text, p_utr text)
returns boolean language plpgsql security definer set search_path = public as $$
declare o lb_orders;
begin
  if p_utr !~ '^[0-9]{12}$' then raise exception 'Enter the 12-digit UTR'; end if;
  select * into o from lb_orders where pay_token = p_token for update;
  if o.id is null or o.payment_status <> 'unpaid' then return false; end if;
  if o.upi_utr is not distinct from p_utr then return true; end if;
  update lb_orders set upi_utr = p_utr, pay_method = 'upi',
    staff_note = concat_ws(E'\n', staff_note, 'Customer says paid by UPI · UTR ' || p_utr || ' (check your bank, then mark Paid)'),
    updated_at = now()
  where id = o.id;
  perform lb__notify(o.company_id, p.id, 'order', 'Check UPI payment · Order #' || o.order_no,
      'UTR ' || p_utr || ' · ' || lb__inr(o.total), '/store?order=' || o.id, 'orderutr:' || o.id || ':' || p_utr || ':' || p.id)
  from lb_profiles p
  where p.company_id = o.company_id and p.is_active
    and (p.role = 'company_admin' or p.id = (select owner_id from lb_leads where id = o.lead_id));
  return true;
end $$;
revoke all on function public.lb_order_paid(text, text, text), public.lb_order_utr(text, text) from public, anon, authenticated;
grant execute on function public.lb_order_paid(text, text, text), public.lb_order_utr(text, text) to service_role;

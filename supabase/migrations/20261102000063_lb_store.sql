-- WhatsApp catalog & mini-store.
--
--   * lb_products gets store columns (price, MRP, photo, description, SKU, category, unit, show in store, in stock).
--   * lb_stores: one shareable mini-store per company at /s/<code> (link customers open from WhatsApp).
--   * lb_orders: orders from the mini-store, from WhatsApp cart messages (Meta catalog) or added by staff.
--     Every order lands on the customer's open lead (or a new lead), with a timeline note and a notification.
--   * RPCs: lb_place_order (public store checkout, service role only), lb_ingest_wa_order (WhatsApp cart
--     order from the webhook, service role only), lb_set_order (staff: status / payment / note).
--   * Public bucket "lb-store" for product photos ({company_id}/{uuid}.ext).
--
-- Reads are company scoped (lb_my_company(), follows the Super Admin company switcher). Writes go through
-- server actions (service role, filtered by company_id) or the RPCs above. Safe to run more than once.

-- ------------------------------------------------------------ 1. products
alter table public.lb_products add column if not exists price numeric(12,2);
alter table public.lb_products add column if not exists mrp numeric(12,2);
alter table public.lb_products add column if not exists description text not null default '';
alter table public.lb_products add column if not exists image_path text;
alter table public.lb_products add column if not exists sku text;
alter table public.lb_products add column if not exists category text not null default '';
alter table public.lb_products add column if not exists unit text not null default '';
alter table public.lb_products add column if not exists in_store boolean not null default false;
alter table public.lb_products add column if not exists in_stock boolean not null default true;
alter table public.lb_products add column if not exists sort_order integer not null default 100;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lb_products_price_chk') then
    alter table public.lb_products add constraint lb_products_price_chk
      check ((price is null or price >= 0) and (mrp is null or mrp >= 0));
  end if;
end $$;
-- SKU = "Content ID / Retailer ID" of the item in the Meta catalog, so WhatsApp cart orders map to products.
create unique index if not exists lb_products_sku on public.lb_products (company_id, sku) where sku is not null;

-- --------------------------------------------------------------- 2. store
create table if not exists public.lb_stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.lb_companies(id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  tagline text not null default '',
  color text not null default '#16a34a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- WhatsApp number (digits with country code) the customer messages after ordering.
  wa_phone text check (wa_phone is null or wa_phone ~ '^[1-9][0-9]{6,14}$'),
  min_order numeric(12,2) not null default 0 check (min_order >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  free_delivery_above numeric(12,2) check (free_delivery_above is null or free_delivery_above >= 0),
  ask_address boolean not null default true,
  checkout_note text not null default '',
  thank_you text not null default 'Thank you! Your order is placed. We will confirm it on WhatsApp shortly.',
  source_id uuid references public.lb_sources(id) on delete set null,
  is_active boolean not null default true,
  orders_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- 3. orders
create table if not exists public.lb_orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  channel text not null default 'store' check (channel in ('store','whatsapp','manual')),
  customer_id uuid references public.lb_customers(id) on delete set null,
  lead_id uuid references public.lb_leads(id) on delete set null,
  message_id uuid references public.lb_messages(id) on delete set null,
  name text,
  phone_e164 text not null,
  address text,
  note text,
  -- [{product_id, name, sku, price, qty, amount}]
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'new' check (status in ('new','confirmed','packed','shipped','delivered','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);
create index if not exists lb_orders_company on public.lb_orders (company_id, created_at desc);
create index if not exists lb_orders_lead on public.lb_orders (lead_id);
create index if not exists lb_orders_customer on public.lb_orders (customer_id);
create unique index if not exists lb_orders_message on public.lb_orders (message_id) where message_id is not null;

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['lb_stores','lb_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;
create policy lb_stores_read on public.lb_stores for select to authenticated using (company_id = public.lb_my_company());
-- An order is visible when its lead is (lb_leads RLS applies inside the subquery); orders without a lead: whole company.
create policy lb_orders_read on public.lb_orders for select to authenticated using (
  company_id = public.lb_my_company()
  and (lead_id is null or exists (select 1 from public.lb_leads l where l.id = lb_orders.lead_id)));

-- ------------------------------------------------------- product photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lb-store', 'lb-store', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------ helpers
create or replace function public.lb__inr(v numeric) returns text
language sql immutable set search_path = public as $$
  select '₹' || case when v = trunc(v) then to_char(v, 'FM99999999990') else to_char(v, 'FM99999999990.00') end
$$;

-- Core: put an order on the customer's open lead (or a new lead), log it, notify. No permission check.
-- p_items: [{product_id, name, sku, price, qty}] already validated / priced by the caller.
create or replace function public.lb__create_order(
  p_company uuid, p_channel text, p_phone text, p_name text, p_address text, p_note text,
  p_items jsonb, p_delivery numeric, p_source_name text, p_source uuid default null,
  p_customer uuid default null, p_message uuid default null)
returns lb_orders language plpgsql security definer set search_path = public as $$
declare
  v_cust lb_customers; v_lead lb_leads; v_order lb_orders; v_items jsonb; v_sub numeric; v_total numeric;
  v_status uuid; v_source uuid := p_source; v_first uuid; v_new boolean := false; v_text text; v_owner uuid; r record;
begin
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i->'product_id', 'name', i->>'name', 'sku', i->'sku',
           'price', (i->>'price')::numeric, 'qty', (i->>'qty')::int,
           'amount', round((i->>'price')::numeric * (i->>'qty')::int, 2))), '[]'::jsonb),
         coalesce(sum(round((i->>'price')::numeric * (i->>'qty')::int, 2)), 0)
    into v_items, v_sub
  from jsonb_array_elements(p_items) i;
  if jsonb_array_length(v_items) = 0 then raise exception 'Order has no items'; end if;
  v_total := v_sub + coalesce(p_delivery, 0);
  select nullif(i->>'product_id', '')::uuid into v_first from jsonb_array_elements(v_items) i where i->>'product_id' is not null limit 1;

  if p_customer is not null then
    select * into v_cust from lb_customers where id = p_customer and company_id = p_company for update;
  end if;
  if v_cust.id is null then
    insert into lb_customers (company_id, phone_e164, name, location)
    values (p_company, p_phone, nullif(trim(p_name), ''), nullif(trim(p_address), ''))
    on conflict (company_id, phone_e164) do update set
      name = coalesce(lb_customers.name, excluded.name), location = coalesce(lb_customers.location, excluded.location), updated_at = now();
    select * into v_cust from lb_customers where company_id = p_company and phone_e164 = p_phone for update;
  end if;

  -- Same customer with an open lead: the order goes on that lead.
  select * into v_lead from lb_leads where customer_id = v_cust.id and deleted_at is null order by created_at desc limit 1;
  if v_lead.id is null or lb__closed(v_lead.status_category) then
    if v_source is null then
      insert into lb_sources (company_id, name) values (p_company, p_source_name) on conflict (company_id, name) do nothing;
      select id into v_source from lb_sources where company_id = p_company and name = p_source_name;
    end if;
    v_status := lb__default_status(p_company, 'new');
    insert into lb_leads (company_id, customer_id, source_id, product_id, status_id, status_category, priority,
      expected_value, notes, is_repeat, parent_lead_id)
    values (p_company, v_cust.id, v_source, v_first, v_status, 'new', 'high', v_total, nullif(trim(p_note), ''),
      v_lead.id is not null, v_lead.id)
    returning * into v_lead;
    v_new := true;
  else
    update lb_leads set expected_value = coalesce(expected_value, 0) + v_total, product_id = coalesce(product_id, v_first),
      last_activity_at = now() where id = v_lead.id returning * into v_lead;
  end if;

  insert into lb_orders (company_id, channel, customer_id, lead_id, message_id, name, phone_e164, address, note,
    items, subtotal, delivery_fee, total)
  values (p_company, p_channel, v_cust.id, v_lead.id, p_message, coalesce(nullif(trim(p_name), ''), v_cust.name), v_cust.phone_e164,
    nullif(trim(p_address), ''), nullif(trim(p_note), ''), v_items, v_sub, coalesce(p_delivery, 0), v_total)
  returning * into v_order;

  v_text := '🛒 Order #' || v_order.order_no || case p_channel when 'whatsapp' then ' (WhatsApp catalog)' when 'store' then ' (mini-store)' else '' end
    || E'\n' || (select string_agg((i->>'qty') || ' × ' || (i->>'name') || ' @ ' || lb__inr((i->>'price')::numeric), E'\n') from jsonb_array_elements(v_items) i)
    || case when coalesce(p_delivery, 0) > 0 then E'\nDelivery: ' || lb__inr(p_delivery) else '' end
    || E'\nTotal: ' || lb__inr(v_total)
    || coalesce(E'\nAddress: ' || nullif(trim(p_address), ''), '') || coalesce(E'\nNote: ' || nullif(trim(p_note), ''), '');

  if v_new then
    insert into lb_lead_events (company_id, lead_id, type, to_status_id, to_category, data)
    values (p_company, v_lead.id, case when v_lead.parent_lead_id is not null then 'repeat_created' else 'created' end,
      v_lead.status_id, 'new', jsonb_build_object('via', 'order', 'order_id', v_order.id, 'text', v_text));
    v_owner := lb__auto_allocate(v_lead.id, null);
  else
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    values (p_company, v_lead.id, v_lead.owner_id, 'note', jsonb_build_object('via', 'order', 'order_id', v_order.id, 'text', v_text));
    v_owner := v_lead.owner_id;
  end if;

  -- Tell the lead owner and the company admins.
  for r in select id from lb_profiles where company_id = p_company and is_active
             and (id = v_owner or role = 'company_admin') loop
    perform lb__notify(p_company, r.id, 'order', 'New order #' || v_order.order_no || ' · ' || lb__inr(v_total),
      coalesce(v_order.name, v_order.phone_e164) || ' · ' || jsonb_array_length(v_items) || ' item(s)',
      '/store?order=' || v_order.id, 'order:' || v_order.id || ':' || r.id);
  end loop;
  return v_order;
end $$;
revoke all on function public.lb__create_order(uuid, text, text, text, text, text, jsonb, numeric, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------- public store checkout
-- Called by the server (service role) for /s/<code>.
-- p: {phone_e164, name, address, note, items:[{product_id, qty}]}. Prices always come from lb_products.
create or replace function public.lb_place_order(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st lb_stores; v_phone text := p->>'phone_e164'; v_items jsonb; v_want int; v_got int; v_sub numeric; v_fee numeric; o lb_orders;
begin
  select * into st from lb_stores where code = upper(p_code) and is_active;
  if st.id is null then raise exception 'Store not found'; end if;
  if not lb_company_entitled(st.company_id) then raise exception 'This store is not taking orders right now'; end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Valid phone number required'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if st.ask_address and coalesce(trim(p->>'address'), '') = '' then raise exception 'Delivery address is required'; end if;

  with want as (
    select (i->>'product_id')::uuid pid, sum(least(greatest(coalesce((i->>'qty')::int, 0), 0), 999)) qty
    from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) i
    where (i->>'product_id') ~ '^[0-9a-f-]{36}$'
    group by 1 having sum(coalesce((i->>'qty')::int, 0)) > 0
  )
  select (select count(*) from want),
         count(pr.id),
         coalesce(jsonb_agg(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'price', pr.price, 'qty', w.qty)
           order by pr.sort_order, pr.name) filter (where pr.id is not null), '[]'::jsonb),
         coalesce(sum(pr.price * w.qty), 0)
    into v_want, v_got, v_items, v_sub
  from want w
  left join lb_products pr on pr.id = w.pid and pr.company_id = st.company_id and pr.is_active and pr.in_store
    and pr.in_stock and pr.price is not null;
  if v_want = 0 then raise exception 'Your cart is empty'; end if;
  if v_want > 50 then raise exception 'Too many items in one order'; end if;
  if v_got < v_want then raise exception 'Some items are no longer available. Please refresh the page.'; end if;
  if v_sub < st.min_order then raise exception 'Minimum order is %', lb__inr(st.min_order); end if;
  v_fee := case when st.free_delivery_above is not null and v_sub >= st.free_delivery_above then 0 else st.delivery_fee end;

  o := lb__create_order(st.company_id, 'store', v_phone, left(p->>'name', 120), left(p->>'address', 500), left(p->>'note', 1000),
    v_items, v_fee, 'Mini-store', st.source_id);
  update lb_stores set orders_count = orders_count + 1 where id = st.id;
  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total', o.total, 'lead_id', o.lead_id);
end $$;
revoke all on function public.lb_place_order(text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_place_order(text, jsonb) to service_role;

-- ------------------------------------------ WhatsApp cart order (Meta catalog)
-- Called by the webhook (service role) after the inbound message is stored.
-- p_order = WhatsApp "order" object: {catalog_id, text, product_items:[{product_retailer_id, quantity, item_price, currency}]}
create or replace function public.lb_ingest_wa_order(p_message uuid, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m lb_messages; c lb_conversations; v_items jsonb; o lb_orders; v_existing uuid;
begin
  select * into m from lb_messages where id = p_message;
  if m.id is null then raise exception 'Message not found'; end if;
  select id into v_existing from lb_orders where message_id = m.id;
  if v_existing is not null then return jsonb_build_object('status', 'duplicate', 'order_id', v_existing); end if;
  select * into c from lb_conversations where id = m.conversation_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', pr.id, 'name', coalesce(pr.name, i->>'product_retailer_id'), 'sku', i->>'product_retailer_id',
           'price', coalesce(nullif(i->>'item_price', '')::numeric, pr.price, 0),
           'qty', greatest(coalesce(nullif(i->>'quantity', '')::int, 1), 1))), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(coalesce(p_order->'product_items', '[]'::jsonb)) i
  left join lb_products pr on pr.company_id = c.company_id and pr.sku = i->>'product_retailer_id';
  if jsonb_array_length(v_items) = 0 then return jsonb_build_object('status', 'empty'); end if;

  o := lb__create_order(c.company_id, 'whatsapp', (select phone_e164 from lb_customers where id = c.customer_id), null, null,
    left(p_order->>'text', 1000), v_items, 0, 'WhatsApp', null, c.customer_id, m.id);
  if c.lead_id is null then update lb_conversations set lead_id = o.lead_id where id = c.id; end if;
  return jsonb_build_object('status', 'created', 'order_id', o.id, 'order_no', o.order_no);
end $$;
revoke all on function public.lb_ingest_wa_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_ingest_wa_order(uuid, jsonb) to service_role;

-- ------------------------------------------------- staff: update an order
create or replace function public.lb_set_order(p_order uuid, p_status text, p_payment text, p_note text)
returns lb_orders language plpgsql security definer set search_path = public as $$
declare o lb_orders; l lb_leads; v_changes text[] := '{}';
begin
  select * into o from lb_orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from lb_my_company() then raise exception 'Order not found' using errcode = '42501'; end if;
  if o.lead_id is not null then
    select * into l from lb_leads where id = o.lead_id;
    if l.id is not null and not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode = '42501'; end if;
  end if;
  if not (lb_can('leads.edit') or lb_is_admin_of(o.company_id)) then raise exception 'You do not have permission to edit orders' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('new','confirmed','packed','shipped','delivered','cancelled') then raise exception 'Invalid status'; end if;
  if p_payment is not null and p_payment not in ('unpaid','paid','refunded') then raise exception 'Invalid payment status'; end if;

  if p_status is not null and p_status <> o.status then v_changes := v_changes || ('status: ' || o.status || ' → ' || p_status); end if;
  if p_payment is not null and p_payment <> o.payment_status then v_changes := v_changes || ('payment: ' || o.payment_status || ' → ' || p_payment); end if;
  update lb_orders set status = coalesce(p_status, status), payment_status = coalesce(p_payment, payment_status),
    staff_note = case when p_note is null then staff_note else nullif(left(trim(p_note), 1000), '') end,
    updated_at = now(), updated_by = auth.uid()
  where id = o.id returning * into o;

  if o.lead_id is not null and array_length(v_changes, 1) > 0 then
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, data)
    values (o.company_id, o.lead_id, auth.uid(), l.owner_id, 'note',
      jsonb_build_object('via', 'order', 'order_id', o.id, 'text', '🛒 Order #' || o.order_no || ' ' || array_to_string(v_changes, ', ')));
    update lb_leads set last_activity_at = now() where id = o.lead_id;
  end if;
  return o;
end $$;
revoke all on function public.lb_set_order(uuid, text, text, text) from public, anon;
grant execute on function public.lb_set_order(uuid, text, text, text) to authenticated;

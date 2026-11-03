-- Vendors + purchase orders (buying stock from suppliers).
--
--   * lb_vendors              suppliers (name, contact, phone, GSTIN, address, payment terms).
--   * lb_purchase_orders      PO header: PO number per company, vendor, dates, status, totals, amount paid.
--   * lb_po_items             PO lines: product (or free text), qty ordered / received, unit cost, GST %.
--   * lb_po_receipts          every "Receive goods" entry: date + value. Profit & Loss counts purchases from here.
--   * lb_products.cost_price  last purchase cost per unit (set when a PO line is received).
--
-- Receiving goods (lb_receive_po, service role) adds the quantity to the store stock of the product
-- (lb_products.stock_qty, stock-alerts SQL), logged in lb_stock_moves as "PO #n received".
-- A product whose stock was not tracked starts being tracked from the received quantity.
-- Profit & Loss: lb_purchase_cost(from, to) = value of goods received in the period (IST dates).
-- Needs: store SQL (20261102000063) and stock-alerts SQL (20261102060200). Safe to run more than once.

-- ------------------------------------------------------------ 1. vendors
create table if not exists public.lb_vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  contact_person text not null default '',
  phone_e164 text,
  email text not null default '',
  gstin text not null default '',
  address text not null default '',
  payment_terms text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.lb_vendors enable row level security;
revoke all on public.lb_vendors from anon, authenticated;
grant select on public.lb_vendors to authenticated;
drop policy if exists lb_vendors_read on public.lb_vendors;
create policy lb_vendors_read on public.lb_vendors for select to authenticated using (public.lb_is_admin_of(company_id));
drop policy if exists lb_paid on public.lb_vendors;
create policy lb_paid on public.lb_vendors as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- ------------------------------------------------------- 2. purchase orders
create table if not exists public.lb_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  po_no integer not null,
  vendor_id uuid not null references public.lb_vendors(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','ordered','partial','received','cancelled')),
  order_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  expected_date date,
  subtotal numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0 check (other_charges >= 0),
  total numeric(14,2) not null default 0,
  received_value numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  notes text not null default '',
  created_by uuid references public.lb_profiles(id) on delete set null,
  ordered_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, po_no)
);
create index if not exists lb_purchase_orders_company on public.lb_purchase_orders (company_id, created_at desc);
create index if not exists lb_purchase_orders_vendor on public.lb_purchase_orders (vendor_id);
alter table public.lb_purchase_orders enable row level security;
revoke all on public.lb_purchase_orders from anon, authenticated;
grant select on public.lb_purchase_orders to authenticated;
drop policy if exists lb_purchase_orders_read on public.lb_purchase_orders;
create policy lb_purchase_orders_read on public.lb_purchase_orders for select to authenticated using (public.lb_is_admin_of(company_id));
drop policy if exists lb_paid on public.lb_purchase_orders;
create policy lb_paid on public.lb_purchase_orders as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

create table if not exists public.lb_po_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  po_id uuid not null references public.lb_purchase_orders(id) on delete cascade,
  product_id uuid references public.lb_products(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 160),
  unit text not null default '',
  qty integer not null check (qty > 0),
  received_qty integer not null default 0 check (received_qty >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  gst_pct numeric(5,2) not null default 0 check (gst_pct between 0 and 100),
  sort_order integer not null default 0,
  check (received_qty <= qty)
);
create index if not exists lb_po_items_po on public.lb_po_items (po_id, sort_order);
create index if not exists lb_po_items_product on public.lb_po_items (product_id);
alter table public.lb_po_items enable row level security;
revoke all on public.lb_po_items from anon, authenticated;
grant select on public.lb_po_items to authenticated;
drop policy if exists lb_po_items_read on public.lb_po_items;
create policy lb_po_items_read on public.lb_po_items for select to authenticated using (public.lb_is_admin_of(company_id));
drop policy if exists lb_paid on public.lb_po_items;
create policy lb_paid on public.lb_po_items as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

create table if not exists public.lb_po_receipts (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  po_id uuid not null references public.lb_purchase_orders(id) on delete cascade,
  received_on date not null,
  amount numeric(14,2) not null default 0,
  lines jsonb not null default '[]'::jsonb,
  note text not null default '',
  actor_id uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_po_receipts_company on public.lb_po_receipts (company_id, received_on);
create index if not exists lb_po_receipts_po on public.lb_po_receipts (po_id);
alter table public.lb_po_receipts enable row level security;
revoke all on public.lb_po_receipts from anon, authenticated;
grant select on public.lb_po_receipts to authenticated;
drop policy if exists lb_po_receipts_read on public.lb_po_receipts;
create policy lb_po_receipts_read on public.lb_po_receipts for select to authenticated using (public.lb_is_admin_of(company_id));
drop policy if exists lb_paid on public.lb_po_receipts;
create policy lb_paid on public.lb_po_receipts as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

alter table public.lb_products add column if not exists cost_price numeric(14,2);

-- ---------------------------------------------- 3. save a PO (server, service role)
-- Creates (p_po null) or replaces a draft/ordered PO that has nothing received yet.
-- p_items: [{product_id?, name, unit?, qty, unit_cost, gst_pct?}]. Returns the PO id.
create or replace function public.lb_save_po(p_company uuid, p_actor uuid, p_po uuid, p_vendor uuid, p_order_date date,
  p_expected date, p_other numeric, p_notes text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_po; v_no integer; v_status text; v_sub numeric := 0; v_tax numeric := 0; i jsonb; n integer := 0;
  v_pid uuid; v_qty integer; v_cost numeric; v_gst numeric; v_name text;
begin
  if not exists (select 1 from lb_vendors where id = p_vendor and company_id = p_company) then raise exception 'Pick a vendor'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items (max 200)'; end if;
  if coalesce(p_other, 0) < 0 then raise exception 'Other charges cannot be negative'; end if;

  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('lb_po_no:' || p_company::text));
    select coalesce(max(po_no), 0) + 1 into v_no from lb_purchase_orders where company_id = p_company;
    insert into lb_purchase_orders (company_id, po_no, vendor_id, order_date, expected_date, other_charges, notes, created_by)
    values (p_company, v_no, p_vendor, coalesce(p_order_date, (now() at time zone 'Asia/Kolkata')::date), p_expected,
      coalesce(p_other, 0), coalesce(trim(p_notes), ''), p_actor)
    returning id into v_id;
  else
    select status into v_status from lb_purchase_orders where id = v_id and company_id = p_company for update;
    if not found then raise exception 'Purchase order not found'; end if;
    if v_status not in ('draft', 'ordered') or exists (select 1 from lb_po_items where po_id = v_id and received_qty > 0) then
      raise exception 'This purchase order already has goods received or is closed, it cannot be edited';
    end if;
    update lb_purchase_orders set vendor_id = p_vendor, order_date = coalesce(p_order_date, order_date), expected_date = p_expected,
      other_charges = coalesce(p_other, 0), notes = coalesce(trim(p_notes), ''), updated_at = now() where id = v_id;
    delete from lb_po_items where po_id = v_id;
  end if;

  for i in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    v_pid := nullif(i->>'product_id', '')::uuid;
    if v_pid is not null and not exists (select 1 from lb_products where id = v_pid and company_id = p_company) then raise exception 'Invalid product on line %', n; end if;
    v_name := coalesce(nullif(trim(i->>'name'), ''), (select name from lb_products where id = v_pid));
    if v_name is null then raise exception 'Line % needs a product or item name', n; end if;
    v_qty := (i->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Line %: quantity must be 1 or more', n; end if;
    v_cost := round(coalesce((i->>'unit_cost')::numeric, 0), 2);
    v_gst := coalesce((i->>'gst_pct')::numeric, 0);
    if v_cost < 0 or v_gst < 0 or v_gst > 100 then raise exception 'Line %: check the cost and GST %%', n; end if;
    insert into lb_po_items (company_id, po_id, product_id, name, unit, qty, unit_cost, gst_pct, sort_order)
    values (p_company, v_id, v_pid, left(v_name, 160), left(coalesce(trim(i->>'unit'), ''), 30), v_qty, v_cost, v_gst, n);
    v_sub := v_sub + v_qty * v_cost;
    v_tax := v_tax + round(v_qty * v_cost * v_gst / 100, 2);
  end loop;

  update lb_purchase_orders set subtotal = round(v_sub, 2), tax = round(v_tax, 2),
    total = round(v_sub + v_tax + other_charges, 2) where id = v_id;
  return v_id;
end $$;
revoke all on function public.lb_save_po(uuid, uuid, uuid, uuid, date, date, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.lb_save_po(uuid, uuid, uuid, uuid, date, date, numeric, text, jsonb) to service_role;

-- ------------------------------------------- 4. receive goods (server, service role)
-- p_lines: [{item_id, qty}] (qty received now). Adds to store stock, updates cost price, logs a receipt.
-- Other charges (freight etc.) are counted with the first receipt.
create or replace function public.lb_receive_po(p_company uuid, p_actor uuid, p_po uuid, p_date date, p_lines jsonb, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare po lb_purchase_orders; l jsonb; it lb_po_items; v_qty integer; v_amt numeric := 0; v_log jsonb := '[]'::jsonb; v_any boolean := false;
begin
  select * into po from lb_purchase_orders where id = p_po and company_id = p_company for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if po.status in ('received', 'cancelled') then raise exception 'This purchase order is already %', po.status; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Nothing to receive'; end if;

  perform set_config('lb.stock_reason', 'PO #' || po.po_no || ' received', true);
  perform set_config('lb.stock_actor', coalesce(p_actor::text, ''), true);
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((l->>'qty')::integer, 0);
    if v_qty = 0 then continue; end if;
    select * into it from lb_po_items where id = (l->>'item_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'Invalid line'; end if;
    if v_qty < 0 or it.received_qty + v_qty > it.qty then
      raise exception '%: only % more can be received', it.name, it.qty - it.received_qty;
    end if;
    update lb_po_items set received_qty = received_qty + v_qty where id = it.id;
    v_amt := v_amt + round(v_qty * it.unit_cost * (1 + it.gst_pct / 100), 2);
    v_log := v_log || jsonb_build_object('item_id', it.id, 'product_id', it.product_id, 'name', it.name, 'qty', v_qty, 'unit_cost', it.unit_cost);
    v_any := true;
    if it.product_id is not null then
      update lb_products set stock_qty = coalesce(stock_qty, 0) + v_qty,
        cost_price = case when it.unit_cost > 0 then it.unit_cost else cost_price end
      where id = it.product_id and company_id = p_company;
    end if;
  end loop;
  perform set_config('lb.stock_reason', '', true);
  perform set_config('lb.stock_actor', '', true);
  if not v_any then raise exception 'Enter the quantity received for at least one item'; end if;

  if not exists (select 1 from lb_po_receipts where po_id = p_po) then v_amt := v_amt + po.other_charges; end if;
  insert into lb_po_receipts (company_id, po_id, received_on, amount, lines, note, actor_id)
  values (p_company, p_po, coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), round(v_amt, 2), v_log, coalesce(trim(p_note), ''), p_actor);

  update lb_purchase_orders set
    received_value = received_value + round(v_amt, 2),
    status = case when not exists (select 1 from lb_po_items where po_id = p_po and received_qty < qty) then 'received' else 'partial' end,
    received_at = case when not exists (select 1 from lb_po_items where po_id = p_po and received_qty < qty) then now() else received_at end,
    ordered_at = coalesce(ordered_at, now()),
    updated_at = now()
  where id = p_po;
  return round(v_amt, 2);
end $$;
revoke all on function public.lb_receive_po(uuid, uuid, uuid, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.lb_receive_po(uuid, uuid, uuid, date, jsonb, text) to service_role;

-- --------------------------------------------- 5. Profit & Loss: purchases in a period
create or replace function public.lb_purchase_cost(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := lb_my_company(); v_out jsonb;
begin
  if v_co is null or not lb_is_admin_of(v_co) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid date range'; end if;
  if p_to - p_from > 400 then raise exception 'Choose a range of 400 days or less'; end if;
  with r as (
    select r.received_on d, r.amount, po.vendor_id from lb_po_receipts r join lb_purchase_orders po on po.id = r.po_id
    where r.company_id = v_co and r.received_on between p_from and p_to
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(amount), 0) from r),
    'receipts', (select count(*) from r),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'amount', a) order by d) from (select d, sum(amount) a from r group by d) x), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(jsonb_build_object('vendor_id', x.vendor_id, 'name', v.name, 'amount', x.a) order by x.a desc)
                from (select vendor_id, sum(amount) a from r group by vendor_id) x join lb_vendors v on v.id = x.vendor_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.lb_purchase_cost(date, date) from public, anon;
grant execute on function public.lb_purchase_cost(date, date) to authenticated;

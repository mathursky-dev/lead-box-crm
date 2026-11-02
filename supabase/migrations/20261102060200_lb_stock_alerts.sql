-- Store inventory: stock quantity per product, auto minus on orders (plus back on cancel),
-- stock history, and low-stock / out-of-stock alerts to company admins (bell + phone push).
--
--   * lb_products.stock_qty      NULL = stock not tracked (old behaviour, only the In stock switch).
--   * lb_products.low_stock_at   alert when quantity falls to this number or below (default 5).
--   * lb_stock_moves             every change in quantity: order, cancel, manual edit.
--
-- A tracked product switches itself "Out of stock" at 0 and back "In stock" when quantity is added.
-- Mini-store checkout refuses more than the quantity left. WhatsApp catalog orders are never refused
-- (the customer already ordered); stock just stops at 0.
-- Safe to run more than once.

-- ------------------------------------------------------------ 1. columns
alter table public.lb_products add column if not exists stock_qty integer;
alter table public.lb_products add column if not exists low_stock_at integer not null default 5;
alter table public.lb_products add column if not exists low_alerted_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lb_products_stock_chk') then
    alter table public.lb_products add constraint lb_products_stock_chk
      check ((stock_qty is null or stock_qty >= 0) and low_stock_at >= 0);
  end if;
end $$;
create index if not exists lb_products_low_stock on public.lb_products (company_id)
  where stock_qty is not null and stock_qty <= low_stock_at;

-- ------------------------------------------------------- 2. stock history
create table if not exists public.lb_stock_moves (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  product_id uuid not null references public.lb_products(id) on delete cascade,
  delta integer not null,
  qty_after integer,
  reason text not null default 'manual',
  order_id uuid references public.lb_orders(id) on delete set null,
  actor_id uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lb_stock_moves_product on public.lb_stock_moves (product_id, created_at desc);
alter table public.lb_stock_moves enable row level security;
revoke all on public.lb_stock_moves from anon, authenticated;
grant select on public.lb_stock_moves to authenticated;
drop policy if exists lb_stock_moves_read on public.lb_stock_moves;
create policy lb_stock_moves_read on public.lb_stock_moves for select to authenticated using (public.lb_is_admin_of(company_id));
drop policy if exists lb_paid on public.lb_stock_moves;
create policy lb_paid on public.lb_stock_moves as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- ------------------------------------------- 3. product trigger (switch + alert + log)
create or replace function public.lb__product_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old integer := case when tg_op = 'UPDATE' then old.stock_qty end; r record; v_title text;
begin
  if tg_op = 'UPDATE' and new.stock_qty is not distinct from v_old and new.low_stock_at = old.low_stock_at then return new; end if;
  if new.stock_qty is not null then
    if new.stock_qty is distinct from v_old then new.in_stock := new.stock_qty > 0; end if;
    if new.stock_qty > new.low_stock_at then new.low_alerted_at := null; end if;
  end if;

  if tg_op = 'UPDATE' and new.stock_qty is distinct from v_old then
    insert into lb_stock_moves (company_id, product_id, delta, qty_after, reason, order_id, actor_id)
    values (new.company_id, new.id, coalesce(new.stock_qty, 0) - coalesce(v_old, 0), new.stock_qty,
      coalesce(nullif(current_setting('lb.stock_reason', true), ''), case when new.stock_qty is null then 'tracking off' else 'manual' end),
      nullif(current_setting('lb.stock_order', true), '')::uuid,
      coalesce(auth.uid(), nullif(current_setting('lb.stock_actor', true), '')::uuid));
  end if;

  -- Alert once when it falls to the low mark, and again when it runs out.
  if new.stock_qty is not null and new.is_active
     and ((new.stock_qty <= new.low_stock_at and new.low_alerted_at is null) or (new.stock_qty = 0 and coalesce(v_old, 1) > 0)) then
    v_title := case when new.stock_qty = 0 then 'Out of stock: ' || new.name
                    else 'Low stock: ' || new.name || ' (' || new.stock_qty || ' left)' end;
    for r in select id from lb_profiles where company_id = new.company_id and is_active and role = 'company_admin' loop
      perform lb__notify(new.company_id, r.id, 'stock', v_title,
        case when new.stock_qty = 0 then 'Hidden as "Out of stock" in your store until you add quantity.'
             else 'Alert level is ' || new.low_stock_at || '. Add stock in Store → Products.' end,
        '/store/products?stock=low', 'stock:' || new.id || ':' || new.stock_qty || ':' || r.id || ':' || extract(epoch from now())::bigint);
    end loop;
    new.low_alerted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists lb_product_stock on public.lb_products;
create trigger lb_product_stock before insert or update of stock_qty, low_stock_at on public.lb_products
  for each row execute function public.lb__product_stock();

-- ----------------------------------------------- 4. orders move the stock
-- p_sign -1 = order placed / un-cancelled, +1 = cancelled.
create or replace function public.lb__order_stock(o lb_orders, p_sign integer, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i record; v_left integer;
begin
  perform set_config('lb.stock_reason', p_reason, true);
  perform set_config('lb.stock_order', o.id::text, true);
  for i in select nullif(x->>'product_id', '')::uuid pid, sum(coalesce((x->>'qty')::int, 0)) qty
           from jsonb_array_elements(o.items) x where nullif(x->>'product_id', '') is not null group by 1 loop
    select stock_qty into v_left from lb_products where id = i.pid and company_id = o.company_id and stock_qty is not null for update;
    if not found then continue; end if;
    if p_sign < 0 and o.channel = 'store' and v_left < i.qty then
      raise exception 'Only % left of %. Please reduce the quantity.', v_left, (select name from lb_products where id = i.pid);
    end if;
    update lb_products set stock_qty = greatest(stock_qty + p_sign * i.qty, 0) where id = i.pid;
  end loop;
  perform set_config('lb.stock_reason', '', true);
  perform set_config('lb.stock_order', '', true);
end $$;
revoke all on function public.lb__order_stock(lb_orders, integer, text) from public, anon, authenticated;

create or replace function public.lb__orders_stock_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' then perform lb__order_stock(new, -1, 'order #' || new.order_no); end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform lb__order_stock(new, 1, 'order #' || new.order_no || ' cancelled');
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    perform lb__order_stock(new, -1, 'order #' || new.order_no || ' re-opened');
  end if;
  return null;
end $$;
drop trigger if exists lb_orders_stock on public.lb_orders;
create trigger lb_orders_stock after insert or update of status on public.lb_orders
  for each row execute function public.lb__orders_stock_trg();

-- --------------------------------------------- 5. staff edit (server, service role)
-- Sets quantity and alert level and logs who did it. p_qty NULL turns tracking off.
create or replace function public.lb_set_product_stock(p_product uuid, p_company uuid, p_qty integer, p_low integer, p_actor uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_qty is not null and p_qty < 0 then raise exception 'Stock cannot be negative'; end if;
  perform set_config('lb.stock_reason', coalesce(nullif(trim(p_note), ''), 'manual'), true);
  perform set_config('lb.stock_actor', coalesce(p_actor::text, ''), true);
  update lb_products set stock_qty = p_qty, low_stock_at = greatest(coalesce(p_low, low_stock_at), 0)
  where id = p_product and company_id = p_company;
  if not found then raise exception 'Product not found'; end if;
  perform set_config('lb.stock_reason', '', true);
  perform set_config('lb.stock_actor', '', true);
end $$;
revoke all on function public.lb_set_product_stock(uuid, uuid, integer, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.lb_set_product_stock(uuid, uuid, integer, integer, uuid, text) to service_role;

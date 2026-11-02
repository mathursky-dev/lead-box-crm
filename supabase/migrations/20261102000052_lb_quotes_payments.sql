-- Quotations, invoices and Razorpay payment links on leads.
--
--   1. lb_quote_settings: per-company business details printed on the PDF,
--      numbering (QT-0001 / INV-0001), default GST %, terms, bank details,
--      the "Quotation sent" status, and the company's OWN Razorpay keys
--      (encrypted by the app with LB_SECRETS_KEY; never readable by users).
--   2. lb_quotes: quotations and invoices of a lead (line items in jsonb).
--   3. lb_payment_links: Razorpay payment links sent to a lead.
--   4. RPCs (service_role only, called by server actions / Razorpay webhook):
--      lb_next_doc_no, lb_quote_mark_sent, lb_settle_lead_payment.
--
-- Company scoped: users read only rows of their active company
-- (lb_my_company(), follows the Super Admin switcher) for leads they can see.
-- All writes go through server actions with the service role.
-- Safe to run more than once.

-- ---------------------------------------------------------- 1. settings
create table if not exists public.lb_quote_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  business_name text not null default '',
  address text not null default '',
  gstin text not null default '',
  phone text not null default '',
  email text not null default '',
  quote_prefix text not null default 'QT-',
  invoice_prefix text not null default 'INV-',
  next_quote_no integer not null default 1,
  next_invoice_no integer not null default 1,
  default_tax_pct numeric(5,2) not null default 18,
  quote_validity_days integer not null default 15,
  terms text not null default '',
  bank_details text not null default '',
  footer_note text not null default 'Thank you for your business!',
  quote_status_id uuid references public.lb_lead_statuses(id) on delete set null,
  auto_status_on_send boolean not null default true,
  won_on_payment boolean not null default true,
  rzp_key_id text,
  rzp_key_secret_enc text,
  rzp_webhook_secret_enc text,
  updated_at timestamptz not null default now()
);
-- Holds encrypted keys: no direct access for app users at all.
alter table public.lb_quote_settings enable row level security;
revoke all on public.lb_quote_settings from anon, authenticated;

-- ---------------------------------------------------- 2. quotes/invoices
create table if not exists public.lb_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  lead_id uuid not null references public.lb_leads(id) on delete cascade,
  customer_id uuid references public.lb_customers(id) on delete set null,
  kind text not null check (kind in ('quotation','invoice')),
  doc_no text not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','paid','cancelled')),
  issue_date date not null default current_date,
  valid_until date,             -- quotation: valid till; invoice: due date
  items jsonb not null default '[]'::jsonb,   -- [{name, description, qty, rate, tax_pct}]
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  notes text not null default '',
  terms text not null default '',
  from_quote_id uuid references public.lb_quotes(id) on delete set null,
  public_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, doc_no)
);
create index if not exists lb_quotes_company on public.lb_quotes (company_id, created_at desc);
create index if not exists lb_quotes_lead on public.lb_quotes (lead_id, created_at desc);

-- --------------------------------------------------------- 3. pay links
create table if not exists public.lb_payment_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  lead_id uuid not null references public.lb_leads(id) on delete cascade,
  quote_id uuid references public.lb_quotes(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'INR',
  description text not null default '',
  provider text not null default 'razorpay',
  provider_link_id text unique,
  short_url text,
  status text not null default 'created' check (status in ('created','paid','partially_paid','cancelled','expired','failed')),
  amount_paid numeric(14,2) not null default 0,
  payment_id text,
  paid_at timestamptz,
  sent_at timestamptz,
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_payment_links_lead on public.lb_payment_links (lead_id, created_at desc);
create index if not exists lb_payment_links_company on public.lb_payment_links (company_id, created_at desc);

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['lb_quotes','lb_payment_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = public.lb_my_company() and public.lb_can_see_lead_id(lead_id))', t || '_read', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- ------------------------------------------------------------ 4. RPCs
-- Next document number for a company, e.g. QT-0007. Atomic.
create or replace function public.lb_next_doc_no(p_company uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare s lb_quote_settings; n integer;
begin
  if p_kind not in ('quotation','invoice') then raise exception 'Invalid kind'; end if;
  insert into lb_quote_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  if p_kind = 'quotation' then
    update lb_quote_settings set next_quote_no = next_quote_no + 1 where company_id = p_company returning * into s;
    n := s.next_quote_no - 1;
    return s.quote_prefix || lpad(n::text, 4, '0');
  end if;
  update lb_quote_settings set next_invoice_no = next_invoice_no + 1 where company_id = p_company returning * into s;
  n := s.next_invoice_no - 1;
  return s.invoice_prefix || lpad(n::text, 4, '0');
end $$;

-- Marks a quotation/invoice as sent, logs it on the lead and (quotations only,
-- if enabled) moves the lead to the "Quotation sent" status, creating that
-- status the first time. Won/Lost/Invalid leads keep their status.
create or replace function public.lb_quote_mark_sent(p_quote uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public as $$
declare q lb_quotes; s lb_quote_settings; l lb_leads; v_status uuid; v_sort integer; v_moved text := null;
begin
  select * into q from lb_quotes where id = p_quote for update;
  if q.id is null then raise exception 'Quotation not found'; end if;
  if p_actor is not null and not exists (select 1 from lb_profiles where id = p_actor and company_id = q.company_id)
     and not exists (select 1 from lb_profiles where id = p_actor and role = 'super_admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update lb_quotes set status = case when status = 'draft' then 'sent' else status end,
    sent_at = now(), updated_at = now() where id = q.id;
  select * into l from lb_leads where id = q.lead_id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (q.company_id, q.lead_id, p_actor, l.owner_id, 'field_update', true,
          jsonb_build_object('doc_event', 'sent', 'doc_kind', q.kind, 'doc_no', q.doc_no, 'amount', q.total));
  update lb_leads set last_activity_at = now() where id = q.lead_id;

  select * into s from lb_quote_settings where company_id = q.company_id;
  if q.kind <> 'quotation' or coalesce(s.auto_status_on_send, true) = false then return null; end if;
  if l.status_category in ('won','lost','invalid') then return null; end if;

  v_status := s.quote_status_id;
  if v_status is not null and not exists (select 1 from lb_lead_statuses where id = v_status and company_id = q.company_id and is_active) then
    v_status := null;
  end if;
  if v_status is null then
    select id into v_status from lb_lead_statuses
      where company_id = q.company_id and is_active and lower(trim(name)) in ('quotation sent','quote sent')
      order by sort_order limit 1;
  end if;
  if v_status is null then
    select id into v_status from lb_lead_statuses where company_id = q.company_id and lower(trim(name)) = 'quotation sent';
    if v_status is not null then
      update lb_lead_statuses set is_active = true where id = v_status;
    else
      select coalesce(max(sort_order), 0) into v_sort from lb_lead_statuses
        where company_id = q.company_id and category not in ('won','lost','invalid');
      insert into lb_lead_statuses (company_id, name, category, sort_order, is_active)
      values (q.company_id, 'Quotation sent', 'interested', v_sort + 1, true) returning id into v_status;
    end if;
    insert into lb_quote_settings (company_id, quote_status_id) values (q.company_id, v_status)
      on conflict (company_id) do update set quote_status_id = excluded.quote_status_id;
  end if;
  if l.status_id is distinct from v_status then
    perform lb__set_status(q.lead_id, v_status, p_actor, 'Quotation ' || q.doc_no || ' sent', null, true);
    select name into v_moved from lb_lead_statuses where id = v_status;
  end if;
  return v_moved;
end $$;

-- Razorpay says a payment link was paid. Idempotent per link.
-- Updates the link, the linked quotation/invoice, the lead's payment status,
-- and (if enabled and fully paid) moves the lead to its Won status.
create or replace function public.lb_settle_lead_payment(p_link uuid, p_payment_id text, p_amount_paise bigint, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare pl lb_payment_links; q lb_quotes; s lb_quote_settings; l lb_leads; v_amt numeric(14,2); v_won uuid; v_full boolean; v_delta numeric(14,2);
begin
  select * into pl from lb_payment_links where id = p_link for update;
  if pl.id is null then return false; end if;
  if pl.status = 'paid' then return false; end if;
  v_amt := round(coalesce(p_amount_paise, 0) / 100.0, 2);
  v_full := p_status = 'paid' or v_amt >= pl.amount;
  update lb_payment_links set status = case when v_full then 'paid' else 'partially_paid' end,
    amount_paid = greatest(amount_paid, v_amt), payment_id = coalesce(p_payment_id, payment_id),
    paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = pl.id;

  v_delta := greatest(v_amt - pl.amount_paid, 0);
  if pl.quote_id is not null then
    select * into q from lb_quotes where id = pl.quote_id for update;
    if q.id is not null then
      update lb_quotes set amount_paid = least(total, amount_paid + v_delta),
        status = case when amount_paid + v_delta >= total then 'paid'
                      when status in ('draft','sent') then 'accepted' else status end,
        paid_at = case when amount_paid + v_delta >= total then coalesce(paid_at, now()) else paid_at end,
        updated_at = now()
      where id = q.id;
    end if;
  end if;

  select * into l from lb_leads where id = pl.lead_id for update;
  update lb_leads set payment_status = case when v_full then 'paid' else 'partial' end,
    last_activity_at = now(), updated_at = now() where id = l.id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (pl.company_id, pl.lead_id, null, l.owner_id, 'field_update', false,
          jsonb_build_object('doc_event', 'paid', 'amount', v_amt, 'payment_id', p_payment_id, 'link_id', pl.id));
  perform lb__notify(pl.company_id, l.owner_id, 'payment_received', 'Payment received: ₹' || v_amt::text,
    'LB-' || l.lead_no || coalesce(' · ' || nullif(pl.description, ''), ''), '/leads/' || l.id, 'pay:' || pl.id::text);

  select * into s from lb_quote_settings where company_id = pl.company_id;
  if v_full and coalesce(s.won_on_payment, true) and l.status_category <> 'won' then
    select id into v_won from lb_lead_statuses where company_id = pl.company_id and category = 'won' and is_active
      order by is_default desc, sort_order limit 1;
    if v_won is not null then
      perform lb__set_status(l.id, v_won, null, 'Payment received (Razorpay ' || coalesce(p_payment_id, '') || ')',
        coalesce(nullif(q.total, 0), v_amt), false);
    end if;
  end if;
  return true;
end $$;

revoke all on function public.lb_next_doc_no(uuid, text) from public, anon, authenticated;
revoke all on function public.lb_quote_mark_sent(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lb_settle_lead_payment(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.lb_next_doc_no(uuid, text) to service_role;
grant execute on function public.lb_quote_mark_sent(uuid, uuid) to service_role;
grant execute on function public.lb_settle_lead_payment(uuid, text, bigint, text) to service_role;

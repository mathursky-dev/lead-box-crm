-- GST on invoices: buyer GSTIN / place of supply / HSN, GSTR-1 export, e-invoice (IRN) fields.
--
--   1. lb_quotes: buyer GST details (GSTIN, legal name, address, PIN, place of supply,
--      reverse charge) and e-invoice fields (IRN, Ack no/date, signed QR) that are
--      filled after the invoice is registered on the IRP (manually today, or by a
--      GSP integration later).
--   2. lb_customers.gstin: remembered per customer, pre-filled on the next invoice.
--   3. lb_quote_settings: seller state code + PIN (needed by GSTR-1 / e-invoice).
--
-- HSN/SAC and unit live inside lb_quotes.items (jsonb), so no column is needed.
-- GSTR-1 itself is computed by the app from invoices; nothing else is stored.
-- Only adds nullable columns: existing rows and screens keep working. Safe to run more than once.

alter table public.lb_quotes add column if not exists buyer_gstin text;
alter table public.lb_quotes add column if not exists buyer_legal_name text;
alter table public.lb_quotes add column if not exists buyer_address text;
alter table public.lb_quotes add column if not exists buyer_pincode text;
alter table public.lb_quotes add column if not exists place_of_supply text;      -- 2-digit GST state code, e.g. '27'
alter table public.lb_quotes add column if not exists reverse_charge boolean not null default false;
alter table public.lb_quotes add column if not exists irn text;
alter table public.lb_quotes add column if not exists irn_ack_no text;
alter table public.lb_quotes add column if not exists irn_ack_date timestamptz;
alter table public.lb_quotes add column if not exists irn_signed_qr text;
alter table public.lb_quotes add column if not exists irn_cancelled_at timestamptz;

do $$ begin
  alter table public.lb_quotes add constraint lb_quotes_buyer_gstin_chk
    check (buyer_gstin is null or buyer_gstin ~ '^[0-9]{2}[0-9A-Z]{13}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lb_quotes add constraint lb_quotes_pos_chk
    check (place_of_supply is null or place_of_supply ~ '^[0-9]{2}$');
exception when duplicate_object then null; end $$;

-- GSTR-1 reads invoices of one month.
create index if not exists lb_quotes_gst_month on public.lb_quotes (company_id, kind, issue_date);

alter table public.lb_customers add column if not exists gstin text;

alter table public.lb_quote_settings add column if not exists state_code text;   -- empty = taken from the GSTIN's first 2 digits
alter table public.lb_quote_settings add column if not exists pincode text;

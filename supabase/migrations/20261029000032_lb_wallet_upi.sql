-- Wallet top-ups over UPI. A company admin pays the platform's UPI ID
-- (shown as a QR / upi:// link), then submits the amount and UTR. The
-- platform Super Admin checks the bank statement and approves, which credits
-- the wallet through lb_wallet_add (idempotent on the top-up id). No payment
-- gateway is involved; Razorpay can replace the manual check later.

-- Platform-wide settings, one row. The UPI ID is public (it is shown to every
-- paying company), so any signed-in user may read it.
create table if not exists public.lb_platform_settings (
  id boolean primary key default true check (id),
  upi_id text check (upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$'),
  upi_name text check (length(trim(upi_name)) between 1 and 80),
  updated_at timestamptz not null default now()
);
insert into public.lb_platform_settings (id) values (true) on conflict do nothing;
alter table public.lb_platform_settings enable row level security;
revoke all on public.lb_platform_settings from anon, authenticated;
grant select on public.lb_platform_settings to authenticated;
create policy lb_platform_settings_read on public.lb_platform_settings for select to authenticated using (true);

create table if not exists public.lb_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  amount numeric(12,2) not null check (amount between 100 and 500000),
  utr text not null check (utr ~ '^[0-9]{12}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now()
);
-- A UTR can be claimed once, unless an earlier claim was rejected.
create unique index if not exists lb_wallet_topups_utr on public.lb_wallet_topups (utr) where status <> 'rejected';
create index if not exists lb_wallet_topups_company on public.lb_wallet_topups (company_id, created_at desc);
create index if not exists lb_wallet_topups_pending on public.lb_wallet_topups (created_at) where status = 'pending';

alter table public.lb_wallet_topups enable row level security;
revoke all on public.lb_wallet_topups from anon, authenticated;
grant select on public.lb_wallet_topups to authenticated;
create policy lb_wallet_topups_read on public.lb_wallet_topups for select to authenticated
  using (company_id = public.lb_my_company());
create policy lb_paid on public.lb_wallet_topups as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Company admin: "I paid ₹X, UTR Y". Writes only a pending request.
create or replace function public.lb_wallet_request_topup(p_amount numeric, p_utr text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid := lb_my_company(); v_id uuid; v_utr text := regexp_replace(coalesce(p_utr, ''), '\s', '', 'g');
begin
  if v_company is null or not lb_is_admin_of(v_company) then raise exception 'Only an admin can add balance'; end if;
  if p_amount is null or p_amount < 100 or p_amount > 500000 then raise exception 'Amount must be between ₹100 and ₹5,00,000'; end if;
  if v_utr !~ '^[0-9]{12}$' then raise exception 'UTR / UPI reference must be the 12-digit number from your UPI app'; end if;
  if (select count(*) from lb_wallet_topups where company_id = v_company and status = 'pending') >= 5 then
    raise exception 'You already have 5 payments waiting for approval';
  end if;
  insert into lb_wallet_topups (company_id, amount, utr, requested_by)
  values (v_company, round(p_amount, 2), v_utr, auth.uid()) returning id into v_id;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (v_company, auth.uid(), 'wallet.topup_requested', 'lb_wallet_topups', v_id::text, jsonb_build_object('amount', p_amount, 'utr', v_utr));
  return v_id;
exception when unique_violation then
  raise exception 'This UTR has already been submitted';
end $$;
revoke all on function public.lb_wallet_request_topup(numeric, text) from public, anon;
grant execute on function public.lb_wallet_request_topup(numeric, text) to authenticated;

-- Super Admin (via service role from /platform): approve credits the wallet once.
create or replace function public.lb_wallet_review_topup(p_actor uuid, p_id uuid, p_approve boolean, p_note text default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare t lb_wallet_topups; v_wallet numeric;
begin
  select * into t from lb_wallet_topups where id = p_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if t.status <> 'pending' then raise exception 'This request was already %', t.status; end if;
  update lb_wallet_topups set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = p_actor, reviewed_at = now(), note = nullif(trim(p_note), '') where id = p_id;
  if p_approve then
    v_wallet := lb_wallet_add(t.company_id, t.amount, 'UPI ' || t.utr, t.id);
    update lb_wallet_txns set actor_id = p_actor where request_key = t.id;
  end if;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (t.company_id, p_actor, case when p_approve then 'wallet.topup_approved' else 'wallet.topup_rejected' end,
          'lb_wallet_topups', t.id::text, jsonb_build_object('amount', t.amount, 'utr', t.utr, 'note', p_note));
  return v_wallet;
end $$;
revoke all on function public.lb_wallet_review_topup(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.lb_wallet_review_topup(uuid, uuid, boolean, text) to service_role;

-- Roles were renamed after the wallet migration: 'admin' is now 'company_admin'.
create or replace function public.lb_wallet_topup_waba(p_number_id uuid, p_amount numeric, p_request_key uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.lb_my_company();
  v_wallet numeric;
  v_credits numeric;
  v_existing public.lb_wallet_txns;
begin
  if v_company is null then raise exception 'not signed in'; end if;
  if not public.lb_is_admin_of(v_company) then raise exception 'only admins can top up'; end if;
  if p_amount is null or p_amount < 1000 then raise exception 'minimum top-up is 1000'; end if;

  select * into v_existing from public.lb_wallet_txns where request_key = p_request_key;
  if found then
    return jsonb_build_object('wallet', v_existing.wallet_after, 'credits', v_existing.credits_after, 'duplicate', true);
  end if;

  select balance into v_wallet from public.lb_wallets where company_id = v_company for update;
  if coalesce(v_wallet, 0) < p_amount then raise exception 'insufficient wallet balance'; end if;

  update public.lb_wa_numbers set credit_balance = credit_balance + p_amount
   where id = p_number_id and company_id = v_company
   returning credit_balance into v_credits;
  if not found then raise exception 'number not found'; end if;

  update public.lb_wallets set balance = balance - p_amount, updated_at = now()
   where company_id = v_company returning balance into v_wallet;

  insert into public.lb_wallet_txns(company_id, kind, wa_number_id, amount, wallet_after, credits_after, actor_id, request_key)
  values (v_company, 'waba_topup', p_number_id, p_amount, v_wallet, v_credits, auth.uid(), p_request_key);

  insert into public.lb_audit_log(company_id, actor_id, action, entity, entity_id, data)
  values (v_company, auth.uid(), 'waba.topup', 'lb_wa_numbers', p_number_id::text, jsonb_build_object('amount', p_amount));

  return jsonb_build_object('wallet', v_wallet, 'credits', v_credits);
end $$;

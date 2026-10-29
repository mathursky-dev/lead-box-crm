-- Wallet (per company) + WABA credits (per number), funded from the wallet.
-- Applied 2026-10-22.

create table if not exists public.lb_wallets (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  balance numeric(12,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.lb_wa_numbers
  add column if not exists credit_balance numeric(12,2) not null default 0 check (credit_balance >= 0);

-- One ledger for both wallet and WABA credit movements.
create table if not exists public.lb_wallet_txns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  kind text not null check (kind in ('wallet_add','waba_topup','waba_usage','adjustment')),
  wa_number_id uuid references public.lb_wa_numbers(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  wallet_after numeric(12,2),
  credits_after numeric(12,2),
  reference text,
  actor_id uuid,
  request_key uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists lb_wallet_txns_company_idx on public.lb_wallet_txns(company_id, created_at desc);

alter table public.lb_wallets enable row level security;
alter table public.lb_wallet_txns enable row level security;

create policy lb_wallets_read on public.lb_wallets
  for select using (company_id = public.lb_my_company());
create policy lb_wallet_txns_read on public.lb_wallet_txns
  for select using (company_id = public.lb_my_company());
-- No insert/update policies: all writes go through the functions below.

-- Move money from the company wallet into one number's WABA credits.
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
  if coalesce(public.lb_my_role(), '') not in ('super_admin','admin') then raise exception 'only admins can top up'; end if;
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

-- Add money to a wallet. Service role only (payment webhook / manual credit).
create or replace function public.lb_wallet_add(p_company uuid, p_amount numeric, p_reference text, p_request_key uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_wallet numeric;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if exists (select 1 from public.lb_wallet_txns where request_key = p_request_key) then
    select balance into v_wallet from public.lb_wallets where company_id = p_company;
    return v_wallet;
  end if;
  insert into public.lb_wallets(company_id, balance) values (p_company, p_amount)
  on conflict (company_id) do update set balance = lb_wallets.balance + excluded.balance, updated_at = now()
  returning balance into v_wallet;
  insert into public.lb_wallet_txns(company_id, kind, amount, wallet_after, reference, request_key)
  values (p_company, 'wallet_add', p_amount, v_wallet, p_reference, p_request_key);
  return v_wallet;
end $$;

revoke all on function public.lb_wallet_add(uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.lb_wallet_add(uuid, numeric, text, uuid) to service_role;
revoke all on function public.lb_wallet_topup_waba(uuid, numeric, uuid) from public, anon;
grant execute on function public.lb_wallet_topup_waba(uuid, numeric, uuid) to authenticated;
grant select on public.lb_wallets, public.lb_wallet_txns to authenticated;

-- Manual credit from the CRM by a super admin (after UPI/bank payment received).
create or replace function public.lb_wallet_manual_credit(p_amount numeric, p_reference text, p_request_key uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.lb_my_company(); v_wallet numeric;
begin
  if coalesce(public.lb_my_role(), '') <> 'super_admin' then raise exception 'only super admin can credit the wallet'; end if;
  if coalesce(trim(p_reference), '') = '' then raise exception 'payment reference is required'; end if;
  v_wallet := public.lb_wallet_add(v_company, p_amount, p_reference, p_request_key);
  update public.lb_wallet_txns set actor_id = auth.uid() where request_key = p_request_key and actor_id is null;
  insert into public.lb_audit_log(company_id, actor_id, action, entity, entity_id, data)
  values (v_company, auth.uid(), 'wallet.manual_credit', 'lb_wallets', v_company::text,
          jsonb_build_object('amount', p_amount, 'reference', p_reference));
  return v_wallet;
end $$;
revoke all on function public.lb_wallet_manual_credit(numeric, text, uuid) from public, anon;
grant execute on function public.lb_wallet_manual_credit(numeric, text, uuid) to authenticated;

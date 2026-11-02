-- SaaS subscription billing without a payment gateway: a company admin pays the plan amount to the
-- platform UPI ID (the same one used for wallet top-ups, /platform/wallet) and submits the 12-digit UTR.
-- The Super Admin approves it in /platform/billing, which records the payment through lb_record_payment
-- (extends paid_until, idempotent per UTR) and moves the company onto that plan.
-- Razorpay checkout on /billing keeps working as before once RAZORPAY_* keys are set.
--
-- Also: daily renewal reminders to company admins 7, 3 and 1 day(s) before the plan or trial ends.
-- Safe to run more than once.

create table if not exists public.lb_plan_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  plan_id uuid references public.lb_plans(id) on delete set null,
  plan_name text not null,
  seats integer not null check (seats >= 1),
  period_days integer not null check (period_days between 1 and 3660),
  amount_inr integer not null check (amount_inr > 0),
  utr text not null check (utr ~ '^[0-9]{12}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references public.lb_profiles(id) on delete set null,
  reviewed_by uuid references public.lb_profiles(id) on delete set null,
  reviewed_at timestamptz,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists lb_plan_requests_utr on public.lb_plan_requests (utr) where status <> 'rejected';
create index if not exists lb_plan_requests_company on public.lb_plan_requests (company_id, created_at desc);
create index if not exists lb_plan_requests_pending on public.lb_plan_requests (created_at) where status = 'pending';

-- Readable by the company's admins even after the plan lapsed (so no lb_paid policy here, like lb_payments).
alter table public.lb_plan_requests enable row level security;
revoke all on public.lb_plan_requests from anon, authenticated;
grant select on public.lb_plan_requests to authenticated;
drop policy if exists lb_plan_requests_read on public.lb_plan_requests;
create policy lb_plan_requests_read on public.lb_plan_requests for select to authenticated
  using (public.lb_is_super() or public.lb_is_admin_of(company_id));

-- Company admin (server action, service role): "I paid the plan by UPI, UTR X".
-- The amount is worked out here from the plan and the active users, never taken from the browser.
create or replace function public.lb_plan_request(p_company uuid, p_actor uuid, p_plan uuid, p_utr text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pl lb_plans; v_seats integer; v_amount integer; v_id uuid; v_utr text := regexp_replace(coalesce(p_utr, ''), '\s', '', 'g');
begin
  select * into pl from lb_plans where id = p_plan and is_active;
  if pl.id is null then raise exception 'That plan is not available'; end if;
  if not pl.is_public and pl.id is distinct from (select plan_id from lb_billing where company_id = p_company) then
    raise exception 'That plan is not available';
  end if;
  if pl.price_inr = 0 then raise exception 'This plan is free. Contact us to activate it.'; end if;
  if v_utr !~ '^[0-9]{12}$' then raise exception 'UTR / UPI reference must be the 12-digit number from your UPI app'; end if;
  if (select count(*) from lb_plan_requests where company_id = p_company and status = 'pending') >= 3 then
    raise exception 'You already have payments waiting for approval';
  end if;
  select greatest(1, count(*)) into v_seats from lb_profiles where company_id = p_company and is_active;
  v_amount := pl.price_inr * case when pl.per_user then v_seats else 1 end;
  insert into lb_plan_requests (company_id, plan_id, plan_name, seats, period_days, amount_inr, utr, requested_by)
  values (p_company, pl.id, pl.name, v_seats, pl.period_days, v_amount, v_utr, p_actor) returning id into v_id;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (p_company, p_actor, 'billing.upi_submitted', 'lb_plan_requests', v_id::text,
    jsonb_build_object('plan', pl.name, 'amount', v_amount, 'seats', v_seats, 'utr', v_utr));
  -- Tell the platform Super Admins.
  insert into lb_notifications (company_id, user_id, type, title, body, link, dedupe_key)
  select s.company_id, s.id, 'billing', 'Plan payment to verify · ₹' || v_amount,
    (select name from lb_companies where id = p_company) || ' · ' || pl.name || ' · UTR ' || v_utr,
    '/platform/billing', 'planreq:' || v_id || ':' || s.id
  from lb_profiles s where s.role = 'super_admin' and s.is_active;
  return v_id;
exception when unique_violation then
  raise exception 'This UTR has already been submitted';
end $$;
revoke all on function public.lb_plan_request(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lb_plan_request(uuid, uuid, uuid, text) to service_role;

-- Super Admin (service role from /platform/billing): approve = payment recorded + plan switched.
create or replace function public.lb_plan_review(p_actor uuid, p_id uuid, p_approve boolean, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare r lb_plan_requests; v_admin record;
begin
  select * into r from lb_plan_requests where id = p_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %', r.status; end if;
  update lb_plan_requests set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = p_actor, reviewed_at = now(), note = nullif(trim(p_note), '') where id = p_id;
  if p_approve then
    perform lb_record_payment('upi_' || r.utr, r.company_id, 'upi', r.amount_inr::bigint * 100, 'INR', r.seats, r.period_days,
      jsonb_build_object('request_id', r.id, 'utr', r.utr, 'plan', r.plan_name));
    if r.plan_id is not null then
      update lb_billing set plan_id = r.plan_id, updated_at = now() where company_id = r.company_id;
    end if;
  end if;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
  values (r.company_id, p_actor, case when p_approve then 'billing.upi_approved' else 'billing.upi_rejected' end,
    'lb_plan_requests', r.id::text, jsonb_build_object('amount', r.amount_inr, 'utr', r.utr, 'note', p_note));
  for v_admin in select id from lb_profiles where company_id = r.company_id and is_active and role = 'company_admin' loop
    perform lb__notify(r.company_id, v_admin.id, 'billing',
      case when p_approve then 'Payment received · ' || r.plan_name || ' plan active' else 'Plan payment not verified' end,
      case when p_approve then 'Thank you! ₹' || r.amount_inr || ' (UTR ' || r.utr || ') is confirmed.'
           else coalesce(nullif(trim(p_note), ''), 'We could not match UTR ' || r.utr || '. Please check and submit again.') end,
      '/billing', 'planrev:' || r.id || ':' || v_admin.id);
  end loop;
  return p_approve;
end $$;
revoke all on function public.lb_plan_review(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.lb_plan_review(uuid, uuid, boolean, text) to service_role;

-- -------------------------------------------------------- renewal reminders
-- Runs daily at 10:00 IST. One bell notification per admin per milestone (dedupe key).
create or replace function public.lb_billing_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare b record; a record; v_end timestamptz; v_days integer; n integer := 0;
begin
  for b in select bl.*, c.name company_name from lb_billing bl join lb_companies c on c.id = bl.company_id
           where bl.plan <> 'internal' and bl.suspended_at is null and coalesce(c.is_demo, false) = false loop
    v_end := case when b.paid_until is not null and b.paid_until > now() then b.paid_until else b.trial_ends_at end;
    if v_end is null or v_end <= now() then continue; end if;
    v_days := ceil(extract(epoch from (v_end - now())) / 86400)::int;
    if v_days not in (1, 3, 7) then continue; end if;
    for a in select id from lb_profiles where company_id = b.company_id and is_active and role = 'company_admin' loop
      perform lb__notify(b.company_id, a.id, 'billing',
        case when b.paid_until is not null and b.paid_until > now() then 'Plan renews in ' else 'Free trial ends in ' end
          || v_days || ' day' || case when v_days = 1 then '' else 's' end,
        'Renew from Billing so your team keeps working without a break.', '/billing',
        'renew:' || b.company_id || ':' || to_char(v_end, 'YYYYMMDD') || ':' || v_days || ':' || a.id);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.lb_billing_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('lb-billing-reminders') where exists (select 1 from cron.job where jobname = 'lb-billing-reminders');
    perform cron.schedule('lb-billing-reminders', '30 4 * * *', 'select public.lb_billing_reminders()');
  end if;
end $$;

-- Gmail in lead history. Each user connects their own Gmail (Google OAuth, /settings/email).
-- Every few minutes the server pulls new mails and keeps only the ones to or from a customer's
-- email address in that company; they show on the lead page ("Emails" panel), and staff can send
-- a mail from the lead page through their Gmail. Mails with people who are not customers are never stored.
--
--   * lb_google_accounts   one per user; refresh token encrypted by the app (LB_SECRETS_KEY), no client access.
--   * lb_emails            matched mails (in/out), linked to customer + latest lead.
--   * cron 'lb-email-sync' every 5 min calls /api/jobs/email when at least one Gmail is connected.
-- Safe to run more than once.

create table if not exists public.lb_google_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  user_id uuid not null unique references public.lb_profiles(id) on delete cascade,
  email text not null,
  refresh_token_enc text not null,
  last_sync_at timestamptz,
  synced_until timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.lb_google_accounts enable row level security;
revoke all on public.lb_google_accounts from anon, authenticated;
-- Users see their own connection (never the token column).
grant select (id, company_id, user_id, email, last_sync_at, last_error, is_active, created_at) on public.lb_google_accounts to authenticated;
drop policy if exists lb_google_accounts_read on public.lb_google_accounts;
create policy lb_google_accounts_read on public.lb_google_accounts for select to authenticated
  using (user_id = auth.uid() or public.lb_is_admin_of(company_id));

create table if not exists public.lb_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  account_id uuid references public.lb_google_accounts(id) on delete set null,
  user_id uuid references public.lb_profiles(id) on delete set null,
  gmail_id text not null,
  thread_id text,
  direction text not null check (direction in ('in','out')),
  from_email text not null,
  to_emails text[] not null default '{}',
  subject text not null default '',
  snippet text not null default '',
  body_text text not null default '',
  sent_at timestamptz not null,
  customer_id uuid references public.lb_customers(id) on delete cascade,
  lead_id uuid references public.lb_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, gmail_id)
);
create index if not exists lb_emails_lead on public.lb_emails (lead_id, sent_at desc);
create index if not exists lb_emails_customer on public.lb_emails (customer_id, sent_at desc);
create index if not exists lb_customers_email_lower on public.lb_customers (company_id, lower(email)) where email is not null;

alter table public.lb_emails enable row level security;
revoke all on public.lb_emails from anon, authenticated;
grant select on public.lb_emails to authenticated;
drop policy if exists lb_emails_read on public.lb_emails;
create policy lb_emails_read on public.lb_emails for select to authenticated using (
  company_id = public.lb_my_company()
  and (case when lead_id is not null then public.lb_can_see_lead_id(lead_id) else public.lb_is_admin_of(company_id) end)
);
do $$ declare t text; begin
  foreach t in array array['lb_google_accounts','lb_emails'] loop
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- Server (service role): store one Gmail message if it involves a customer of the company.
-- p: {gmail_id, thread_id, direction, from_email, to_emails[], subject, snippet, body_text, sent_at}
-- Returns the email id, or null when no customer matched (nothing stored).
create or replace function public.lb_ingest_email(p_account uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare a lb_google_accounts; v_cust uuid; v_lead uuid; v_id uuid; v_addrs text[];
begin
  select * into a from lb_google_accounts where id = p_account;
  if a.id is null then raise exception 'Account not found'; end if;
  v_addrs := case when p->>'direction' = 'in' then array[lower(p->>'from_email')]
                  else array(select lower(x) from jsonb_array_elements_text(coalesce(p->'to_emails', '[]'::jsonb)) x) end;
  select c.id into v_cust from lb_customers c
  where c.company_id = a.company_id and c.email is not null and lower(c.email) = any(v_addrs)
  order by c.updated_at desc nulls last limit 1;
  if v_cust is null then return null; end if;
  select l.id into v_lead from lb_leads l where l.customer_id = v_cust and l.deleted_at is null
  order by lb__closed(l.status_category), l.created_at desc limit 1;
  insert into lb_emails (company_id, account_id, user_id, gmail_id, thread_id, direction, from_email, to_emails,
    subject, snippet, body_text, sent_at, customer_id, lead_id)
  values (a.company_id, a.id, a.user_id, p->>'gmail_id', p->>'thread_id', p->>'direction', lower(p->>'from_email'),
    array(select lower(x) from jsonb_array_elements_text(coalesce(p->'to_emails', '[]'::jsonb)) x),
    left(coalesce(p->>'subject', ''), 500), left(coalesce(p->>'snippet', ''), 500), left(coalesce(p->>'body_text', ''), 20000),
    coalesce((p->>'sent_at')::timestamptz, now()), v_cust, v_lead)
  on conflict (company_id, gmail_id) do nothing
  returning id into v_id;
  if v_id is not null and v_lead is not null then
    update lb_leads set last_activity_at = greatest(coalesce(last_activity_at, 'epoch'), coalesce((p->>'sent_at')::timestamptz, now()))
    where id = v_lead;
    -- New mail from the customer: tell the lead owner.
    if p->>'direction' = 'in' then
      perform lb__notify(a.company_id, (select owner_id from lb_leads where id = v_lead), 'email',
        'Email from ' || coalesce((select name from lb_customers where id = v_cust), p->>'from_email'),
        left(coalesce(nullif(p->>'subject', ''), p->>'snippet', ''), 140), '/leads/' || v_lead, 'email:' || v_id);
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.lb_ingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lb_ingest_email(uuid, jsonb) to service_role;

-- Every 5 minutes, only when someone has connected Gmail.
create or replace function public.lb__call_email_sync() returns void
language plpgsql security definer set search_path = public as $$
declare v_url text := (select value from lb_settings where key = 'app_url');
        v_tok text := (select value from lb_settings where key = 'jobs_token');
begin
  if v_url is null or v_tok is null then return; end if;
  if exists (select 1 from lb_google_accounts where is_active) then
    perform net.http_post(url := v_url || '/api/jobs/email', headers := jsonb_build_object('Authorization', 'Bearer ' || v_tok, 'Content-Type', 'application/json'),
                          body := '{}'::jsonb, timeout_milliseconds := 55000);
  end if;
end $$;
revoke execute on function public.lb__call_email_sync() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('lb-email-sync') where exists (select 1 from cron.job where jobname = 'lb-email-sync');
    perform cron.schedule('lb-email-sync', '*/5 * * * *', 'select public.lb__call_email_sync()');
  end if;
end $$;

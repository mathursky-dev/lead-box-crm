-- Multi-branch: one company, many branches, branch-wise data and reports.
--
-- Branches, lead.branch_id, user.branch_id and the "Branches" tab in 360
-- Reports already exist. This adds:
--   * branch details (code, city, address, phone, manager),
--   * "Branch access" per user (lb_profiles.branch_scope):
--       off (default) -> exactly as today, nothing changes;
--       on            -> the user works on their branch only: sees ALL leads,
--                        chats and customers of their branch (plus anything
--                        they own / are assigned), and nothing of other
--                        branches. Dashboard and reports are locked to the
--                        branch. Use it for branch managers / branch admins.
--   * new leads without a branch take their owner's branch (or creator's).
--
-- Safety: every new rule is gated on lb__branch_lock(), which is null unless a
-- user has branch_scope = true AND a branch set AND is not the Super Admin.
-- Company separation is untouched: every check still requires the open company.

-- ------------------------------------------------------------ 1. columns
alter table public.lb_branches add column if not exists code text check (char_length(code) <= 20);
alter table public.lb_branches add column if not exists city text check (char_length(city) <= 80);
alter table public.lb_branches add column if not exists address text check (char_length(address) <= 300);
alter table public.lb_branches add column if not exists phone text check (char_length(phone) <= 30);
alter table public.lb_branches add column if not exists manager_id uuid references public.lb_profiles(id) on delete set null;

alter table public.lb_profiles add column if not exists branch_scope boolean not null default false;

create index if not exists lb_leads_branch on public.lb_leads (company_id, branch_id) where branch_id is not null;
create index if not exists lb_profiles_branch on public.lb_profiles (company_id, branch_id) where branch_id is not null;

-- ------------------------------------------------------------ 2. helpers
-- The branch the signed-in user is locked to, or null (no lock: see as before).
create or replace function public.lb__branch_lock() returns uuid
language sql stable security definer set search_path = public as $$
  select p.branch_id from lb_profiles p
  where p.id = auth.uid() and p.is_active and p.branch_scope and p.branch_id is not null and p.role <> 'super_admin'
$$;

-- Does a conversation belong to the caller's locked branch (via its WhatsApp number or its lead)?
create or replace function public.lb__conv_in_my_branch(p_number uuid, p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select lb__branch_lock() is not null and (
    exists (select 1 from lb_wa_numbers n where n.id = p_number and n.branch_id = lb__branch_lock())
    or exists (select 1 from lb_leads l where l.id = p_lead and l.branch_id = lb__branch_lock()))
$$;

revoke execute on function public.lb__branch_lock(), public.lb__conv_in_my_branch(uuid, uuid) from public, anon;
grant execute on function public.lb__branch_lock(), public.lb__conv_in_my_branch(uuid, uuid) to authenticated;

-- Single-row checks used by most lead / chat RPCs and child-table policies.
create or replace function public.lb_can_see_lead_id(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select
      (lb_can_see_lead(company_id, team_id, owner_id)
        or (branch_id is not null and branch_id = lb__branch_lock() and company_id = lb_my_company()))
      and (lb__branch_lock() is null or branch_id = lb__branch_lock() or owner_id = auth.uid())
    from lb_leads where id = p_lead), false)
$$;

create or replace function public.lb_can_see_conversation_id(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select
      (lb_can_see_conversation(company_id, team_id, assignee_id, number_id)
        or (company_id = lb_my_company() and lb__conv_in_my_branch(number_id, lead_id)))
      and (lb__branch_lock() is null or assignee_id = auth.uid() or lb__conv_in_my_branch(number_id, lead_id))
    from lb_conversations where id = p_conv), false)
$$;

-- ------------------------------------------------------------ 3. RLS
-- Permissive "whole branch" read + restrictive "only my branch" filter.
-- (select f()) makes Postgres evaluate the helper once per query, not per row.

drop policy if exists lb_leads_branch_read on public.lb_leads;
create policy lb_leads_branch_read on public.lb_leads for select to authenticated using (
  branch_id is not null and branch_id = (select lb__branch_lock()) and company_id = (select lb_my_company())
  and (deleted_at is null or coalesce(current_setting('lb.show_deleted', true), '') = '1'));
drop policy if exists lb_leads_branch_lock on public.lb_leads;
create policy lb_leads_branch_lock on public.lb_leads as restrictive for select to authenticated using (
  (select lb__branch_lock()) is null or branch_id = (select lb__branch_lock()) or owner_id = auth.uid());

drop policy if exists lb_conversations_branch_read on public.lb_conversations;
create policy lb_conversations_branch_read on public.lb_conversations for select to authenticated using (
  (select lb__branch_lock()) is not null and company_id = (select lb_my_company()) and lb__conv_in_my_branch(number_id, lead_id));
drop policy if exists lb_conversations_branch_lock on public.lb_conversations;
create policy lb_conversations_branch_lock on public.lb_conversations as restrictive for select to authenticated using (
  (select lb__branch_lock()) is null or assignee_id = auth.uid() or lb__conv_in_my_branch(number_id, lead_id));

-- Customers follow the leads / chats you can see (both sub-queries run under RLS).
drop policy if exists lb_customers_branch_read on public.lb_customers;
create policy lb_customers_branch_read on public.lb_customers for select to authenticated using (
  (select lb__branch_lock()) is not null and company_id = (select lb_my_company())
  and exists (select 1 from lb_leads l where l.customer_id = lb_customers.id and l.branch_id = (select lb__branch_lock())));
drop policy if exists lb_customers_branch_lock on public.lb_customers;
create policy lb_customers_branch_lock on public.lb_customers as restrictive for select to authenticated using (
  (select lb__branch_lock()) is null
  or exists (select 1 from lb_leads l where l.customer_id = lb_customers.id)
  or exists (select 1 from lb_conversations v where v.customer_id = lb_customers.id));

-- ------------------------------------------------------------ 4. dashboard + reports
-- lb_metric_rows feeds the dashboard, 360 Reports, trend and drill-downs. For a
-- branch-locked user: force the branch filter and show the whole branch.
-- Patched in place so other recent changes to this function are kept.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.lb_metric_rows(jsonb)'::regprocedure);
  if position('lb__branch_lock()' in v_def) > 0 then return; end if;  -- already patched
  v_new := regexp_replace(v_def, '(v_users := lb_visible_user_ids\(\);\s*end if;)',
    E'\\1\n  -- Branch access: locked to one branch, see that whole branch.\n  if lb__branch_lock() is not null then f_branch := lb__branch_lock(); v_users := null; v_teams := null; end if;');
  if v_new = v_def then raise exception 'lb_metric_rows: patch point not found, nothing changed'; end if;
  execute v_new;
end $$;

-- ------------------------------------------------------------ 5. auto branch on new leads
create or replace function public.lb__lead_default_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    select p.branch_id into new.branch_id from lb_profiles p
    where p.id = coalesce(new.owner_id, new.created_by) and p.company_id = new.company_id and p.branch_id is not null;
  end if;
  return new;
end $$;
drop trigger if exists lb_leads_default_branch on public.lb_leads;
create trigger lb_leads_default_branch before insert on public.lb_leads
  for each row execute function public.lb__lead_default_branch();

-- When an unbranched lead gets its first owner, it takes the owner's branch.
create or replace function public.lb__lead_owner_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null and new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    select p.branch_id into new.branch_id from lb_profiles p
    where p.id = new.owner_id and p.company_id = new.company_id and p.branch_id is not null;
  end if;
  return new;
end $$;
drop trigger if exists lb_leads_owner_branch on public.lb_leads;
create trigger lb_leads_owner_branch before update of owner_id on public.lb_leads
  for each row execute function public.lb__lead_owner_branch();

revoke execute on function public.lb__lead_default_branch(), public.lb__lead_owner_branch() from public, anon, authenticated;

-- ------------------------------------------------------------ 6. branch summary
-- One row per branch (plus "no branch") for the Branches page: users, leads, open,
-- won this month and won value. Runs as the caller, so RLS decides what is counted.
create or replace function public.lb_branch_summary(p_from timestamptz default date_trunc('month', now()))
returns table (branch_id uuid, users bigint, leads bigint, open_leads bigint, new_leads bigint, won bigint, won_value numeric, lost bigint, overdue bigint)
language sql stable security invoker set search_path = public as $$
  with l as (select * from lb_leads where company_id = lb_my_company() and deleted_at is null),
  k as (select distinct branch_id from l union select id from lb_branches where company_id = lb_my_company() and is_active)
  select k.branch_id,
    (select count(*) from lb_profiles u where u.company_id = lb_my_company() and u.is_active and u.branch_id is not distinct from k.branch_id),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id and l.status_category not in ('won','lost','invalid','converted')),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id and l.created_at >= p_from),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id and l.converted_at >= p_from),
    (select coalesce(sum(coalesce(l.won_value, l.expected_value, 0)), 0) from l where l.branch_id is not distinct from k.branch_id and l.converted_at >= p_from),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id and l.status_category = 'lost' and l.closed_at >= p_from),
    (select count(*) from l where l.branch_id is not distinct from k.branch_id and l.next_followup_at < now() and l.status_category not in ('won','lost','invalid','converted'))
  from k
$$;
revoke execute on function public.lb_branch_summary(timestamptz) from public, anon;
grant execute on function public.lb_branch_summary(timestamptz) to authenticated;

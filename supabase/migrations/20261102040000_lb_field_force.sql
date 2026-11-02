-- Field force: attendance (check-in / check-out with GPS), field visits and
-- expense claims with manager approval. Works with the offline queue on /field:
-- every row carries a client_id made on the phone, so a retried sync never
-- creates a second copy.
--
-- Who sees what: everyone sees their own rows; team leaders see their team's
-- (lb_visible_user_ids), admins the whole company. Everything is scoped to
-- lb_my_company(), so a Super Admin sees only the company switched in the top bar.
-- Expenses: the owner edits/deletes a claim only while it is pending; a team
-- leader approves/rejects their team's claims (not their own); an admin can
-- approve any claim and mark approved ones paid. The owner is notified.
-- Receipts and visit photos live in the private "lb-field" bucket
-- ({company_id}/{user_id}/{uuid}.jpg); the app reads them with signed URLs.
-- Idempotent: safe to run more than once.

-- ── Attendance ────────────────────────────────────────────────────────────
create table if not exists public.lb_attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete restrict,
  user_id uuid not null default auth.uid() references public.lb_profiles(id) on delete cascade,
  client_id uuid not null,
  check_in_at timestamptz not null,
  in_lat double precision, in_lng double precision, in_acc real,
  in_note text not null default '' check (length(in_note) <= 500),
  check_out_at timestamptz,
  out_lat double precision, out_lng double precision, out_acc real,
  out_note text not null default '' check (length(out_note) <= 500),
  -- true when the punch reached the server more than 5 minutes after it was made (saved offline).
  synced_late boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  check (check_out_at is null or check_out_at >= check_in_at),
  check (in_lat is null or in_lat between -90 and 90), check (in_lng is null or in_lng between -180 and 180),
  check (out_lat is null or out_lat between -90 and 90), check (out_lng is null or out_lng between -180 and 180)
);
create index if not exists lb_attendance_company_day on public.lb_attendance (company_id, check_in_at desc);
create index if not exists lb_attendance_user on public.lb_attendance (user_id, check_in_at desc);

-- ── Field visits ──────────────────────────────────────────────────────────
create table if not exists public.lb_field_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete restrict,
  user_id uuid not null default auth.uid() references public.lb_profiles(id) on delete cascade,
  client_id uuid not null,
  lead_id uuid references public.lb_leads(id) on delete set null,
  customer_name text not null default '' check (length(customer_name) <= 200),
  purpose text not null default '' check (length(purpose) <= 200),
  started_at timestamptz not null,
  start_lat double precision, start_lng double precision, start_acc real,
  ended_at timestamptz,
  end_lat double precision, end_lng double precision, end_acc real,
  outcome text check (outcome in ('interested','follow_up','order','not_interested','not_met','other')),
  notes text not null default '' check (length(notes) <= 4000),
  photo_path text,
  synced_late boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  check (ended_at is null or ended_at >= started_at),
  check (start_lat is null or start_lat between -90 and 90), check (start_lng is null or start_lng between -180 and 180),
  check (end_lat is null or end_lat between -90 and 90), check (end_lng is null or end_lng between -180 and 180)
);
create index if not exists lb_field_visits_company on public.lb_field_visits (company_id, started_at desc);
create index if not exists lb_field_visits_user on public.lb_field_visits (user_id, started_at desc);
create index if not exists lb_field_visits_lead on public.lb_field_visits (lead_id) where lead_id is not null;

-- ── Expense claims ────────────────────────────────────────────────────────
create table if not exists public.lb_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete restrict,
  user_id uuid not null default auth.uid() references public.lb_profiles(id) on delete cascade,
  client_id uuid not null,
  expense_no bigint generated always as identity,
  expense_date date not null,
  category text not null check (category in ('travel','fuel','food','stay','client','phone','other')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  km numeric(8,1) check (km is null or (km >= 0 and km <= 100000)),
  description text not null default '' check (length(description) <= 1000),
  visit_id uuid references public.lb_field_visits(id) on delete set null,
  lead_id uuid references public.lb_leads(id) on delete set null,
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  reviewed_by uuid references public.lb_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (length(review_note) <= 500),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists lb_expenses_company on public.lb_expenses (company_id, expense_date desc);
create index if not exists lb_expenses_user on public.lb_expenses (user_id, expense_date desc);
create index if not exists lb_expenses_pending on public.lb_expenses (company_id, created_at) where status = 'pending';

-- ── Helpers ───────────────────────────────────────────────────────────────
-- Row belongs to the active company and its user is the caller / their team / (admin) anyone.
create or replace function public.lb_can_see_user_row(p_company uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_company = lb_my_company() and p_user = any(coalesce(lb_visible_user_ids(), '{}'))
$$;
revoke all on function public.lb_can_see_user_row(uuid, uuid) from public, anon;
grant execute on function public.lb_can_see_user_row(uuid, uuid) to authenticated;

-- Can the caller approve / reject this user's expense? Admins: anyone. Team leaders: their team, not themselves.
create or replace function public.lb_can_review_expense(p_company uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_company = lb_my_company() and (
    lb_is_admin_of(p_company)
    or (lb_my_role() = 'team_leader' and p_user <> auth.uid() and p_user = any(coalesce(lb_visible_user_ids(), '{}')))
  )
$$;
revoke all on function public.lb_can_review_expense(uuid, uuid) from public, anon;
grant execute on function public.lb_can_review_expense(uuid, uuid) to authenticated;

-- Times sent by the phone: not in the future, not older than 7 days (an offline week at most).
create or replace function public.lb__field_time(p timestamptz) returns timestamptz
language plpgsql stable as $$
begin
  if p is null then return null; end if;
  if p > now() + interval '5 minutes' then raise exception 'Time is in the future: check the phone clock'; end if;
  if p < now() - interval '7 days' then raise exception 'Entry is older than 7 days'; end if;
  return least(p, now());
end $$;

-- ── Triggers ──────────────────────────────────────────────────────────────
create or replace function public.lb__attendance_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.created_at := now();
    new.check_in_at := lb__field_time(new.check_in_at);
    new.synced_late := new.check_in_at < now() - interval '5 minutes';
  else
    new.company_id := old.company_id; new.user_id := old.user_id; new.client_id := old.client_id;
    new.created_at := old.created_at; new.check_in_at := old.check_in_at;
    new.in_lat := old.in_lat; new.in_lng := old.in_lng; new.in_acc := old.in_acc;
    if old.check_out_at is not null then
      -- A finished session is fixed.
      new.check_out_at := old.check_out_at; new.out_lat := old.out_lat; new.out_lng := old.out_lng; new.out_acc := old.out_acc;
    end if;
  end if;
  if new.check_out_at is not null and (tg_op = 'INSERT' or old.check_out_at is null) then
    new.check_out_at := greatest(lb__field_time(new.check_out_at), new.check_in_at);
    if new.check_out_at < now() - interval '5 minutes' then new.synced_late := true; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists lb_attendance_write on public.lb_attendance;
create trigger lb_attendance_write before insert or update on public.lb_attendance
  for each row execute function public.lb__attendance_write();

create or replace function public.lb__visit_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare l lb_leads; v_body text;
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.created_at := now();
    new.started_at := lb__field_time(new.started_at);
    new.synced_late := new.started_at < now() - interval '5 minutes';
  else
    new.company_id := old.company_id; new.user_id := old.user_id; new.client_id := old.client_id;
    new.created_at := old.created_at; new.started_at := old.started_at;
    new.start_lat := old.start_lat; new.start_lng := old.start_lng; new.start_acc := old.start_acc;
    if old.ended_at is not null then
      new.ended_at := old.ended_at; new.end_lat := old.end_lat; new.end_lng := old.end_lng; new.end_acc := old.end_acc;
    end if;
  end if;
  if new.ended_at is not null and (tg_op = 'INSERT' or old.ended_at is null) then
    new.ended_at := greatest(lb__field_time(new.ended_at), new.started_at);
  end if;
  new.customer_name := trim(new.customer_name);
  new.purpose := trim(new.purpose);
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id) then
    select * into l from lb_leads where id = new.lead_id and company_id = new.company_id;
    if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
      raise exception 'Lead not found in this company';
    end if;
  end if;
  new.updated_at := now();

  -- When the visit is finished, it goes on the lead's timeline as work activity.
  if new.lead_id is not null and new.ended_at is not null and (tg_op = 'INSERT' or old.ended_at is null) then
    if l.id is null then select * into l from lb_leads where id = new.lead_id; end if;
    v_body := 'Field visit' || coalesce(' · ' || nullif(new.purpose, ''), '')
      || coalesce(' · ' || case new.outcome when 'interested' then 'Interested' when 'follow_up' then 'Follow-up needed'
           when 'order' then 'Order received' when 'not_interested' then 'Not interested' when 'not_met' then 'Customer not met'
           when 'other' then 'Other' end, '')
      || coalesce(E'\n' || nullif(trim(new.notes), ''), '');
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
    values (new.company_id, new.lead_id, new.user_id, l.owner_id, 'note', true,
      jsonb_build_object('body', left(v_body, 2000), 'visit_id', new.id, 'lat', new.start_lat, 'lng', new.start_lng), new.ended_at);
    update lb_leads set last_activity_at = greatest(coalesce(last_activity_at, new.ended_at), new.ended_at) where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists lb_field_visits_write on public.lb_field_visits;
create trigger lb_field_visits_write before insert or update on public.lb_field_visits
  for each row execute function public.lb__visit_write();

create or replace function public.lb__expense_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_review boolean; v_name text;
begin
  if tg_op = 'INSERT' then
    new.user_id := coalesce(v_me, new.user_id);
    new.created_at := now();
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := ''; new.paid_at := null;
    if new.expense_date > (now() at time zone 'Asia/Kolkata')::date + 1 then raise exception 'Expense date is in the future'; end if;
    if new.expense_date < (now() at time zone 'Asia/Kolkata')::date - 120 then raise exception 'Expense is older than 120 days'; end if;
  else
    new.company_id := old.company_id; new.user_id := old.user_id; new.client_id := old.client_id;
    new.expense_no := old.expense_no; new.created_at := old.created_at;
    v_review := lb_can_review_expense(old.company_id, old.user_id);
    if new.status is distinct from old.status then
      if not v_review then raise exception 'Only a manager can approve or reject expenses' using errcode = '42501'; end if;
      if new.status = 'pending' then raise exception 'A reviewed expense cannot go back to pending'; end if;
      if new.status = 'paid' and (old.status <> 'approved' or not lb_is_admin_of(old.company_id)) then
        raise exception 'Only an admin can mark an approved expense as paid';
      end if;
      if old.status = 'paid' then raise exception 'This expense is already paid'; end if;
      if new.status in ('approved','rejected') then new.reviewed_by := v_me; new.reviewed_at := now(); end if;
      if new.status = 'paid' then new.paid_at := now(); new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; end if;
      if new.status = 'rejected' and coalesce(trim(new.review_note), '') = '' then raise exception 'Write why it is rejected'; end if;
    else
      new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.paid_at := old.paid_at;
      if new.review_note is distinct from old.review_note and not v_review then new.review_note := old.review_note; end if;
    end if;
    -- The claim itself changes only while pending, and only by its owner.
    if (new.expense_date, new.category, new.amount, new.km, new.description, new.visit_id, new.lead_id, new.receipt_path)
       is distinct from (old.expense_date, old.category, old.amount, old.km, old.description, old.visit_id, old.lead_id, old.receipt_path) then
      if old.status <> 'pending' or old.user_id is distinct from v_me then
        raise exception 'Only a pending claim can be edited, by the person who made it';
      end if;
    end if;
  end if;
  new.description := trim(new.description);
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not exists (select 1 from lb_leads where id = new.lead_id and company_id = new.company_id) then
    raise exception 'Lead not found in this company';
  end if;
  if new.visit_id is not null and (tg_op = 'INSERT' or new.visit_id is distinct from old.visit_id)
     and not exists (select 1 from lb_field_visits where id = new.visit_id and company_id = new.company_id and user_id = new.user_id) then
    raise exception 'Visit not found';
  end if;
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.user_id is distinct from v_me then
    select full_name into v_name from lb_profiles where id = v_me;
    perform lb__notify(new.company_id, new.user_id, 'expense_' || new.status,
      'Expense ' || case new.status when 'approved' then 'approved' when 'rejected' then 'rejected' else 'paid' end
        || ': ₹' || to_char(new.amount, 'FM99,99,99,990.00'),
      coalesce(v_name, 'Your manager') || case new.status when 'paid' then ' marked it paid' else ' ' || new.status || ' it' end
        || coalesce(' · ' || nullif(trim(new.review_note), ''), ''),
      '/field/expenses?id=' || new.id, null);
  end if;
  return new;
end $$;
drop trigger if exists lb_expenses_write on public.lb_expenses;
create trigger lb_expenses_write before insert or update on public.lb_expenses
  for each row execute function public.lb__expense_write();

-- ── Row level security ────────────────────────────────────────────────────
alter table public.lb_attendance enable row level security;
alter table public.lb_field_visits enable row level security;
alter table public.lb_expenses enable row level security;
revoke all on public.lb_attendance, public.lb_field_visits, public.lb_expenses from anon;
grant select, insert, update, delete on public.lb_attendance, public.lb_field_visits, public.lb_expenses to authenticated;

do $$
declare t text;
begin
  foreach t in array array['lb_attendance','lb_field_visits','lb_expenses'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('drop policy if exists lb_paid on public.%I', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (public.lb_can_see_user_row(company_id, user_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (company_id = public.lb_my_company() and user_id = auth.uid())', t, t);
    execute format('create policy lb_paid on public.%I as restrictive for all to authenticated using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()))', t);
  end loop;
end $$;

-- Attendance & visits: the owner updates their own rows (check-out, end visit); an admin can delete a wrong entry.
create policy lb_attendance_update on public.lb_attendance for update to authenticated
  using (company_id = public.lb_my_company() and user_id = auth.uid()) with check (company_id = public.lb_my_company());
create policy lb_attendance_delete on public.lb_attendance for delete to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
create policy lb_field_visits_update on public.lb_field_visits for update to authenticated
  using (company_id = public.lb_my_company() and user_id = auth.uid()) with check (company_id = public.lb_my_company());
create policy lb_field_visits_delete on public.lb_field_visits for delete to authenticated
  using (company_id = public.lb_my_company() and public.lb_is_admin_of(company_id));
-- Expenses: owner (rules in the trigger) or a reviewer; delete own pending claim, or admin.
create policy lb_expenses_update on public.lb_expenses for update to authenticated
  using (company_id = public.lb_my_company() and (user_id = auth.uid() or public.lb_can_review_expense(company_id, user_id)))
  with check (company_id = public.lb_my_company());
create policy lb_expenses_delete on public.lb_expenses for delete to authenticated
  using (company_id = public.lb_my_company() and ((user_id = auth.uid() and status = 'pending') or public.lb_is_admin_of(company_id)));

-- Private bucket for receipts and visit photos; no client policies (server uses signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lb-field', 'lb-field', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Tasks: users create a task and assign it to anyone in their company
-- (optionally linked to a lead / customer), with priority, status and end date.
--
-- Who sees a task: admins see every task of the company; everyone else sees
-- tasks assigned to them or by them, and team leaders also see their team's.
-- Everything is scoped to lb_my_company(), so a Super Admin sees only the
-- company that is switched in the top bar.
-- Idempotent: safe to run more than once.

create table if not exists public.lb_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.lb_my_company() references public.lb_companies(id) on delete restrict,
  task_no bigint generated always as identity,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  status text not null default 'created' check (status in ('created','in_progress','on_hold','completed','cancelled')),
  -- 1 lowest · 2 low · 3 medium · 4 high · 5 highest
  priority smallint not null default 3 check (priority between 1 and 5),
  assigned_by uuid default auth.uid() references public.lb_profiles(id) on delete set null,
  assigned_to uuid references public.lb_profiles(id) on delete set null,
  lead_id uuid references public.lb_leads(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.lb_profiles(id) on delete set null
);
create index if not exists lb_tasks_company_created on public.lb_tasks (company_id, created_at desc);
create index if not exists lb_tasks_assignee_open on public.lb_tasks (company_id, assigned_to, due_at) where status not in ('completed','cancelled');
create index if not exists lb_tasks_assigner on public.lb_tasks (company_id, assigned_by);
create index if not exists lb_tasks_lead on public.lb_tasks (lead_id) where lead_id is not null;

-- Can the caller see / edit this task? (company match + admin / own / team)
create or replace function public.lb_can_see_task(p_company uuid, p_by uuid, p_to uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_company = lb_my_company() and (
    lb_is_admin_of(p_company)
    or p_by = auth.uid() or p_to = auth.uid()
    or (lb_my_role() = 'team_leader' and (p_to = any(lb_visible_user_ids()) or p_by = any(lb_visible_user_ids())))
  )
$$;
revoke all on function public.lb_can_see_task(uuid, uuid, uuid) from public, anon;
grant execute on function public.lb_can_see_task(uuid, uuid, uuid) to authenticated;

-- Checks + housekeeping on every write; notifies the assignee.
create or replace function public.lb__task_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_name text;
begin
  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(v_me, new.assigned_by);
    new.created_at := now();
  else
    -- These never change after creation.
    new.company_id := old.company_id; new.task_no := old.task_no; new.created_at := old.created_at; new.assigned_by := old.assigned_by;
  end if;
  new.title := trim(new.title);
  new.updated_at := now();
  new.updated_by := coalesce(v_me, new.updated_by);
  if new.assigned_to is not null and not exists (select 1 from lb_profiles where id = new.assigned_to and company_id = new.company_id) then
    raise exception 'Assignee is not a user of this company';
  end if;
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not exists (select 1 from lb_leads where id = new.lead_id and company_id = new.company_id) then
    raise exception 'Lead not found in this company';
  end if;
  if new.status = 'completed' then new.completed_at := coalesce(case when tg_op = 'UPDATE' then old.completed_at end, now());
  else new.completed_at := null; end if;

  if new.assigned_to is not null and new.assigned_to is distinct from v_me
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    select full_name into v_name from lb_profiles where id = v_me;
    perform lb__notify(new.company_id, new.assigned_to, 'task_assigned',
      'New task: ' || left(new.title, 80),
      coalesce(v_name, 'Someone') || ' assigned you a task' || coalesce(' · due ' || to_char(new.due_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), ''),
      '/tasks?task=' || new.id, null);
  end if;
  return new;
end $$;
drop trigger if exists lb_tasks_write on public.lb_tasks;
create trigger lb_tasks_write before insert or update on public.lb_tasks
  for each row execute function public.lb__task_write();

alter table public.lb_tasks enable row level security;
revoke all on public.lb_tasks from anon;
grant select, insert, update, delete on public.lb_tasks to authenticated;
drop policy if exists lb_tasks_read on public.lb_tasks;
drop policy if exists lb_tasks_insert on public.lb_tasks;
drop policy if exists lb_tasks_update on public.lb_tasks;
drop policy if exists lb_tasks_delete on public.lb_tasks;
drop policy if exists lb_paid on public.lb_tasks;
create policy lb_tasks_read on public.lb_tasks for select to authenticated
  using (public.lb_can_see_task(company_id, assigned_by, assigned_to));
create policy lb_tasks_insert on public.lb_tasks for insert to authenticated
  with check (company_id = public.lb_my_company());
create policy lb_tasks_update on public.lb_tasks for update to authenticated
  using (public.lb_can_see_task(company_id, assigned_by, assigned_to))
  with check (company_id = public.lb_my_company());
-- Delete: the person who created the task, or an admin.
create policy lb_tasks_delete on public.lb_tasks for delete to authenticated
  using (company_id = public.lb_my_company() and (assigned_by = auth.uid() or public.lb_is_admin_of(company_id)));
create policy lb_paid on public.lb_tasks as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

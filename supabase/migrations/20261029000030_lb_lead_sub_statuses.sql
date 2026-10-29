-- Lead sub-statuses: an admin-managed master list of finer outcomes under a
-- sales status (e.g. Not picked / Switched off / Out of station under
-- Follow-up). A sub-status either belongs to one parent status or, with
-- status_id null, can be used under any status. Per company.

create table if not exists public.lb_lead_sub_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  status_id uuid references public.lb_lead_statuses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists lb_lead_sub_statuses_name
  on public.lb_lead_sub_statuses (company_id, coalesce(status_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists lb_lead_sub_statuses_company on public.lb_lead_sub_statuses (company_id, sort_order);

-- The parent status must be from the same company.
create or replace function public.lb__sub_status_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status_id is not null and not exists
     (select 1 from lb_lead_statuses where id = new.status_id and company_id = new.company_id) then
    raise exception 'Parent status belongs to another company';
  end if;
  return new;
end $$;
drop trigger if exists lb_lead_sub_statuses_check on public.lb_lead_sub_statuses;
create trigger lb_lead_sub_statuses_check before insert or update on public.lb_lead_sub_statuses
  for each row execute function public.lb__sub_status_check();

alter table public.lb_lead_sub_statuses enable row level security;
revoke all on public.lb_lead_sub_statuses from anon;
grant select, insert, update, delete on public.lb_lead_sub_statuses to authenticated;
drop policy if exists lb_lead_sub_statuses_read on public.lb_lead_sub_statuses;
drop policy if exists lb_lead_sub_statuses_ins on public.lb_lead_sub_statuses;
drop policy if exists lb_lead_sub_statuses_upd on public.lb_lead_sub_statuses;
drop policy if exists lb_lead_sub_statuses_del on public.lb_lead_sub_statuses;
drop policy if exists lb_paid on public.lb_lead_sub_statuses;
create policy lb_lead_sub_statuses_read on public.lb_lead_sub_statuses for select to authenticated
  using (public.lb_is_super() or company_id = public.lb_my_company());
create policy lb_lead_sub_statuses_ins on public.lb_lead_sub_statuses for insert to authenticated
  with check (public.lb_is_admin_of(company_id));
create policy lb_lead_sub_statuses_upd on public.lb_lead_sub_statuses for update to authenticated
  using (public.lb_is_admin_of(company_id)) with check (public.lb_is_admin_of(company_id));
create policy lb_lead_sub_statuses_del on public.lb_lead_sub_statuses for delete to authenticated
  using (public.lb_is_admin_of(company_id));
create policy lb_paid on public.lb_lead_sub_statuses as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- ------------------------------------------------------------ lead column
alter table public.lb_leads add column if not exists sub_status_id uuid
  references public.lb_lead_sub_statuses(id) on delete set null;
create index if not exists lb_leads_sub_status on public.lb_leads (company_id, sub_status_id) where sub_status_id is not null;

-- Moving a lead to a status the sub-status does not belong to clears it.
create or replace function public.lb__lead_sub_status_fit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sub_status_id is not null and not exists
     (select 1 from lb_lead_sub_statuses where id = new.sub_status_id
        and (status_id is null or status_id = new.status_id)) then
    new.sub_status_id := null;
  end if;
  return new;
end $$;
drop trigger if exists lb_leads_sub_status_fit on public.lb_leads;
create trigger lb_leads_sub_status_fit before update of status_id on public.lb_leads
  for each row when (new.status_id is distinct from old.status_id)
  execute function public.lb__lead_sub_status_fit();

-- ------------------------------------------------------------ set sub-status
create or replace function public.lb_set_sub_status(p_lead uuid, p_sub_status uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; sub lb_lead_sub_statuses; v_old text;
begin
  if not lb_can('leads.status') then raise exception 'You do not have permission to change lead status' using errcode='42501'; end if;
  if not lb_can_see_lead_id(p_lead) then raise exception 'Not permitted' using errcode='42501'; end if;
  select * into l from lb_leads where id = p_lead for update;
  if l.sub_status_id is not distinct from p_sub_status then return; end if;
  if p_sub_status is not null then
    select * into sub from lb_lead_sub_statuses
    where id = p_sub_status and company_id = l.company_id and is_active
      and (status_id is null or status_id = l.status_id);
    if sub.id is null then raise exception 'That sub-status does not fit the lead''s status'; end if;
  end if;
  select name into v_old from lb_lead_sub_statuses where id = l.sub_status_id;
  update lb_leads set sub_status_id = p_sub_status, last_activity_at = now(), updated_at = now() where id = p_lead;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, p_lead, me.id, l.owner_id, 'field_update', true,
          jsonb_build_object('sub_status', coalesce(sub.name, ''), 'from_sub_status', v_old));
end $$;
revoke all on function public.lb_set_sub_status(uuid, uuid) from public, anon;
grant execute on function public.lb_set_sub_status(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ defaults
create or replace function public.lb__seed_sub_statuses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lb_lead_sub_statuses (company_id, name, sort_order) values
    (new.id, 'Not picked', 10), (new.id, 'Switched off', 20), (new.id, 'Out of station', 30), (new.id, 'Other', 90)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists lb_companies_seed_sub_statuses on public.lb_companies;
create trigger lb_companies_seed_sub_statuses after insert on public.lb_companies
  for each row execute function public.lb__seed_sub_statuses();

insert into public.lb_lead_sub_statuses (company_id, name, sort_order)
select c.id, d.name, d.ord from public.lb_companies c
cross join (values ('Not picked', 10), ('Switched off', 20), ('Out of station', 30), ('Other', 90)) d(name, ord)
where not exists (select 1 from public.lb_lead_sub_statuses x where x.company_id = c.id)
on conflict do nothing;

-- ------------------------------------------------------------ leads list
-- Same as before plus sub_status_id filter and sub_status_* columns.
create or replace function public.lb_list_leads(p jsonb)
returns jsonb language sql stable set search_path = public as $$
  with q as (
    select l.*, c.name customer_name, c.phone_e164, c.email, s.name status_name, ss.name sub_status_name, o.full_name owner_name,
           pr.name product_name, so.name source_name
    from lb_leads l join lb_customers c on c.id = l.customer_id
    join lb_lead_statuses s on s.id = l.status_id left join lb_profiles o on o.id = l.owner_id
    left join lb_lead_sub_statuses ss on ss.id = l.sub_status_id
    left join lb_products pr on pr.id = l.product_id left join lb_sources so on so.id = l.source_id
    where (nullif(p->>'q','') is null
           or c.name ilike '%' || (p->>'q') || '%' or c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%'
              and regexp_replace(p->>'q','\D','','g') <> ''
           or c.email ilike '%' || (p->>'q') || '%' or ('LB-' || l.lead_no) ilike '%' || (p->>'q') || '%')
      and (nullif(p->>'status_id','') is null or l.status_id = (p->>'status_id')::uuid)
      and (nullif(p->>'sub_status_id','') is null or l.sub_status_id = (p->>'sub_status_id')::uuid)
      and (nullif(p->>'category','') is null or l.status_category = p->>'category')
      and (nullif(p->>'owner_id','') is null or l.owner_id = (p->>'owner_id')::uuid)
      and (coalesce((p->>'unassigned')::boolean, false) = false or l.owner_id is null)
      and (coalesce((p->>'open_only')::boolean, false) = false or not lb__closed(l.status_category))
      and (nullif(p->>'branch_id','') is null or l.branch_id = (p->>'branch_id')::uuid)
      and (nullif(p->>'department_id','') is null or l.department_id = (p->>'department_id')::uuid)
      and (nullif(p->>'team_id','') is null or l.team_id = (p->>'team_id')::uuid)
      and (nullif(p->>'product_id','') is null or l.product_id = (p->>'product_id')::uuid)
      and (nullif(p->>'source_id','') is null or l.source_id = (p->>'source_id')::uuid)
      and (nullif(p->>'number_id','') is null or l.number_id = (p->>'number_id')::uuid)
      and (nullif(p->>'priority','') is null or l.priority = any(string_to_array(p->>'priority', ',')))
      and (coalesce((p->>'stale')::boolean, false) = false or l.last_activity_at < now() - interval '14 days')
      and (nullif(p->>'tag_id','') is null or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id = (p->>'tag_id')::uuid))
      and (nullif(p->>'from','') is null or l.created_at >= (p->>'from')::timestamptz)
      and (nullif(p->>'to','') is null or l.created_at < (p->>'to')::timestamptz)
      and (nullif(p->>'followup','') is null
           or (p->>'followup' = 'today' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                 and f.due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'))
           or (p->>'followup' = 'overdue' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')))
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select id, lead_no, customer_id, customer_name, phone_e164, email, status_id, status_name, status_category,
             sub_status_id, sub_status_name, priority,
             owner_id, owner_name, product_name, source_name, expected_value, won_value, created_at, assigned_at,
             last_activity_at, next_followup_at, converted_at
      from q order by
        case when p->>'sort' = 'created' then created_at end desc,
        case when p->>'sort' = 'followup' then next_followup_at end asc nulls last,
        last_activity_at desc
      limit least(coalesce((p->>'limit')::int, 50), 500) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
$$;

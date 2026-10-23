-- Configurable role permission matrix. Admin roles always have everything;
-- a user's own `permissions` array grants extras on top of their role.

create table lb_permission_catalog (
  key text primary key,
  label text not null,
  module text not null,
  sort_order integer not null,
  agent_default boolean not null,
  team_leader_default boolean not null
);
insert into lb_permission_catalog values
  ('leads.create',   'Create leads',                 'Leads',     10, true,  true),
  ('leads.edit',     'Edit lead details',            'Leads',     20, true,  true),
  ('leads.status',   'Change lead status',           'Leads',     30, true,  true),
  ('leads.assign',   'Assign / reassign leads',      'Leads',     40, false, true),
  ('leads.import',   'Import leads (CSV)',           'Leads',     50, false, true),
  ('leads.export',   'Export leads (CSV)',           'Leads',     60, false, false),
  ('chats.send',     'Send WhatsApp messages',       'WhatsApp',  70, true,  true),
  ('chats.transfer', 'Transfer chats',               'WhatsApp',  80, true,  true),
  ('reports.view',   'View 360 Reports',             'Reports',   90, true,  true),
  ('customers.view', 'View Customer 360 directory',  'Customers', 100, true, true);

create table lb_role_permissions (
  company_id uuid not null references lb_companies(id) on delete cascade,
  role text not null check (role in ('team_leader','agent')),
  permission text not null references lb_permission_catalog(key) on delete cascade,
  allowed boolean not null,
  updated_by uuid references lb_profiles(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, role, permission)
);

alter table lb_permission_catalog enable row level security;
alter table lb_role_permissions enable row level security;
revoke all on lb_permission_catalog, lb_role_permissions from anon;
create policy lb_permission_catalog_read on lb_permission_catalog for select to authenticated using (true);
create policy lb_role_permissions_read on lb_role_permissions for select to authenticated
  using (lb_is_super() or company_id = lb_my_company());
create policy lb_role_permissions_write on lb_role_permissions for all to authenticated
  using (lb_is_admin_of(company_id)) with check (lb_is_admin_of(company_id));

-- Effective check for the current user.
create or replace function lb_can(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role in ('super_admin','company_admin')
        or p_perm = any(p.permissions)
        or coalesce((select rp.allowed from lb_role_permissions rp
                     where rp.company_id = p.company_id and rp.role = p.role and rp.permission = p_perm),
                    (select case p.role when 'agent' then c.agent_default else c.team_leader_default end
                     from lb_permission_catalog c where c.key = p_perm), false)
    from lb_profiles p where p.id = auth.uid() and p.is_active), false)
$$;

create or replace function lb_my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(key order by sort_order), '{}') from lb_permission_catalog where lb_can(key)
$$;

-- Carry over the old per-user permission keys.
update lb_profiles set permissions = array(
  select distinct case x when 'assign_leads' then 'leads.assign' when 'export_leads' then 'leads.export'
                         when 'import_leads' then 'leads.import' when 'view_reports' then 'reports.view' else x end
  from unnest(permissions) x)
where permissions <> '{}';

revoke execute on function lb_can(text), lb_my_permissions() from public, anon;
grant execute on function lb_can(text), lb_my_permissions() to authenticated, service_role;

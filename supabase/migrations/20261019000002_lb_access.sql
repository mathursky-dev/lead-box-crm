-- Access helpers + RLS. Helpers are SECURITY DEFINER so policies can read
-- lb_profiles without recursive RLS evaluation.

create or replace function lb_my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from lb_profiles where id = auth.uid() and is_active
$$;

create or replace function lb_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from lb_profiles where id = auth.uid() and is_active
$$;

create or replace function lb_is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from lb_profiles where id = auth.uid() and is_active), false)
$$;

-- Admin of a given company (super admin counts for every company).
create or replace function lb_is_admin_of(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' or (role = 'company_admin' and company_id = p_company)
    from lb_profiles where id = auth.uid() and is_active), false)
$$;

create or replace function lb_has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','company_admin') or p_perm = any(permissions)
    from lb_profiles where id = auth.uid() and is_active), false)
$$;

-- Teams a user can see: own team + explicit grants (team leaders).
create or replace function lb_team_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select team_id as t from lb_profiles where id = p_user and team_id is not null
    union select team_id from lb_user_team_access where user_id = p_user
  ) s
$$;

create or replace function lb_my_team_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select lb_team_ids_for(auth.uid())
$$;

-- Users whose work the caller may see (self for agents, team members for TLs).
create or replace function lb_visible_user_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select case
    when p.role in ('super_admin','company_admin') then
      (select coalesce(array_agg(id), '{}') from lb_profiles where company_id = p.company_id)
    when p.role = 'team_leader' then
      (select coalesce(array_agg(id), '{}') from lb_profiles
        where company_id = p.company_id and (id = p.id or team_id = any(lb_team_ids_for(p.id))))
    else array[p.id] end
  from lb_profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function lb_can_see_lead(p_company uuid, p_team uuid, p_owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select id, role, company_id into r from lb_profiles where id = auth.uid() and is_active;
  if r.id is null then return false; end if;
  if r.role = 'super_admin' then return true; end if;
  if r.company_id <> p_company then return false; end if;
  if r.role = 'company_admin' or p_owner = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_owner is not null and p_owner = any(lb_visible_user_ids()));
  end if;
  return false;
end $$;

create or replace function lb_can_use_number(p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record; v_company uuid;
begin
  select id, role, company_id into r from lb_profiles where id = auth.uid() and is_active;
  if r.id is null then return false; end if;
  select company_id into v_company from lb_wa_numbers where id = p_number;
  if r.role = 'super_admin' then return true; end if;
  if v_company is distinct from r.company_id then return false; end if;
  if r.role = 'company_admin' then return true; end if;
  return exists (select 1 from lb_wa_number_users where number_id = p_number and user_id = r.id)
      or exists (select 1 from lb_wa_number_teams where number_id = p_number and team_id = any(lb_team_ids_for(r.id)));
end $$;

create or replace function lb_can_see_conversation(p_company uuid, p_team uuid, p_assignee uuid, p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select id, role, company_id into r from lb_profiles where id = auth.uid() and is_active;
  if r.id is null then return false; end if;
  if r.role = 'super_admin' then return true; end if;
  if r.company_id <> p_company then return false; end if;
  if r.role = 'company_admin' or p_assignee = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_assignee is not null and p_assignee = any(lb_visible_user_ids()))
      or (p_assignee is null and lb_can_use_number(p_number));
  end if;
  return false;
end $$;

create or replace function lb_can_see_conversation_id(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lb_can_see_conversation(company_id, team_id, assignee_id, number_id)
    from lb_conversations where id = p_conv), false)
$$;

create or replace function lb_can_see_lead_id(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lb_can_see_lead(company_id, team_id, owner_id) from lb_leads where id = p_lead), false)
$$;

create or replace function lb_can_see_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lb_is_admin_of(c.company_id) from lb_customers c where c.id = p_customer), false)
    or exists (select 1 from lb_leads l where l.customer_id = p_customer and lb_can_see_lead(l.company_id, l.team_id, l.owner_id))
    or exists (select 1 from lb_conversations v where v.customer_id = p_customer
                 and lb_can_see_conversation(v.company_id, v.team_id, v.assignee_id, v.number_id))
$$;

-- ------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['lb_companies','lb_branches','lb_departments','lb_teams','lb_profiles',
    'lb_user_team_access','lb_products','lb_sources','lb_tags','lb_lead_statuses','lb_wa_numbers',
    'lb_wa_number_secrets','lb_wa_number_teams','lb_wa_number_users','lb_wa_templates','lb_customers',
    'lb_leads','lb_lead_tags','lb_lead_events','lb_followups','lb_notes','lb_conversations',
    'lb_conversation_tags','lb_conversation_transfers','lb_messages','lb_message_status_events',
    'lb_webhook_events','lb_quick_replies','lb_allocation_rules','lb_allocation_rule_users',
    'lb_notifications','lb_audit_log','lb_import_jobs','lb_rate_limits','lb_settings']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- Server-only tables: no policies, no grants.
revoke all on lb_wa_number_secrets, lb_webhook_events, lb_message_status_events, lb_rate_limits, lb_settings
  from anon, authenticated;
-- Nothing in LEAD BOX is readable anonymously.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'lb\_%'
  loop execute format('revoke all on %I from anon', t); end loop;
end $$;

-- Company
create policy lb_companies_read on lb_companies for select to authenticated
  using (lb_is_super() or id = lb_my_company());
create policy lb_companies_update on lb_companies for update to authenticated
  using (lb_is_admin_of(id)) with check (lb_is_admin_of(id));
create policy lb_companies_insert on lb_companies for insert to authenticated with check (lb_is_super());

-- Company-scoped reference tables: read by members, write by admins.
do $$ declare t text; begin
  foreach t in array array['lb_branches','lb_departments','lb_teams','lb_products','lb_sources',
    'lb_tags','lb_lead_statuses','lb_quick_replies','lb_allocation_rules','lb_wa_templates']
  loop
    execute format('create policy %I on %I for select to authenticated using (lb_is_super() or company_id = lb_my_company())', t||'_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (lb_is_admin_of(company_id))', t||'_ins', t);
    execute format('create policy %I on %I for update to authenticated using (lb_is_admin_of(company_id)) with check (lb_is_admin_of(company_id))', t||'_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (lb_is_admin_of(company_id))', t||'_del', t);
  end loop;
end $$;
-- Team leaders may manage quick replies for everyone in the company too.
create policy lb_quick_replies_tl on lb_quick_replies for insert to authenticated
  with check (company_id = lb_my_company() and lb_my_role() = 'team_leader');

create policy lb_wa_numbers_read on lb_wa_numbers for select to authenticated
  using (lb_is_admin_of(company_id) or lb_can_use_number(id));
create policy lb_wa_numbers_write on lb_wa_numbers for update to authenticated
  using (lb_is_admin_of(company_id)) with check (lb_is_admin_of(company_id));

create policy lb_wa_number_teams_read on lb_wa_number_teams for select to authenticated
  using (exists (select 1 from lb_wa_numbers n where n.id = number_id and (lb_is_super() or n.company_id = lb_my_company())));
create policy lb_wa_number_teams_write on lb_wa_number_teams for all to authenticated
  using (exists (select 1 from lb_wa_numbers n where n.id = number_id and lb_is_admin_of(n.company_id)))
  with check (exists (select 1 from lb_wa_numbers n where n.id = number_id and lb_is_admin_of(n.company_id)));
create policy lb_wa_number_users_read on lb_wa_number_users for select to authenticated
  using (exists (select 1 from lb_wa_numbers n where n.id = number_id and (lb_is_super() or n.company_id = lb_my_company())));
create policy lb_wa_number_users_write on lb_wa_number_users for all to authenticated
  using (exists (select 1 from lb_wa_numbers n where n.id = number_id and lb_is_admin_of(n.company_id)))
  with check (exists (select 1 from lb_wa_numbers n where n.id = number_id and lb_is_admin_of(n.company_id)));

create policy lb_allocation_rule_users_read on lb_allocation_rule_users for select to authenticated
  using (exists (select 1 from lb_allocation_rules r where r.id = rule_id and (lb_is_super() or r.company_id = lb_my_company())));
create policy lb_allocation_rule_users_write on lb_allocation_rule_users for all to authenticated
  using (exists (select 1 from lb_allocation_rules r where r.id = rule_id and lb_is_admin_of(r.company_id)))
  with check (exists (select 1 from lb_allocation_rules r where r.id = rule_id and lb_is_admin_of(r.company_id)));

-- Profiles: everyone in the company can see names (needed for assignment
-- pickers and history). Writes go through server actions (service role).
create policy lb_profiles_read on lb_profiles for select to authenticated
  using (lb_is_super() or company_id = lb_my_company());
create policy lb_user_team_access_read on lb_user_team_access for select to authenticated
  using (exists (select 1 from lb_profiles p where p.id = user_id and (lb_is_super() or p.company_id = lb_my_company())));

-- Customers / leads
create policy lb_customers_read on lb_customers for select to authenticated
  using (lb_can_see_customer(id));
create policy lb_customers_update on lb_customers for update to authenticated
  using (lb_can_see_customer(id)) with check (company_id = lb_my_company() or lb_is_super());

create policy lb_leads_read on lb_leads for select to authenticated
  using (lb_can_see_lead(company_id, team_id, owner_id));

create policy lb_lead_tags_read on lb_lead_tags for select to authenticated using (lb_can_see_lead_id(lead_id));
create policy lb_lead_tags_write on lb_lead_tags for all to authenticated
  using (lb_can_see_lead_id(lead_id)) with check (lb_can_see_lead_id(lead_id));

create policy lb_lead_events_read on lb_lead_events for select to authenticated using (lb_can_see_lead_id(lead_id));

create policy lb_followups_read on lb_followups for select to authenticated
  using (assigned_to = auth.uid() or lb_can_see_lead_id(lead_id));

create policy lb_notes_read on lb_notes for select to authenticated
  using ((lead_id is not null and lb_can_see_lead_id(lead_id))
      or (conversation_id is not null and lb_can_see_conversation_id(conversation_id))
      or lb_is_admin_of(company_id));

-- Conversations / messages
create policy lb_conversations_read on lb_conversations for select to authenticated
  using (lb_can_see_conversation(company_id, team_id, assignee_id, number_id));
create policy lb_conversation_tags_read on lb_conversation_tags for select to authenticated
  using (lb_can_see_conversation_id(conversation_id));
create policy lb_conversation_tags_write on lb_conversation_tags for all to authenticated
  using (lb_can_see_conversation_id(conversation_id)) with check (lb_can_see_conversation_id(conversation_id));
create policy lb_conversation_transfers_read on lb_conversation_transfers for select to authenticated
  using (lb_can_see_conversation_id(conversation_id));
create policy lb_messages_read on lb_messages for select to authenticated
  using (lb_can_see_conversation_id(conversation_id));

-- Notifications: own only; may mark read.
create policy lb_notifications_read on lb_notifications for select to authenticated using (user_id = auth.uid());
create policy lb_notifications_update on lb_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lb_audit_read on lb_audit_log for select to authenticated using (lb_is_admin_of(company_id));
create policy lb_import_jobs_read on lb_import_jobs for select to authenticated
  using (lb_is_admin_of(company_id) or created_by = auth.uid());

-- Tables written only via SECURITY DEFINER RPCs: drop direct DML grants.
revoke insert, update, delete on lb_leads, lb_lead_events, lb_followups, lb_notes, lb_conversations,
  lb_conversation_transfers, lb_messages, lb_profiles, lb_user_team_access, lb_customers, lb_audit_log,
  lb_import_jobs, lb_notifications, lb_wa_numbers from authenticated;
grant update (read_at) on lb_notifications to authenticated;
grant update (name, email, location) on lb_customers to authenticated;

-- ---------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('lb-media', 'lb-media', false, 104857600)
on conflict (id) do nothing;

-- Object path: {company_id}/{conversation_id}/{file}
create policy lb_media_read on storage.objects for select to authenticated
  using (bucket_id = 'lb-media'
    and lb_can_see_conversation_id(nullif((storage.foldername(name))[2], '')::uuid));

-- ---------------------------------------------------------- realtime
alter publication supabase_realtime add table lb_messages, lb_conversations, lb_notifications;

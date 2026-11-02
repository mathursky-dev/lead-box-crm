-- Keep every company's data separate, also for the platform Super Admin.
--
-- Until now the access helpers and most read policies had a blanket
-- "super_admin sees everything" shortcut (lb_is_super() OR ..., or
-- `if role = 'super_admin' then return true`). With the company switcher
-- (20261102000037) the Super Admin is meant to work inside ONE company at a
-- time, but those shortcuts still let every list (leads, customers, chats,
-- follow-ups, tags, statuses...) show rows of all companies mixed together.
--
-- Now the Super Admin is treated exactly like the company_admin of the
-- company they currently have open (lb__acting_company: the switched company,
-- or their home company "Lead Box"). Nothing changes for any other role.
--
-- Left as they were on purpose:
--   * lb_companies / lb_plans / lb_billing read policies: the top-bar company
--     switcher and billing need them (the /platform console itself uses the
--     service-role client and is not affected by RLS).
--   * lb_is_super(), lb_can(), lb_has_perm(): role checks, not company checks.

-- 1. Visibility helpers -------------------------------------------------------

create or replace function public.lb_can_see_lead(p_company uuid, p_team uuid, p_owner uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select p.id, p.role, lb__acting_company(p) as company_id into r
    from lb_profiles p where p.id = lb__entitled_uid() and p.is_active;
  if r.id is null then return false; end if;
  if r.company_id is distinct from p_company then return false; end if;
  if r.role in ('super_admin','company_admin') or p_owner = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_owner is not null and p_owner = any(lb_visible_user_ids()));
  end if;
  return false;
end $$;

create or replace function public.lb_can_see_conversation(p_company uuid, p_team uuid, p_assignee uuid, p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select p.id, p.role, lb__acting_company(p) as company_id into r
    from lb_profiles p where p.id = lb__entitled_uid() and p.is_active;
  if r.id is null then return false; end if;
  if r.company_id is distinct from p_company then return false; end if;
  if r.role in ('super_admin','company_admin') or p_assignee = r.id then return true; end if;
  if r.role = 'team_leader' then
    return (p_team is not null and p_team = any(lb_team_ids_for(r.id)))
      or (p_assignee is not null and p_assignee = any(lb_visible_user_ids()))
      or (p_assignee is null and lb_can_use_number(p_number));
  end if;
  return false;
end $$;

create or replace function public.lb_can_use_number(p_number uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r record; v_company uuid;
begin
  select p.id, p.role, lb__acting_company(p) as company_id into r
    from lb_profiles p where p.id = lb__entitled_uid() and p.is_active;
  if r.id is null then return false; end if;
  select company_id into v_company from lb_wa_numbers where id = p_number;
  if v_company is distinct from r.company_id then return false; end if;
  if r.role in ('super_admin','company_admin') then return true; end if;
  return exists (select 1 from lb_wa_number_users where number_id = p_number and user_id = r.id)
      or exists (select 1 from lb_wa_number_teams where number_id = p_number and team_id = any(lb_team_ids_for(r.id)));
end $$;

-- Super Admin is admin only of the company they have open.
create or replace function public.lb_is_admin_of(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','company_admin') and lb__acting_company(p) = p_company
    from lb_profiles p where p.id = lb__entitled_uid() and p.is_active), false)
$$;

-- 2. Read policies: drop the "OR lb_is_super()" shortcut ----------------------

alter policy lb_alloc_members_read on public.lb_alloc_members using (company_id = lb_my_company());
alter policy lb_alloc_sources_read on public.lb_alloc_sources using (company_id = lb_my_company());
alter policy lb_allocation_rule_users_read on public.lb_allocation_rule_users using (exists (
  select 1 from lb_allocation_rules r where r.id = lb_allocation_rule_users.rule_id and r.company_id = lb_my_company()));
alter policy lb_allocation_rules_read on public.lb_allocation_rules using (company_id = lb_my_company());
alter policy lb_attributions_read on public.lb_attributions using (company_id = lb_my_company());
alter policy lb_branches_read on public.lb_branches using (company_id = lb_my_company());
alter policy lb_campaign_recipients_read on public.lb_campaign_recipients using (lb_can('campaigns.manage') and company_id = lb_my_company());
alter policy lb_campaigns_read on public.lb_campaigns using (company_id = lb_my_company());
alter policy lb_departments_read on public.lb_departments using (company_id = lb_my_company());
alter policy lb_documents_read on public.lb_documents using (company_id = lb_my_company());
alter policy lb_jobs_read on public.lb_jobs using (company_id = lb_my_company() and (lb_can('journeys.manage') or created_by = auth.uid()));
alter policy lb_journey_steps_read on public.lb_journey_steps using (exists (
  select 1 from lb_journeys j where j.id = lb_journey_steps.journey_id and j.company_id = lb_my_company()));
alter policy lb_journey_versions_read on public.lb_journey_versions using (exists (
  select 1 from lb_journeys j where j.id = lb_journey_versions.journey_id and j.company_id = lb_my_company()));
alter policy lb_journeys_read on public.lb_journeys using (company_id = lb_my_company());
alter policy lb_knowledge_read on public.lb_knowledge using (company_id = lb_my_company());
alter policy lb_lead_statuses_read on public.lb_lead_statuses using (company_id = lb_my_company());
alter policy lb_lead_sub_statuses_read on public.lb_lead_sub_statuses using (company_id = lb_my_company());
alter policy lb_offers_read on public.lb_offers using (company_id = lb_my_company());
alter policy lb_products_read on public.lb_products using (company_id = lb_my_company());
alter policy lb_quick_replies_read on public.lb_quick_replies using (company_id = lb_my_company());
alter policy lb_role_permissions_read on public.lb_role_permissions using (company_id = lb_my_company());
alter policy lb_segment_members_read on public.lb_segment_members using (company_id = lb_my_company());
alter policy lb_segments_read on public.lb_segments using (company_id = lb_my_company());
alter policy lb_sources_read on public.lb_sources using (company_id = lb_my_company());
alter policy lb_suppressions_read on public.lb_suppressions using (company_id = lb_my_company());
alter policy lb_tags_read on public.lb_tags using (company_id = lb_my_company());
alter policy lb_teams_read on public.lb_teams using (company_id = lb_my_company());
alter policy lb_user_team_access_read on public.lb_user_team_access using (exists (
  select 1 from lb_profiles p where p.id = lb_user_team_access.user_id and p.company_id = lb_my_company()));
alter policy lb_wa_number_teams_read on public.lb_wa_number_teams using (exists (
  select 1 from lb_wa_numbers n where n.id = lb_wa_number_teams.number_id and n.company_id = lb_my_company()));
alter policy lb_wa_number_users_read on public.lb_wa_number_users using (exists (
  select 1 from lb_wa_numbers n where n.id = lb_wa_number_users.number_id and n.company_id = lb_my_company()));
alter policy lb_wa_templates_read on public.lb_wa_templates using (company_id = lb_my_company());
alter policy lb_customers_update on public.lb_customers using (lb_can_see_customer(id)) with check (company_id = lb_my_company());

-- Users of the open company, plus always your own row (the app reads the
-- signed-in profile through RLS, and the Super Admin's row stays in "Lead Box").
alter policy lb_profiles_read on public.lb_profiles using (id = auth.uid() or company_id = lb_my_company());

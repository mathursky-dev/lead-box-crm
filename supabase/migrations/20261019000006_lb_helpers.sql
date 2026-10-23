-- Open-lead workload per user (RLS applies: invoker).
create or replace function lb_open_lead_counts() returns table (owner_id uuid, open_leads bigint)
language sql stable security invoker set search_path = public as $$
  select owner_id, count(*) from lb_leads
  where owner_id is not null and not lb__closed(status_category) group by owner_id
$$;

-- Open (or reuse) a WhatsApp conversation for a lead's customer on a number.
create or replace function lb_start_conversation(p_lead uuid, p_number uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; v_conv uuid;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if not lb_can_use_number(p_number) or not exists (select 1 from lb_wa_numbers where id = p_number and company_id = l.company_id and is_active) then
    raise exception 'You do not have access to this business number' using errcode='42501';
  end if;
  insert into lb_conversations (company_id, number_id, customer_id, lead_id, team_id, assignee_id)
  values (l.company_id, p_number, l.customer_id, l.id, l.team_id, l.owner_id)
  on conflict (number_id, customer_id) do update set lead_id = coalesce(lb_conversations.lead_id, excluded.lead_id)
  returning id into v_conv;
  return v_conv;
end $$;

-- Duplicate check for imports: which normalized phones already have a lead in the caller's company.
create or replace function lb_check_phones(p_phones text[]) returns table (phone_e164 text, lead_id uuid, lead_no bigint, owner_name text)
language plpgsql stable security definer set search_path = public as $$
declare me lb_profiles := lb__me();
begin
  if not (me.role in ('super_admin','company_admin','team_leader') or 'import_leads' = any(me.permissions)) then
    raise exception 'Not permitted' using errcode='42501';
  end if;
  return query
  select distinct on (c.phone_e164) c.phone_e164, l.id, l.lead_no, o.full_name
  from lb_customers c join lb_leads l on l.customer_id = c.id left join lb_profiles o on o.id = l.owner_id
  where c.company_id = me.company_id and c.phone_e164 = any(p_phones)
  order by c.phone_e164, l.created_at desc;
end $$;

revoke execute on function lb_open_lead_counts(), lb_start_conversation(uuid,uuid), lb_check_phones(text[]) from public, anon;
grant execute on function lb_open_lead_counts(), lb_start_conversation(uuid,uuid), lb_check_phones(text[]) to authenticated, service_role;

-- Leads list inline edit: set a lead's "Next follow-up" straight from the list.
-- Moves the earliest pending follow-up to the new time (or creates one when the
-- lead has none), logs it on the timeline and refreshes lb_leads.next_followup_at.
-- Safe to re-run.

create or replace function public.lb_set_next_followup(p_lead uuid, p_due timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); l lb_leads; f lb_followups;
begin
  select * into l from lb_leads where id = p_lead;
  if l.id is null or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_due is null then raise exception 'Pick a date and time'; end if;
  if p_due < now() - interval '5 minutes' then raise exception 'Follow-up must be in the future'; end if;

  select * into f from lb_followups where lead_id = p_lead and status = 'pending'
  order by due_at, created_at limit 1 for update;
  if f.id is null then
    perform lb_add_followup(p_lead, p_due, null);
    return;
  end if;

  update lb_followups set due_at = p_due, reminded_at = null where id = f.id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (l.company_id, p_lead, me.id, l.owner_id, 'field_update', true,
          jsonb_build_object('next_followup', p_due, 'from_next_followup', f.due_at));
  update lb_leads set last_activity_at = now() where id = p_lead;
  perform lb__refresh_next_followup(p_lead);
end $$;
revoke all on function public.lb_set_next_followup(uuid, timestamptz) from public, anon;
grant execute on function public.lb_set_next_followup(uuid, timestamptz) to authenticated;

-- Rental desk, part 2 (cody 2026-11-11): ₹500 urgent plan (flat in 3 days, adjusted in brokerage),
-- single person accepted only at a minimum budget (sharing flat / PG), WhatsApp channel + Instagram links.
alter table public.lb_rental_desk
  add column if not exists urgent_fee integer not null default 500 check (urgent_fee between 1 and 100000),
  add column if not exists single_min_budget integer not null default 15000,
  add column if not exists channel_url text not null default '',
  add column if not exists instagram_url text not null default '';
alter table public.lb_rental_enquiries
  add column if not exists plan text check (plan in ('standard','urgent'));

-- Same as part 1, plus the plan's fee in the assignment reason and the result.
create or replace function public.lb_rental_confirm_payment(p_id uuid, p_zone integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; d lb_rental_desk; v_fee int; z jsonb; v_user uuid; v_lead uuid; v_status uuid; v_name text; v_zone int;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage not in ('awaiting_payment','payment_review','fee_offer','not_registered') then raise exception 'This enquiry is already %', replace(e.stage, '_', ' '); end if;
  select * into d from lb_rental_desk where company_id = e.company_id;
  v_fee := case when e.plan = 'urgent' then d.urgent_fee else d.fee end;
  v_zone := coalesce(p_zone, e.zone);
  if v_zone is null then raise exception 'Pick the zone first (the area did not match any zone)'; end if;
  select x into z from jsonb_array_elements(coalesce(d.zones, '[]')) x where (x->>'no')::int = v_zone;
  if z is null then raise exception 'Zone % is not set up', v_zone; end if;
  v_user := nullif(z->>'user_id', '')::uuid;
  if v_user is null then raise exception 'No user is set for Zone %. Set it on the Rental desk page.', v_zone; end if;
  select full_name into v_name from lb_profiles where id = v_user and company_id = e.company_id and is_active;
  if v_name is null then raise exception 'The Zone % user is not active', v_zone; end if;

  v_lead := lb__rental_lead(e);
  if v_lead is not null then
    perform lb__assign(v_lead, v_user, auth.uid(), 'Rental desk: ₹' || v_fee || case when e.plan = 'urgent' then ' (urgent, 3 days)' else '' end || ' paid · Zone ' || v_zone || ' ' || coalesce(z->>'name', ''));
    v_status := lb__rental_status(e.company_id, 'Registered - Requirement Taken');
    if v_status is not null then perform lb__set_status(v_lead, v_status, auth.uid(), 'Rental desk: payment confirmed', null, false); end if;
  end if;
  update lb_rental_enquiries set stage = 'registered', base_stage = 'registered', zone = v_zone, lead_id = coalesce(v_lead, lead_id),
    paid_at = now(), paid_by = auth.uid(), assigned_to = v_user, followups = 0,
    next_followup_at = now() + make_interval(hours => d.followup_hours), updated_at = now()
  where id = e.id;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'paid', 'Zone ' || v_zone || ' → ' || v_name || ' · ₹' || v_fee);
  return jsonb_build_object('fee', v_fee, 'plan', coalesce(e.plan, 'standard'), 'zone', v_zone, 'zone_name', z->>'name', 'user_id', v_user, 'user_name', v_name, 'lead_id', v_lead);
end $$;


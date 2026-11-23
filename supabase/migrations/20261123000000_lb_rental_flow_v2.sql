-- Rental desk, part 4 (LivoraRent WhatsApp blueprint, cody 2026-11-23):
--  * 5 roles: tenant, landlord, broker, buyer, seller ("Owner": sells a property). Old rows keep role 'owner'.
--  * Tenant steps after the form: sharing flat question, "kitne din me?" timeline, "within 5 days?",
--    the registration pitch, and 'declined' (budget too low / no sharing): new stages.
--  * Settings: independent-flat minimum budget, poster image + its minimum budget, support number + name.
--  * An admin may confirm a payment from any of the new tenant steps.
-- Nothing changes for companies without an enabled lb_rental_desk row.

alter table public.lb_rental_desk add column if not exists tenant_min_budget integer not null default 25000;
alter table public.lb_rental_desk add column if not exists poster_url text not null default '';
alter table public.lb_rental_desk add column if not exists poster_min_budget integer not null default 15000;
alter table public.lb_rental_desk add column if not exists support_phone text not null default '';
alter table public.lb_rental_desk add column if not exists support_name text not null default '';

alter table public.lb_rental_enquiries drop constraint if exists lb_rental_enquiries_stage_check;
alter table public.lb_rental_enquiries add constraint lb_rental_enquiries_stage_check check (stage in (
  'role','form','sharing','timeline','fast_ask','pitch','declined','fee_offer','awaiting_payment','payment_review','registered','not_registered',
  'fu_ask','fu_broker','fu_rent','fu_happy','details','done','closed'));
alter table public.lb_rental_enquiries drop constraint if exists lb_rental_enquiries_role_check;
alter table public.lb_rental_enquiries add constraint lb_rental_enquiries_role_check check (role in ('tenant','landlord','broker','buyer','seller','owner'));

-- Payment checked: the zone agents normally have the lead already (given when the form was filled);
-- a zone picked here (or a first zone for an area that matched none) gives it to that zone's agents.
create or replace function public.lb_rental_confirm_payment(p_id uuid, p_zone integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e lb_rental_enquiries; d lb_rental_desk; v_fee int; z jsonb; v_lead uuid; v_status uuid; v_zone int; r jsonb; v_names text;
begin
  select * into e from lb_rental_enquiries where id = p_id for update;
  if e.id is null or e.company_id <> lb_my_company() or not lb_is_admin_of(e.company_id) then raise exception 'Enquiry not found'; end if;
  if e.stage not in ('awaiting_payment','payment_review','fee_offer','not_registered','pitch','timeline','fast_ask','sharing','declined') then raise exception 'This enquiry is already %', replace(e.stage, '_', ' '); end if;
  select * into d from lb_rental_desk where company_id = e.company_id;
  v_fee := case when e.plan = 'urgent' then d.urgent_fee else d.fee end;
  v_zone := coalesce(p_zone, e.zone);
  if v_zone is null then raise exception 'Pick the zone first (the area did not match any zone)'; end if;
  select x into z from jsonb_array_elements(coalesce(d.zones, '[]')) x where (x->>'no')::int = v_zone;
  if z is null then raise exception 'Zone % is not set up', v_zone; end if;
  if cardinality(lb__rental_zone_agents(e.company_id, z)) = 0 then
    raise exception 'Zone % has no active agent. Add a user to its department (or set the zone user on the Rental desk page).', v_zone;
  end if;
  if not v_zone = any(e.zones) then
    update lb_rental_enquiries set zones = case when cardinality(assigned_users) = 0 then array[v_zone] else zones || v_zone end, zone = coalesce(zone, v_zone) where id = e.id;
  end if;
  r := lb__rental_zone_assign(e.id, auth.uid(), null);
  select * into e from lb_rental_enquiries where id = p_id;

  v_lead := lb__rental_lead(e);
  if v_lead is not null then
    v_status := lb__rental_status(e.company_id, 'Registered - Requirement Taken');
    if v_status is not null then perform lb__set_status(v_lead, v_status, auth.uid(), 'Rental desk: ₹' || v_fee || ' payment confirmed', null, false); end if;
    insert into lb_notes (company_id, customer_id, lead_id, conversation_id, author_id, body)
    select e.company_id, e.customer_id, x, e.conversation_id, auth.uid(), '💰 Rental desk: ₹' || v_fee ||
      case when e.plan = 'urgent' then ' urgent (3 days)' else '' end || ' registration paid'
    from unnest(array[v_lead] || e.lead_copies) x;
  end if;
  select string_agg(full_name, ', ' order by full_name) into v_names from lb_profiles where id = any(e.assigned_users);
  update lb_rental_enquiries set stage = 'registered', base_stage = 'registered', lead_id = coalesce(v_lead, lead_id),
    paid_at = now(), paid_by = auth.uid(), followups = 0,
    next_followup_at = now() + make_interval(hours => d.followup_hours), updated_at = now()
  where id = e.id;
  insert into lb_rental_log (company_id, enquiry_id, kind, detail) values (e.company_id, e.id, 'paid', '₹' || v_fee || ' · ' || coalesce(v_names, '-'));
  return jsonb_build_object('fee', v_fee, 'plan', coalesce(e.plan, 'standard'), 'zone', v_zone, 'zone_name', z->>'name',
    'zones', to_jsonb(e.zones), 'user_id', e.assigned_to, 'user_name', coalesce(v_names, '-'), 'lead_id', v_lead);
end $$;

revoke all on function public.lb_rental_confirm_payment(uuid, integer) from public, anon;
grant execute on function public.lb_rental_confirm_payment(uuid, integer) to authenticated;

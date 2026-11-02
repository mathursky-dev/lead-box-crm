-- Online accept & e-sign of quotations.
--
-- The customer opens /q/<token>/sign, reads the quotation, types their name, draws
-- a signature and agrees. We keep an audit record (name, signature image, time,
-- IP, browser, and a SHA-256 fingerprint of the quotation's content at signing),
-- mark the quotation Accepted, log it on the lead, notify the owner and, if set,
-- move the lead to a chosen status. The signed PDF carries a signature page.
--
-- This is a simple electronic signature (consent + audit trail), fine for
-- quotations / order confirmations. It is NOT an Aadhaar eSign / DSC signature.
-- Safe to run more than once.

alter table public.lb_quotes add column if not exists signed_at timestamptz;
alter table public.lb_quotes add column if not exists signed_name text;

alter table public.lb_quote_settings add column if not exists esign_enabled boolean not null default true;
alter table public.lb_quote_settings add column if not exists esign_status_id uuid references public.lb_lead_statuses(id) on delete set null;

create table if not exists public.lb_quote_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  quote_id uuid not null unique references public.lb_quotes(id) on delete cascade,
  lead_id uuid not null references public.lb_leads(id) on delete cascade,
  signer_name text not null check (length(signer_name) between 2 and 120),
  signature_png text not null check (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 400000),
  doc_hash text not null check (doc_hash ~ '^[0-9a-f]{64}$'),
  doc_total numeric(14,2) not null,
  ip text,
  user_agent text,
  signed_at timestamptz not null default now()
);
create index if not exists lb_quote_signatures_company on public.lb_quote_signatures (company_id, signed_at desc);

alter table public.lb_quote_signatures enable row level security;
revoke all on public.lb_quote_signatures from anon;
revoke insert, update, delete on public.lb_quote_signatures from authenticated;
grant select on public.lb_quote_signatures to authenticated;
drop policy if exists lb_quote_signatures_read on public.lb_quote_signatures;
create policy lb_quote_signatures_read on public.lb_quote_signatures for select to authenticated
  using (company_id = public.lb_my_company() and public.lb_can_see_lead_id(lead_id));
drop policy if exists lb_paid on public.lb_quote_signatures;
create policy lb_paid on public.lb_quote_signatures as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Called by the public sign page (service role) after the app has checked the
-- token and computed the fingerprint. Returns the quotation number.
create or replace function public.lb_quote_sign(p_token text, p_name text, p_png text, p_hash text, p_ip text, p_ua text)
returns text language plpgsql security definer set search_path = public as $$
declare q lb_quotes; s lb_quote_settings; l lb_leads; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into q from lb_quotes where public_token = p_token for update;
  if q.id is null or q.kind <> 'quotation' then raise exception 'Quotation not found'; end if;
  select * into s from lb_quote_settings where company_id = q.company_id;
  if s.company_id is not null and not s.esign_enabled then raise exception 'Online signing is turned off for this quotation'; end if;
  if q.signed_at is not null then raise exception 'This quotation is already signed'; end if;
  if q.status in ('cancelled','rejected','paid') then raise exception 'This quotation is % and can''t be signed', q.status; end if;
  if q.valid_until is not null and q.valid_until < v_today then raise exception 'This quotation expired on %', to_char(q.valid_until, 'DD Mon YYYY'); end if;

  insert into lb_quote_signatures (company_id, quote_id, lead_id, signer_name, signature_png, doc_hash, doc_total, ip, user_agent)
  values (q.company_id, q.id, q.lead_id, trim(p_name), p_png, p_hash, q.total, left(p_ip, 100), left(p_ua, 400));
  update lb_quotes set status = 'accepted', signed_at = now(), signed_name = trim(p_name), updated_at = now() where id = q.id;

  select * into l from lb_leads where id = q.lead_id;
  insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
  values (q.company_id, q.lead_id, null, l.owner_id, 'field_update', false,
          jsonb_build_object('doc_event', 'signed', 'doc_kind', q.kind, 'doc_no', q.doc_no, 'amount', q.total, 'signer', trim(p_name)));
  update lb_leads set last_activity_at = now() where id = q.lead_id;
  perform lb__notify(q.company_id, l.owner_id, 'quote_signed', 'Quotation signed: ' || q.doc_no,
    trim(p_name) || ' accepted ₹' || q.total::text || ' · LB-' || l.lead_no, '/quotes/' || q.id, 'sign:' || q.id::text);

  if s.esign_status_id is not null and l.status_category not in ('won','lost','invalid') and l.status_id is distinct from s.esign_status_id
     and exists (select 1 from lb_lead_statuses where id = s.esign_status_id and company_id = q.company_id and is_active) then
    perform lb__set_status(q.lead_id, s.esign_status_id, null, 'Quotation ' || q.doc_no || ' signed online', null, false);
  end if;
  return q.doc_no;
end $$;

revoke all on function public.lb_quote_sign(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.lb_quote_sign(text, text, text, text, text, text) to service_role;

-- Cloud calling / IVR (Exotel or Knowlarity): click-to-call from the CRM and incoming IVR calls,
-- with the provider's call recording, saved on the lead in the same Calls list as app calls.
--
-- * lb_ivr_settings: one row per company (provider keys encrypted by the server; service role only).
-- * lb_profiles.ivr_phone: the agent's own mobile that the provider rings first (click-to-call).
-- * lb_calls gets source 'ivr', provider ids and status; user_id may be empty for an incoming
--   IVR call nobody answered.
-- * The provider callback (/api/ivr/<provider>/<hook_token>) writes through lb_ivr_save_call.
-- Idempotent: safe to run more than once.

create table if not exists public.lb_ivr_settings (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  provider text not null default 'exotel' check (provider in ('exotel','knowlarity')),
  enabled boolean not null default false,
  account_sid text,          -- Exotel account SID
  api_host text,             -- Exotel API host, e.g. api.exotel.com / api.in.exotel.com
  api_key text,              -- Exotel API key / Knowlarity x-api-key
  api_token_enc text,        -- Exotel API token / Knowlarity Authorization (encrypted)
  caller_id text,            -- ExoPhone / Knowlarity SR (k_number)
  record boolean not null default true,
  hook_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists lb_ivr_settings_hook on public.lb_ivr_settings (hook_token);
alter table public.lb_ivr_settings enable row level security;
revoke all on public.lb_ivr_settings from anon, authenticated;

alter table public.lb_profiles add column if not exists ivr_phone text;

alter table public.lb_calls alter column user_id drop not null;
alter table public.lb_calls add column if not exists provider text;
alter table public.lb_calls add column if not exists provider_call_id text;
alter table public.lb_calls add column if not exists ivr_status text;
alter table public.lb_calls add column if not exists recording_url text;
create unique index if not exists lb_calls_provider_id on public.lb_calls (provider, provider_call_id) where provider_call_id is not null;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.lb_calls'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%source%' loop
    execute format('alter table public.lb_calls drop constraint %I', c);
  end loop;
  alter table public.lb_calls add constraint lb_calls_source_check check (source in ('app','app_lite','manual','ivr'));
end $$;

-- Create or update one IVR call. Service role only.
-- p: {company_id, provider, call_id, user_id?, agent_phone?, phone, direction, status, started_at, duration, recording_url}
-- Agent = user_id, else the user whose ivr_phone matches agent_phone, else the lead owner.
create or replace function public.lb_ivr_save_call(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_company uuid := (p->>'company_id')::uuid; v_phone text := p->>'phone'; v_dir text := coalesce(p->>'direction', 'outgoing');
  v_cust uuid; l lb_leads; v_user uuid; v_id uuid; v_old lb_calls; v_sec integer; v_at timestamptz;
begin
  if v_company is null or coalesce(p->>'call_id', '') = '' then raise exception 'Invalid call'; end if;
  if v_dir not in ('outgoing','incoming','missed','rejected') then v_dir := 'outgoing'; end if;
  begin v_sec := greatest(0, least(86400, coalesce((p->>'duration')::numeric, 0)::integer)); exception when others then v_sec := 0; end;
  begin v_at := coalesce((p->>'started_at')::timestamptz, now()); exception when others then v_at := now(); end;

  select * into v_old from lb_calls where provider = p->>'provider' and provider_call_id = p->>'call_id' and company_id = v_company for update;
  if v_old.id is not null then
    update lb_calls set
      duration_sec = greatest(duration_sec, v_sec),
      ivr_status = coalesce(nullif(p->>'status', ''), ivr_status),
      direction = case when v_dir = 'missed' and greatest(duration_sec, v_sec) = 0 then 'missed' else direction end,
      recording_url = coalesce(nullif(p->>'recording_url', ''), recording_url),
      updated_at = now()
    where id = v_old.id;
    if v_old.lead_id is not null and v_sec > v_old.duration_sec then
      update lb_lead_events set data = data || jsonb_build_object('body', lb__call_label(v_old.direction, v_sec), 'duration', v_sec)
      where lead_id = v_old.lead_id and type = 'call' and data->>'call_id' = v_old.id::text;
    end if;
    return jsonb_build_object('id', v_old.id, 'lead_id', v_old.lead_id, 'status', 'updated');
  end if;

  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then return jsonb_build_object('status', 'invalid'); end if;
  select id into v_cust from lb_customers where company_id = v_company and phone_e164 = v_phone limit 1;
  if v_cust is not null then
    select * into l from lb_leads x where x.customer_id = v_cust and x.deleted_at is null
      order by (x.status_category = 'open') desc, x.created_at desc limit 1;
  end if;
  v_user := nullif(p->>'user_id', '')::uuid;
  if v_user is not null and not exists (select 1 from lb_profiles where id = v_user and company_id = v_company) then v_user := null; end if;
  if v_user is null and coalesce(p->>'agent_phone', '') <> '' then
    select id into v_user from lb_profiles where company_id = v_company and is_active and ivr_phone = p->>'agent_phone' limit 1;
  end if;
  v_user := coalesce(v_user, l.owner_id);

  insert into lb_calls (company_id, user_id, lead_id, customer_id, phone_e164, direction, started_at, duration_sec, source,
    provider, provider_call_id, ivr_status, recording_url)
  values (v_company, v_user, l.id, v_cust, v_phone, v_dir, v_at, v_sec, 'ivr', p->>'provider', p->>'call_id', nullif(p->>'status', ''), nullif(p->>'recording_url', ''))
  returning id into v_id;
  if l.id is not null then
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
    values (v_company, l.id, v_user, l.owner_id, 'call', v_dir = 'outgoing' or v_sec > 0,
      jsonb_build_object('body', lb__call_label(v_dir, v_sec), 'call_id', v_id, 'direction', v_dir, 'duration', v_sec, 'auto', true, 'via', 'ivr'), v_at);
    update lb_leads set last_activity_at = greatest(coalesce(last_activity_at, v_at), v_at) where id = l.id;
    if v_dir = 'missed' and l.owner_id is not null then
      begin
        perform lb__notify(v_company, l.owner_id, 'call', 'Missed IVR call', v_phone, '/leads/' || l.id, 'ivrmiss:' || v_id);
      exception when others then null; end;
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'lead_id', l.id, 'status', 'saved');
end $$;
revoke all on function public.lb_ivr_save_call(jsonb) from public, anon, authenticated;
grant execute on function public.lb_ivr_save_call(jsonb) to service_role;

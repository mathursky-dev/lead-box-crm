-- Call tracking: phone calls made or received on the Lead Box Android app are
-- saved against the lead (direction, time, duration and, when the phone's own
-- call recorder saved one, the recording).
--
-- * Only numbers that belong to a customer of the caller's company are saved;
--   personal calls are dropped by lb_save_calls and never stored.
-- * Rows are written by lb_save_calls (security definer) and by server actions;
--   users only get SELECT through RLS.
-- * Who sees a call: admins see every call of the company; others see their own
--   calls, their team's (team leaders), and calls on leads they can see.
-- * Recordings live in the private "lb-calls" bucket at {company_id}/{call_id}.{ext};
--   the server hands out signed URLs.
-- Everything is scoped to lb_my_company(), so a Super Admin sees only the
-- company switched in the top bar. Idempotent: safe to run more than once.

-- Company switch: admins can stop recordings being uploaded.
alter table public.lb_companies add column if not exists call_recordings boolean not null default true;

create table if not exists public.lb_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  user_id uuid not null references public.lb_profiles(id) on delete restrict,
  lead_id uuid references public.lb_leads(id) on delete set null,
  customer_id uuid references public.lb_customers(id) on delete set null,
  phone_e164 text not null,
  direction text not null check (direction in ('outgoing','incoming','missed','rejected')),
  started_at timestamptz not null,
  duration_sec integer not null default 0 check (duration_sec between 0 and 86400),
  -- app = full call-log build, app_lite = Play Store build (phone state only), manual = typed in the CRM
  source text not null default 'app' check (source in ('app','app_lite','manual')),
  -- the phone's own id for the call, so a re-sync never saves it twice
  device_key text,
  outcome text check (outcome is null or outcome in ('connected','interested','not_interested','call_back','busy','no_answer','switched_off','wrong_number')),
  note text not null default '' check (length(note) <= 2000),
  recording_path text unique,
  recording_mime text,
  recording_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lb_calls_device_key on public.lb_calls (user_id, device_key) where device_key is not null;
create index if not exists lb_calls_company_time on public.lb_calls (company_id, started_at desc);
create index if not exists lb_calls_user_time on public.lb_calls (company_id, user_id, started_at desc);
create index if not exists lb_calls_lead on public.lb_calls (lead_id, started_at desc) where lead_id is not null;

alter table public.lb_calls enable row level security;
revoke all on public.lb_calls from anon;
revoke insert, update, delete on public.lb_calls from authenticated;
grant select on public.lb_calls to authenticated;
drop policy if exists lb_calls_read on public.lb_calls;
drop policy if exists lb_paid on public.lb_calls;
create policy lb_calls_read on public.lb_calls for select to authenticated using (
  company_id = public.lb_my_company() and (
    public.lb_is_admin_of(company_id)
    or user_id = auth.uid()
    or user_id = any(public.lb_visible_user_ids())
    or (lead_id is not null and public.lb_can_see_lead_id(lead_id))
  ));
create policy lb_paid on public.lb_calls as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Short text for the lead history, e.g. "Outgoing call · 3m 12s".
create or replace function public.lb__call_label(p_dir text, p_sec integer) returns text
language sql immutable set search_path = public as $$
  select initcap(p_dir) || ' call' || case when p_sec > 0 then ' · ' ||
    case when p_sec >= 3600 then (p_sec / 3600) || 'h ' else '' end ||
    case when p_sec >= 60 then ((p_sec % 3600) / 60) || 'm ' else '' end || (p_sec % 60) || 's'
    when p_dir = 'outgoing' then ' · not answered' else '' end
$$;

-- Saves a batch of the caller's own calls from the app.
-- p_calls: [{key, phone (E.164), direction, started_at, duration, source}] (max 200).
-- Returns [{key, status: saved|exists|no_match|invalid, id, lead_id}].
create or replace function public.lb_save_calls(p_calls jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid(); v_company uuid := lb_my_company();
  c jsonb; v_out jsonb := '[]'; v_key text; v_phone text; v_dir text; v_at timestamptz; v_sec integer; v_src text;
  v_cust uuid; l lb_leads; v_id uuid;
begin
  if v_me is null or v_company is null or not exists (select 1 from lb_profiles where id = v_me and is_active) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not lb_access_ok() then raise exception 'Subscription inactive' using errcode = '42501'; end if;
  if jsonb_typeof(p_calls) <> 'array' or jsonb_array_length(p_calls) > 200 then raise exception 'Send at most 200 calls at a time'; end if;

  for c in select * from jsonb_array_elements(p_calls) loop
    v_key := left(nullif(trim(c->>'key'), ''), 120);
    v_phone := c->>'phone'; v_dir := c->>'direction';
    v_src := coalesce(nullif(c->>'source', ''), 'app');
    begin
      v_at := (c->>'started_at')::timestamptz;
      v_sec := greatest(0, least(86400, coalesce((c->>'duration')::numeric, 0)::integer));
    exception when others then v_at := null; end;
    if v_key is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' or v_dir not in ('outgoing','incoming','missed','rejected')
       or v_src not in ('app','app_lite') or v_at is null or v_at > now() + interval '10 minutes' or v_at < now() - interval '45 days' then
      v_out := v_out || jsonb_build_object('key', v_key, 'status', 'invalid'); continue;
    end if;
    select id into v_id from lb_calls where user_id = v_me and device_key = v_key;
    if v_id is not null then
      v_out := v_out || jsonb_build_object('key', v_key, 'status', 'exists', 'id', v_id); continue;
    end if;

    select id into v_cust from lb_customers where company_id = v_company and phone_e164 = v_phone limit 1;
    if v_cust is null then
      -- Not a CRM contact (personal call): nothing is stored.
      v_out := v_out || jsonb_build_object('key', v_key, 'status', 'no_match'); continue;
    end if;
    -- The lead to file it under: the caller's own open lead first, then any lead they can
    -- see, then the customer's latest lead.
    select * into l from lb_leads x where x.customer_id = v_cust and x.deleted_at is null
      order by (x.owner_id = v_me) desc, (x.status_category = 'open') desc,
               lb_can_see_lead(x.company_id, x.team_id, x.owner_id) desc, x.created_at desc limit 1;

    insert into lb_calls (company_id, user_id, lead_id, customer_id, phone_e164, direction, started_at, duration_sec, source, device_key)
    values (v_company, v_me, l.id, v_cust, v_phone, v_dir, v_at, v_sec, v_src, v_key) returning id into v_id;
    if l.id is not null then
      insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data, created_at)
      values (v_company, l.id, v_me, l.owner_id, 'call', v_dir = 'outgoing' or v_sec > 0,
        jsonb_build_object('body', lb__call_label(v_dir, v_sec), 'call_id', v_id, 'direction', v_dir, 'duration', v_sec, 'auto', true), v_at);
      update lb_leads set last_activity_at = greatest(coalesce(last_activity_at, v_at), v_at) where id = l.id;
    end if;
    v_out := v_out || jsonb_build_object('key', v_key, 'status', 'saved', 'id', v_id, 'lead_id', l.id);
  end loop;
  return v_out;
end $$;
revoke all on function public.lb_save_calls(jsonb) from public, anon;
grant execute on function public.lb_save_calls(jsonb) to authenticated;

-- Private bucket for recordings; no client policies (server uses signed URLs).
insert into storage.buckets (id, name, public, file_size_limit)
values ('lb-calls', 'lb-calls', false, 52428800)
on conflict (id) do nothing;

-- Video meeting link on appointments: Zoom, Google Meet, or one fixed link (any tool).
--
-- * lb_care_settings.meeting_mode: none | zoom | google | fixed (+ meeting_fixed_url).
-- * lb_meeting_accounts: Zoom Server-to-Server OAuth app keys and the connected Google account
--   (refresh token, encrypted by the server). Service role only.
-- * lb_appointments gets meeting_url / provider / ext id / error. The server creates the meeting
--   right after a booking (staff or online) and the jobs runner retries any that are missing.
-- Idempotent: safe to run more than once.

alter table public.lb_care_settings add column if not exists meeting_mode text not null default 'none';
alter table public.lb_care_settings add column if not exists meeting_fixed_url text;
do $$ begin
  alter table public.lb_care_settings add constraint lb_care_settings_meeting_mode check (meeting_mode in ('none','zoom','google','fixed'));
exception when duplicate_object then null; end $$;

create table if not exists public.lb_meeting_accounts (
  company_id uuid primary key references public.lb_companies(id) on delete cascade,
  zoom_account_id text,
  zoom_client_id text,
  zoom_client_secret_enc text,
  google_email text,
  google_refresh_enc text,
  google_calendar_id text not null default 'primary',
  updated_by uuid references public.lb_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.lb_meeting_accounts enable row level security;
revoke all on public.lb_meeting_accounts from anon, authenticated;

alter table public.lb_appointments add column if not exists meeting_url text;
alter table public.lb_appointments add column if not exists meeting_provider text;
alter table public.lb_appointments add column if not exists meeting_ext_id text;
alter table public.lb_appointments add column if not exists meeting_error text;
create index if not exists lb_appointments_need_meeting on public.lb_appointments (starts_at)
  where meeting_url is null and meeting_error is null and status in ('booked','confirmed');

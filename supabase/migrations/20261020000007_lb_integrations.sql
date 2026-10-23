-- Integration master: per-company Meta (WhatsApp Cloud API) app settings.
-- Server-only (RLS on, no policies, no grants); the admin page reads it via
-- the service role after an admin check. app_secret is AES-GCM encrypted.
create table lb_integrations (
  company_id uuid primary key references lb_companies(id) on delete restrict,
  meta_app_id text,
  verify_token text,
  app_secret_enc text,
  updated_by uuid references lb_profiles(id),
  updated_at timestamptz not null default now()
);
alter table lb_integrations enable row level security;
revoke all on lb_integrations from anon, authenticated;
create unique index lb_integrations_verify_token on lb_integrations (verify_token) where verify_token is not null;

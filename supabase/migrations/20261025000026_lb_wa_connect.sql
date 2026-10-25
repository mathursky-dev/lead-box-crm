-- WhatsApp connect options on Admin → Integrations:
--  * Embedded Signup ("Connect with Facebook") needs the Meta Login-for-Business configuration id.
--  * QR-scan numbers run through the self-hosted wa-gateway instead of the Cloud API.
alter table lb_integrations add column if not exists wa_es_config_id text;

alter table lb_wa_numbers add column if not exists provider text not null default 'cloud';
do $$ begin
  alter table lb_wa_numbers add constraint lb_wa_numbers_provider_check check (provider in ('cloud', 'qr'));
exception when duplicate_object then null; end $$;

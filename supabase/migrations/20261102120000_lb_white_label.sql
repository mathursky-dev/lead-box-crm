-- White-label for resellers.
--
-- A "brand" is a reseller's look: name, logo, colours, support contact and
-- (optionally) its own domain such as crm.resellername.com. The platform Super
-- Admin creates brands in /platform/brands and links client companies to them.
-- The reseller itself is a normal company (owner_company_id); its Company
-- Admin can change the brand's look and see / add its client companies from
-- Manage -> White-label.
--
-- Safe by default: no brand rows exist, lb_companies.brand_id is null for
-- every company, so the app keeps showing the Lead Box look exactly as now.
-- Additive only: one new table, one new nullable column, new RPCs and one
-- public storage bucket for logos.

-- ------------------------------------------------------------ 1. brands
create table if not exists public.lb_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  -- Custom domain (lowercase host, no scheme / path). Must also be added to the Vercel project.
  domain text unique check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  icon_url text check (icon_url is null or icon_url ~ '^https://'),
  primary_color text not null default '#15803d' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  sidebar_color text not null default '#0b1f3a' check (sidebar_color ~ '^#[0-9a-fA-F]{6}$'),
  tagline text check (char_length(tagline) <= 120),
  support_email text check (char_length(support_email) <= 200),
  support_phone text check (char_length(support_phone) <= 30),
  website text check (website is null or website ~ '^https?://'),
  hide_powered_by boolean not null default false,
  -- The reseller's own company (its admins manage this brand). Null = managed only by the platform.
  owner_company_id uuid references public.lb_companies(id) on delete set null,
  -- Plan new client companies of this reseller start on (null = first public plan).
  default_plan_id uuid references public.lb_plans(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_brands_owner on public.lb_brands (owner_company_id);

alter table public.lb_companies add column if not exists brand_id uuid references public.lb_brands(id) on delete set null;
create index if not exists lb_companies_brand on public.lb_companies (brand_id) where brand_id is not null;

alter table public.lb_brands enable row level security;
revoke all on public.lb_brands from anon, authenticated;
grant select on public.lb_brands to authenticated;
drop policy if exists lb_brands_read on public.lb_brands;
-- Your company's brand, or the brand your company owns (reseller). Writes only via RPC / service role.
create policy lb_brands_read on public.lb_brands for select to authenticated using (
  id = (select c.brand_id from lb_companies c where c.id = lb_my_company())
  or owner_company_id = lb_my_company());

-- ------------------------------------------------------------ 2. lookups
-- Public, non-secret look of the brand that owns a host name (login page on a custom domain).
create or replace function public.lb_brand_for_host(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select b.id, b.name, b.logo_url, b.icon_url, b.primary_color, b.sidebar_color, b.tagline,
           b.support_email, b.support_phone, b.website, b.hide_powered_by
    from lb_brands b
    where b.is_active and b.domain is not null
      and b.domain = regexp_replace(lower(split_part(coalesce(p_host, ''), ':', 1)), '^www\.', '')
    limit 1) x
$$;

-- Look for the signed-in user: the brand of the open company, else the brand that company owns.
create or replace function public.lb_my_brand() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select b.id, b.name, b.logo_url, b.icon_url, b.primary_color, b.sidebar_color, b.tagline,
           b.support_email, b.support_phone, b.website, b.hide_powered_by, b.domain,
           (b.owner_company_id = lb_my_company()) as is_owner
    from lb_brands b
    where b.is_active and (b.id = (select c.brand_id from lb_companies c where c.id = lb_my_company())
                           or b.owner_company_id = lb_my_company())
    order by (b.id = (select c.brand_id from lb_companies c where c.id = lb_my_company())) desc nulls last, b.created_at
    limit 1) x
$$;

-- ------------------------------------------------------------ 3. reseller self-service
-- The brand the caller's company owns, if the caller is its Company Admin.
create or replace function public.lb_my_reseller_brand() returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from lb_brands b
  where b.owner_company_id = lb_my_company() and lb_is_admin_of(b.owner_company_id)
  order by b.created_at limit 1
$$;

-- Reseller edits its brand's look. Domain, owner, plan and "hide powered by" stay with the platform.
create or replace function public.lb_save_my_brand(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_brand uuid := lb_my_reseller_brand();
begin
  if v_brand is null then raise exception 'Only the admin of a white-label partner can change branding' using errcode = '42501'; end if;
  update lb_brands set
    name = coalesce(nullif(trim(p->>'name'), ''), name),
    logo_url = case when p ? 'logo_url' then nullif(trim(p->>'logo_url'), '') else logo_url end,
    icon_url = case when p ? 'icon_url' then nullif(trim(p->>'icon_url'), '') else icon_url end,
    primary_color = coalesce(nullif(p->>'primary_color', ''), primary_color),
    sidebar_color = coalesce(nullif(p->>'sidebar_color', ''), sidebar_color),
    tagline = case when p ? 'tagline' then nullif(trim(p->>'tagline'), '') else tagline end,
    support_email = case when p ? 'support_email' then nullif(trim(p->>'support_email'), '') else support_email end,
    support_phone = case when p ? 'support_phone' then nullif(trim(p->>'support_phone'), '') else support_phone end,
    website = case when p ? 'website' then nullif(trim(p->>'website'), '') else website end,
    updated_at = now()
  where id = v_brand;
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (lb_my_company(), auth.uid(), 'brand.update', 'brand', v_brand, p - 'logo_url' - 'icon_url');
end $$;

-- Client companies of the caller's brand, with plan status and usage (read-only).
create or replace function public.lb_reseller_clients() returns table (
  id uuid, name text, created_at timestamptz, is_active boolean, plan text, plan_name text,
  trial_ends_at timestamptz, paid_until timestamptz, suspended_at timestamptz,
  users bigint, leads_month bigint, admin_name text, admin_email text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.created_at, c.is_active, b.plan, pl.name, b.trial_ends_at, b.paid_until, b.suspended_at,
    (select count(*) from lb_profiles u where u.company_id = c.id and u.is_active),
    (select count(*) from lb_leads l where l.company_id = c.id and l.created_at >= date_trunc('month', now())),
    a.full_name, a.email
  from lb_companies c
  left join lb_billing b on b.company_id = c.id
  left join lb_plans pl on pl.id = b.plan_id
  left join lateral (select full_name, email from lb_profiles u where u.company_id = c.id and u.role = 'company_admin' and u.is_active
                     order by u.created_at limit 1) a on true
  where lb_my_reseller_brand() is not null and c.brand_id = lb_my_reseller_brand()
  order by c.created_at desc
$$;

revoke execute on function public.lb_brand_for_host(text), public.lb_my_brand(), public.lb_my_reseller_brand(),
  public.lb_save_my_brand(jsonb), public.lb_reseller_clients() from public;
grant execute on function public.lb_brand_for_host(text) to anon, authenticated;
grant execute on function public.lb_my_brand(), public.lb_my_reseller_brand(), public.lb_save_my_brand(jsonb),
  public.lb_reseller_clients() to authenticated;

-- ------------------------------------------------------------ 4. logo storage
-- Public bucket "lb-brand" ({brand_id}/{uuid}.ext). Uploads go through the server (service role) only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lb-brand', 'lb-brand', true, 1048576, array['image/png','image/jpeg','image/webp','image/x-icon','image/vnd.microsoft.icon'])
on conflict (id) do nothing;

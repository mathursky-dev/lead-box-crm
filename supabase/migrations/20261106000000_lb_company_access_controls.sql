-- Super Admin per-company controls in /platform/companies/[id]:
--   1. "Access until" exact date (trial or paid)
--   2. Users allowed for this company (overrides the plan's max_users)
--   3. Active / Inactive (reuses lb_billing.suspended_at; login is blocked in the app)
-- Safe to run more than once.

-- 2. Per-company user limit. null = use the plan's limit.
alter table lb_billing add column if not exists user_limit integer;
do $$ begin
  alter table lb_billing add constraint lb_billing_user_limit_chk check (user_limit is null or user_limit > 0);
exception when duplicate_object then null; end $$;

-- Same contract as before (null = unlimited). The company's own user_limit wins over the
-- plan, and applies even to "free forever" companies, because the Super Admin set it by hand.
create or replace function lb__plan_limit(p_company uuid, p_kind text) returns integer
language sql stable security definer set search_path = public as $$
  select case p_kind
      when 'users' then coalesce(b.user_limit, case when b.plan <> 'internal' then pl.max_users end)
      when 'numbers' then case when b.plan <> 'internal' then pl.max_numbers end
    end
  from lb_billing b left join lb_plans pl on pl.id = b.plan_id
  where b.company_id = p_company
$$;

-- 1. Sets the exact moment access ends. p_kind 'paid' or 'trial'.
--   paid : plan = paid, paid_until = p_until, trial cut to p_until at most
--   trial: plan = trial, trial_ends_at = p_until, paid_until cleared
-- A past date ends access now (data is kept).
create or replace function lb_platform_set_access(p_actor uuid, p_company uuid, p_until timestamptz, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('paid', 'trial') then raise exception 'bad kind'; end if;
  perform set_config('lb.trial_override', 'on', true);
  if p_kind = 'paid' then
    update lb_billing set plan = 'paid', paid_until = p_until,
      trial_ends_at = least(trial_ends_at, p_until), updated_at = now()
    where company_id = p_company;
  else
    update lb_billing set plan = 'trial', trial_ends_at = p_until, paid_until = null, updated_at = now()
    where company_id = p_company;
  end if;
  if not found then raise exception 'company not found'; end if;
  perform set_config('lb.trial_override', 'off', true);
  insert into lb_audit_log (company_id, actor_id, action, entity, entity_id, data)
    values (p_company, p_actor, 'platform.access_until', 'company', p_company,
      jsonb_build_object('until', p_until, 'kind', p_kind));
end $$;

revoke execute on function lb_platform_set_access(uuid, uuid, timestamptz, text), lb__plan_limit(uuid, text) from public, anon, authenticated;
grant execute on function lb_platform_set_access(uuid, uuid, timestamptz, text), lb__plan_limit(uuid, text) to service_role;

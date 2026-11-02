-- AI lead scoring: Claude reads the lead's WhatsApp chat and rates it Hot / Warm / Cold
-- (0-100 points + one-line reason + suggested next step). Shown on the leads list,
-- lead page and inbox. Scored on demand ("Score with AI") and automatically after a
-- customer writes (lb_companies.ai_auto_score, debounced in the app).

-- ------------------------------------------------------------ 1. columns
alter table public.lb_leads
  add column if not exists ai_score text check (ai_score in ('hot', 'warm', 'cold')),
  add column if not exists ai_score_points smallint check (ai_score_points between 0 and 100),
  add column if not exists ai_score_reason text,
  add column if not exists ai_next_step text,
  add column if not exists ai_scored_at timestamptz,
  add column if not exists ai_scored_upto timestamptz; -- time of the newest message the score has seen
create index if not exists lb_leads_ai_score on public.lb_leads (company_id, ai_score) where ai_score is not null;

alter table public.lb_companies add column if not exists ai_auto_score boolean not null default true;

alter table public.lb_ai_outputs drop constraint if exists lb_ai_outputs_kind_check;
alter table public.lb_ai_outputs add constraint lb_ai_outputs_kind_check check (kind in ('summary', 'suggestion', 'score'));

-- ------------------------------------------------------------ 2. save a score (signed-in user)
create or replace function public.lb_set_ai_score(p_lead uuid, p_conv uuid, p_score text, p_points integer, p_reason text,
                                                  p_next text, p_model text, p_upto timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__require('ai.use'); l lb_leads;
begin
  select * into l from lb_leads where id = p_lead and deleted_at is null;
  if l.id is null or l.company_id <> lb_my_company() or not lb_can_see_lead(l.company_id, l.team_id, l.owner_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_score not in ('hot', 'warm', 'cold') then raise exception 'Bad score'; end if;
  if p_conv is not null and not exists (select 1 from lb_conversations where id = p_conv and company_id = l.company_id) then p_conv := null; end if;
  update lb_leads set ai_score = p_score, ai_score_points = greatest(0, least(100, p_points)), ai_score_reason = left(p_reason, 500),
         ai_next_step = left(p_next, 300), ai_scored_at = now(), ai_scored_upto = p_upto
   where id = l.id;
  insert into lb_ai_outputs (company_id, conversation_id, lead_id, kind, content, model, created_by)
  values (l.company_id, p_conv, l.id, 'score',
          jsonb_build_object('score', p_score, 'points', p_points, 'reason', p_reason, 'next_step', p_next)::text, p_model, me.id);
end $$;
revoke all on function public.lb_set_ai_score(uuid, uuid, text, integer, text, text, text, timestamptz) from public, anon;
grant execute on function public.lb_set_ai_score(uuid, uuid, text, integer, text, text, text, timestamptz) to authenticated;

-- ------------------------------------------------------------ 3. leads list: AI score filter, sort and columns
create or replace function public.lb_list_leads(p jsonb)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_deleted boolean := coalesce(p->>'deleted', '') = '1' and lb_is_admin_of(lb_my_company()); v_out jsonb;
begin
  perform set_config('lb.show_deleted', case when v_deleted then '1' else '' end, true);
  v_out := (
with srt as (
    select coalesce(nullif(p->>'sort', ''), 'activity') k,
           case when p->>'dir' in ('asc', 'desc') then p->>'dir'
                when p->>'sort' = 'followup' then 'asc' else 'desc' end d
  ), q as (
    select l.*, c.name customer_name, c.phone_e164, c.email, s.name status_name, s.sort_order status_order, ss.name sub_status_name, o.full_name owner_name,
           pr.name product_name, so.name source_name
    from lb_leads l join lb_customers c on c.id = l.customer_id
    join lb_lead_statuses s on s.id = l.status_id left join lb_profiles o on o.id = l.owner_id
    left join lb_lead_sub_statuses ss on ss.id = l.sub_status_id
    left join lb_products pr on pr.id = l.product_id left join lb_sources so on so.id = l.source_id
    where (nullif(p->>'q','') is null
           or c.name ilike '%' || (p->>'q') || '%' or c.phone_e164 like '%' || regexp_replace(p->>'q','\D','','g') || '%'
              and regexp_replace(p->>'q','\D','','g') <> ''
           or c.email ilike '%' || (p->>'q') || '%' or ('LB-' || l.lead_no) ilike '%' || (p->>'q') || '%')
      and (nullif(p->>'status_id','') is null or l.status_id = (p->>'status_id')::uuid)
      and (nullif(p->>'sub_status_id','') is null or l.sub_status_id = (p->>'sub_status_id')::uuid)
      and (nullif(p->>'category','') is null or l.status_category = p->>'category')
      and (nullif(p->>'owner_id','') is null or l.owner_id = (p->>'owner_id')::uuid)
      and (coalesce((p->>'unassigned')::boolean, false) = false or l.owner_id is null)
      and (coalesce((p->>'open_only')::boolean, false) = false or not lb__closed(l.status_category))
      and (nullif(p->>'seen','') is null
           or (p->>'seen' = 'unseen' and l.owner_id is not null and l.owner_seen_at is null)
           or (p->>'seen' = 'seen' and l.owner_seen_at is not null))
      and (coalesce((p->>'untouched')::boolean, false) = false
           or (l.owner_id is not null and not lb__closed(l.status_category)
               and not exists (select 1 from lb_lead_events w where w.lead_id = l.id and w.is_work
                               and w.actor_id = l.owner_id and w.created_at >= l.assigned_at)))
      and (case when v_deleted then l.deleted_at is not null else l.deleted_at is null end)
      and (nullif(p->>'branch_id','') is null or l.branch_id = (p->>'branch_id')::uuid)
      and (nullif(p->>'department_id','') is null or l.department_id = (p->>'department_id')::uuid)
      and (nullif(p->>'team_id','') is null or l.team_id = (p->>'team_id')::uuid)
      and (nullif(p->>'product_id','') is null or l.product_id = (p->>'product_id')::uuid)
      and (nullif(p->>'source_id','') is null or l.source_id = (p->>'source_id')::uuid)
      and (nullif(p->>'number_id','') is null or l.number_id = (p->>'number_id')::uuid)
      and (nullif(p->>'priority','') is null or l.priority = any(string_to_array(p->>'priority', ',')))
      and (nullif(p->>'ai_score','') is null or (p->>'ai_score' = 'none' and l.ai_score is null)
           or l.ai_score = any(string_to_array(p->>'ai_score', ',')))
      and (coalesce((p->>'stale')::boolean, false) = false or l.last_activity_at < now() - interval '14 days')
      and (nullif(p->>'tag_id','') is null or exists (select 1 from lb_lead_tags t where t.lead_id = l.id and t.tag_id = (p->>'tag_id')::uuid))
      and (nullif(p->>'from','') is null or l.created_at >= (p->>'from')::timestamptz)
      and (nullif(p->>'to','') is null or l.created_at < (p->>'to')::timestamptz)
      and (nullif(p->>'followup','') is null
           or (p->>'followup' = 'today' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                 and f.due_at < (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata'))
           or (p->>'followup' = 'overdue' and exists (select 1 from lb_followups f where f.lead_id = l.id and f.status = 'pending'
                 and f.due_at < date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')))
  ), r as (
    -- one text, one number and one time sort key per row; only the one matching o.k is non-null
    select q.*,
      case srt.k when 'customer' then lower(customer_name) when 'mobile' then phone_e164 when 'email' then lower(email)
               when 'sub_status' then lower(sub_status_name) when 'owner' then lower(owner_name) when 'product' then lower(product_name)
               when 'source' then lower(source_name) when 'remark' then lower(remark) end sk_text,
      case srt.k when 'lead' then lead_no::numeric when 'value' then coalesce(won_value, expected_value)
               when 'status' then status_order::numeric
               when 'priority' then array_position(array['low','normal','high','urgent'], priority)::numeric
               when 'ai_score' then ai_score_points::numeric end sk_num,
      case srt.k when 'activity' then last_activity_at when 'created' then created_at when 'followup' then next_followup_at
               when 'assigned' then assigned_at when 'converted' then converted_at when 'seen' then owner_seen_at end sk_time,
      srt.d
    from q, srt
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'rows', coalesce((select jsonb_agg(row_to_json(x)) from (
      select id, lead_no, customer_id, customer_name, phone_e164, email, status_id, status_name, status_category,
             sub_status_id, sub_status_name, priority, remark, remark_at,
             owner_id, owner_name, owner_seen_at, product_name, source_name, expected_value, won_value, created_at, assigned_at,
             last_activity_at, next_followup_at, converted_at, deleted_at,
             ai_score, ai_score_points, ai_score_reason, ai_scored_at
      from r order by
        case when d = 'asc' then sk_text end asc nulls last,
        case when d = 'desc' then sk_text end desc nulls last,
        case when d = 'asc' then sk_num end asc nulls last,
        case when d = 'desc' then sk_num end desc nulls last,
        case when d = 'asc' then sk_time end asc nulls last,
        case when d = 'desc' then sk_time end desc nulls last,
        last_activity_at desc, id
      limit least(coalesce((p->>'limit')::int, 50), 500) offset coalesce((p->>'offset')::int, 0)) x), '[]'))
  );
  perform set_config('lb.show_deleted', '', true);
  return v_out;
end $$;

-- 1. Team notes inside inbox chats, with @mentions.
--    * lb_notes gets mentions (user ids) and subject (customer name shown to a
--      mentioned teammate who cannot open the chat itself).
--    * lb_add_chat_note(conv, body, mentions): adds the note, writes the lead
--      history entry, notifies every mentioned teammate ("mention") and the chat
--      owner when someone else writes on their chat ("chat_note"). Both become a
--      web push through the existing lb_notifications trigger.
--    * A mentioned user can read that note (and the other notes of that chat) and
--      reply with a note even if the chat is not assigned to them. They still
--      cannot read the customer's messages.
-- 2. AI sales forecast (product-wise, next month).
--    * lb_forecast_history(months): monthly sales per product from paid invoices,
--      store / WhatsApp orders and won leads (a won lead is counted only when it
--      has no paid invoice or order, so nothing is counted twice). Security
--      invoker: RLS decides which leads/orders the caller can see.
--    * lb_forecast_pipeline(): open leads per product (Hot/Warm from AI score,
--      expected value) and last-6-month win rate.
--    * lb_sales_forecasts: saved AI forecasts (written by the server only).
-- Idempotent: safe to run more than once.

-- ── 1. Chat team notes ────────────────────────────────────────────────────
alter table public.lb_notes add column if not exists mentions uuid[] not null default '{}';
alter table public.lb_notes add column if not exists subject text;
create index if not exists lb_notes_conversation on public.lb_notes (conversation_id, created_at) where conversation_id is not null;
create index if not exists lb_notes_mentions on public.lb_notes using gin (mentions);

-- Mentioned teammates can read the notes of that chat.
create or replace function public.lb__mentioned_in_conv(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from lb_notes n where n.conversation_id = p_conv and auth.uid() = any(n.mentions)
    and n.company_id = lb_my_company());
$$;
revoke all on function public.lb__mentioned_in_conv(uuid) from public, anon;
grant execute on function public.lb__mentioned_in_conv(uuid) to authenticated;

drop policy if exists lb_notes_mentioned on public.lb_notes;
create policy lb_notes_mentioned on public.lb_notes for select to authenticated
  using (company_id = public.lb_my_company() and conversation_id is not null
    and (auth.uid() = any(mentions) or public.lb__mentioned_in_conv(conversation_id)));

create or replace function public.lb_add_chat_note(p_conv uuid, p_body text, p_mentions uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); c lb_conversations; v_body text := trim(coalesce(p_body, ''));
  v_ids uuid[]; v_subject text; v_note uuid; u uuid; v_preview text;
begin
  if me.id is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into c from lb_conversations where id = p_conv;
  if c.id is null then raise exception 'Conversation not found'; end if;
  if not (lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id)
          or exists (select 1 from lb_notes n where n.conversation_id = p_conv and me.id = any(n.mentions))) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_body = '' then raise exception 'Note text required'; end if;
  if length(v_body) > 5000 then raise exception 'Note is too long (max 5000 characters)'; end if;

  -- Only active users of this company; never yourself; at most 20.
  select coalesce(array_agg(distinct p.id), '{}') into v_ids
    from lb_profiles p
   where p.id = any(coalesce(p_mentions, '{}')) and p.company_id = c.company_id and p.is_active and p.id <> me.id;
  if coalesce(array_length(v_ids, 1), 0) > 20 then raise exception 'You can mention at most 20 people'; end if;

  select coalesce(nullif(trim(cu.name), ''), nullif(trim(cu.wa_profile_name), ''), cu.phone_e164) into v_subject
    from lb_customers cu where cu.id = c.customer_id;

  insert into lb_notes (company_id, customer_id, lead_id, conversation_id, author_id, body, mentions, subject)
  values (c.company_id, c.customer_id, c.lead_id, p_conv, me.id, v_body, v_ids, v_subject)
  returning id into v_note;

  if c.lead_id is not null then
    insert into lb_lead_events (company_id, lead_id, actor_id, owner_id, type, is_work, data)
    select c.company_id, c.lead_id, me.id, owner_id, 'note', true, jsonb_build_object('body', left(v_body, 2000), 'mentions', to_jsonb(v_ids))
      from lb_leads where id = c.lead_id;
  end if;

  v_preview := left(v_body, 240);
  foreach u in array v_ids loop
    perform lb__notify(c.company_id, u, 'mention',
      coalesce(me.full_name, 'A teammate') || ' mentioned you · ' || coalesce(v_subject, 'chat'),
      v_preview, '/inbox?c=' || p_conv, 'mention:' || v_note || ':' || u);
  end loop;
  if c.assignee_id is not null and c.assignee_id <> me.id and not (c.assignee_id = any(v_ids)) then
    perform lb__notify(c.company_id, c.assignee_id, 'chat_note',
      coalesce(me.full_name, 'A teammate') || ' added a note · ' || coalesce(v_subject, 'chat'),
      v_preview, '/inbox?c=' || p_conv, 'chat_note:' || v_note);
  end if;
  return jsonb_build_object('id', v_note, 'mentions', to_jsonb(v_ids));
end $$;
revoke all on function public.lb_add_chat_note(uuid, text, uuid[]) from public, anon;
grant execute on function public.lb_add_chat_note(uuid, text, uuid[]) to authenticated;

-- New notes show up live in open chats.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lb_notes') then
    alter publication supabase_realtime add table public.lb_notes;
  end if;
exception when undefined_object then null;
end $$;

-- ── 2. AI sales forecast ──────────────────────────────────────────────────
-- Month buckets are in IST. qty = units (won lead without line items = 1 deal).
create or replace function public.lb_forecast_history(p_months int default 12)
returns table (month date, product_id uuid, product text, qty numeric, revenue numeric, deals int)
language sql stable security invoker set search_path = public as $$
  with params as (
    select lb_my_company() as co,
           (date_trunc('month', (now() at time zone 'Asia/Kolkata')) - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1))::date as since
  ),
  prods as (select p.id, p.name from lb_products p, params where p.company_id = params.co),
  inv as (
    select q.lead_id, date_trunc('month', coalesce(q.paid_at, q.updated_at) at time zone 'Asia/Kolkata')::date as m,
           it->>'name' as name, greatest(coalesce((it->>'qty')::numeric, 1), 0) as qty,
           greatest(coalesce((it->>'qty')::numeric, 1), 0) * coalesce((it->>'rate')::numeric, 0) * (1 + coalesce((it->>'tax_pct')::numeric, 0) / 100) as amount,
           q.id as doc
      from lb_quotes q, params, jsonb_array_elements(case when jsonb_typeof(q.items) = 'array' then q.items else '[]'::jsonb end) it
     where q.company_id = params.co and q.kind = 'invoice' and q.status = 'paid'
       and coalesce(q.paid_at, q.updated_at) >= params.since::timestamp at time zone 'Asia/Kolkata'
  ),
  ord as (
    select o.lead_id, date_trunc('month', o.created_at at time zone 'Asia/Kolkata')::date as m,
           nullif(it->>'product_id', '') as pid, it->>'name' as name,
           greatest(coalesce((it->>'qty')::numeric, 1), 0) as qty,
           coalesce((it->>'amount')::numeric, coalesce((it->>'price')::numeric, 0) * greatest(coalesce((it->>'qty')::numeric, 1), 0)) as amount,
           o.id as doc
      from lb_orders o, params, jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
     where o.company_id = params.co and o.status <> 'cancelled'
       and o.created_at >= params.since::timestamp at time zone 'Asia/Kolkata'
  ),
  won as (
    select l.id as lead_id, date_trunc('month', coalesce(l.converted_at, l.closed_at) at time zone 'Asia/Kolkata')::date as m,
           l.product_id, coalesce(l.won_value, l.expected_value, 0) as amount
      from lb_leads l, params
     where l.company_id = params.co and l.status_category = 'won' and coalesce(l.converted_at, l.closed_at) is not null
       and coalesce(l.converted_at, l.closed_at) >= params.since::timestamp at time zone 'Asia/Kolkata'
       and not exists (select 1 from inv where inv.lead_id = l.id)
       and not exists (select 1 from ord where ord.lead_id = l.id)
  ),
  lines as (
    select i.m, p.id as pid, coalesce(p.name, nullif(trim(i.name), ''), 'Other') as pname, i.qty, i.amount, i.doc::text as doc
      from inv i left join prods p on lower(p.name) = lower(trim(i.name))
    union all
    select o.m, p.id, coalesce(p.name, nullif(trim(o.name), ''), 'Other'), o.qty, o.amount, o.doc::text
      from ord o left join prods p on p.id::text = o.pid or (o.pid is null and lower(p.name) = lower(trim(o.name)))
    union all
    select w.m, w.product_id, coalesce(p.name, 'No product'), 1, w.amount, w.lead_id::text
      from won w left join prods p on p.id = w.product_id
  )
  select m, pid, pname, round(sum(qty), 2), round(sum(amount), 2), count(distinct doc)::int
    from lines group by m, pid, pname order by m, pname;
$$;
revoke all on function public.lb_forecast_history(int) from public, anon;
grant execute on function public.lb_forecast_history(int) to authenticated;

create or replace function public.lb_forecast_pipeline()
returns table (product_id uuid, product text, open_leads int, hot int, warm int, open_value numeric, won_6m int, lost_6m int, avg_days_to_win numeric)
language sql stable security invoker set search_path = public as $$
  select l.product_id, coalesce(p.name, 'No product'),
         count(*) filter (where l.status_category not in ('won','lost','invalid'))::int,
         count(*) filter (where l.status_category not in ('won','lost','invalid') and l.ai_score = 'hot')::int,
         count(*) filter (where l.status_category not in ('won','lost','invalid') and l.ai_score = 'warm')::int,
         round(coalesce(sum(l.expected_value) filter (where l.status_category not in ('won','lost','invalid')), 0), 2),
         count(*) filter (where l.status_category = 'won' and l.converted_at >= now() - interval '6 months')::int,
         count(*) filter (where l.status_category in ('lost','invalid') and l.closed_at >= now() - interval '6 months')::int,
         round(avg(extract(epoch from (l.converted_at - l.created_at)) / 86400)
           filter (where l.status_category = 'won' and l.converted_at >= now() - interval '6 months'), 1)
    from lb_leads l left join lb_products p on p.id = l.product_id
   where l.company_id = lb_my_company()
     and (l.status_category not in ('won','lost','invalid') or coalesce(l.closed_at, l.converted_at, l.updated_at) >= now() - interval '6 months')
   group by l.product_id, p.name
   order by 4 desc;
$$;
revoke all on function public.lb_forecast_pipeline() from public, anon;
grant execute on function public.lb_forecast_pipeline() to authenticated;

create table if not exists public.lb_sales_forecasts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete cascade,
  month date not null,              -- first day of the forecast month (IST)
  created_by uuid references public.lb_profiles(id) on delete set null,
  model text,
  input jsonb not null default '{}'::jsonb,    -- history + pipeline the AI saw
  result jsonb not null default '{}'::jsonb,   -- {summary, total_revenue, products:[...], tips:[...]}
  created_at timestamptz not null default now()
);
create index if not exists lb_sales_forecasts_company on public.lb_sales_forecasts (company_id, created_at desc);

alter table public.lb_sales_forecasts enable row level security;
revoke all on public.lb_sales_forecasts from anon, authenticated;
grant select on public.lb_sales_forecasts to authenticated;
drop policy if exists lb_sales_forecasts_read on public.lb_sales_forecasts;
create policy lb_sales_forecasts_read on public.lb_sales_forecasts for select to authenticated
  using (company_id = public.lb_my_company() and public.lb_can('reports.view'));
drop policy if exists lb_paid on public.lb_sales_forecasts;
create policy lb_paid on public.lb_sales_forecasts as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

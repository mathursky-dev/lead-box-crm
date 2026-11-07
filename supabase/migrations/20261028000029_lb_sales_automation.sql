-- Sales automation glue between chatbot flows, lead statuses and nurture journeys.
-- Safe to run more than once in the Supabase SQL editor.

-- 1) Consent on enquiry (per company, off by default): a Facebook lead form or a first WhatsApp
--    message from the customer records a WhatsApp opt-in, so journeys can follow up with templates.
alter table public.lb_companies add column if not exists consent_on_enquiry boolean not null default false;

create or replace function public.lb__consent_on_enquiry(p_customer uuid, p_source text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from lb_customers c join lb_companies co on co.id = c.company_id
                 where c.id = p_customer and co.consent_on_enquiry and c.wa_opt_in_at is null and c.wa_opted_out_at is null) then return; end if;
  perform set_config('lb.consent_source', p_source, true);
  perform set_config('lb.consent_note', p_note, true);
  update lb_customers set wa_opt_in_at = now() where id = p_customer;  -- lb__on_consent logs the consent event
  perform set_config('lb.consent_source', '', true);
  perform set_config('lb.consent_note', '', true);
end $$;

create or replace function public.lb__on_enquiry_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type in ('created','repeat_created') and new.data->>'via' = 'facebook' then
    perform lb__consent_on_enquiry((select customer_id from lb_leads where id = new.lead_id), 'form', 'Facebook lead form');
  end if;
  return new;
end $$;
drop trigger if exists lb_lead_events_consent on public.lb_lead_events;
-- Name sorts before lb_lead_events_nurture, so consent exists before journeys enroll.
create trigger lb_lead_events_consent after insert on public.lb_lead_events for each row execute function public.lb__on_enquiry_lead();

create or replace function public.lb__on_enquiry_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' then
    perform lb__consent_on_enquiry((select customer_id from lb_conversations where id = new.conversation_id), 'api', 'Customer messaged first on WhatsApp');
  end if;
  return new;
end $$;
drop trigger if exists lb_messages_consent on public.lb_messages;
create trigger lb_messages_consent after insert on public.lb_messages for each row execute function public.lb__on_enquiry_message();

-- 2) Weekly marketing cap counts templates only. Chatbot and auto-reply messages are free-form
--    replies inside the 24h window and were wrongly using up the cap.
do $$ declare def text := pg_get_functiondef('lb__send_check(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
  old text := 'and coalesce(m.template_category, ''MARKETING'') = ''MARKETING'' and m.created_at > now() - interval ''7 days'';';
begin
  if position('m.type = ''template''' in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'lb__send_check patch target not found'; end if;
  execute replace(def, old, 'and m.type = ''template'' ' || old);
end $$;

-- 3) A status journey always replaces the journey of the previous status (newest status wins),
--    instead of being blocked by priority.
do $$ declare def text := pg_get_functiondef('lb__enroll(uuid,uuid,uuid,boolean)'::regprocedure);
  old1 text := 'select en.id, en.journey_id, jj.priority into cur';
  old2 text := 'if cur.priority <= j.priority and not p_force then';
begin
  if position('jj.trigger_type into cur' in def) > 0 then return; end if;
  if position(old1 in def) = 0 or position(old2 in def) = 0 then raise exception 'lb__enroll patch target not found'; end if;
  def := replace(def, old1, 'select en.id, en.journey_id, jj.priority, jj.trigger_type into cur');
  def := replace(def, old2, 'if cur.priority <= j.priority and not p_force and not (j.trigger_type = ''status_entered'' and cur.trigger_type = ''status_entered'') then');
  execute def;
end $$;

-- 4) Chat tags can move the lead forward: a tag with sets_status_category (e.g. a chatbot's
--    "Demo requested" tag → interested) sets that status when it is added, never moving a lead back.
alter table public.lb_tags add column if not exists sets_status_category text
  check (sets_status_category in ('contacted','interested','follow_up','scheduled'));

create or replace function public.lb__lead_stage(p_cat text) returns integer language sql immutable as $$
  select case p_cat when 'new' then 0 when 'assigned' then 1 when 'contacted' then 2 when 'follow_up' then 3
    when 'interested' then 4 when 'scheduled' then 5 else 99 end
$$;

create or replace function public.lb__on_conversation_tag() returns trigger
language plpgsql security definer set search_path = public as $$
declare t lb_tags; l lb_leads; v_sid uuid;
begin
  select * into t from lb_tags where id = new.tag_id;
  if t.sets_status_category is null then return new; end if;
  select ld.* into l from lb_conversations c join lb_leads ld on ld.id = c.lead_id where c.id = new.conversation_id;
  if l.id is null or lb__lead_stage(l.status_category) >= lb__lead_stage(t.sets_status_category) then return new; end if;
  v_sid := lb__default_status(l.company_id, t.sets_status_category);
  if v_sid is null then return new; end if;
  begin
    perform lb__set_status(l.id, v_sid, null, 'Chat tag: ' || t.name, null, false);
  exception when others then null;  -- never block the tag (or the chatbot) on a status problem
  end;
  return new;
end $$;
drop trigger if exists lb_conversation_tags_status on public.lb_conversation_tags;
create trigger lb_conversation_tags_status after insert on public.lb_conversation_tags for each row execute function public.lb__on_conversation_tag();

-- 5) When a chatbot flow finishes, its answers are saved as a note on the lead.
create or replace function public.lb__on_flow_session_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare c lb_conversations; v_flow text; v_body text;
begin
  if old.status <> 'waiting' or new.status not in ('done','handoff') then return new; end if;
  select * into c from lb_conversations where id = new.conversation_id;
  select string_agg(initcap(replace(key, '_', ' ')) || ': ' || left(value, 300), E'\n' order by key) into v_body
  from jsonb_each_text(new.vars) where key not in ('name','phone','email','last_reply') and coalesce(value, '') <> '';
  if c.id is null or v_body is null then return new; end if;
  select name into v_flow from lb_wa_flows where id = new.flow_id;
  v_body := '🤖 Chatbot answers (' || coalesce(v_flow, 'flow') || '):' || E'\n' || v_body;
  insert into lb_notes (company_id, customer_id, lead_id, conversation_id, body) values (c.company_id, c.customer_id, c.lead_id, c.id, v_body);
  if c.lead_id is not null then
    insert into lb_lead_events (company_id, lead_id, owner_id, type, data)
    select c.company_id, c.lead_id, owner_id, 'note', jsonb_build_object('body', v_body, 'via', 'chatbot') from lb_leads where id = c.lead_id;
    update lb_leads set last_activity_at = now() where id = c.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists lb_wa_flow_sessions_done on public.lb_wa_flow_sessions;
create trigger lb_wa_flow_sessions_done after update of status on public.lb_wa_flow_sessions for each row execute function public.lb__on_flow_session_done();

revoke execute on function public.lb__consent_on_enquiry(uuid, text, text), public.lb__on_enquiry_lead(), public.lb__on_enquiry_message(),
  public.lb__on_conversation_tag(), public.lb__on_flow_session_done() from public, anon, authenticated;

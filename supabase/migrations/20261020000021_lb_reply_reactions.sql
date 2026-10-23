-- Reply quotes (WhatsApp "context") and reactions, ported from wacrm. Additive only.
alter table lb_messages
  add column if not exists reply_to_wa_id text,
  add column if not exists reply_to_id uuid references lb_messages(id) on delete set null,
  add column if not exists customer_reaction text,
  add column if not exists agent_reaction text;

-- Outbound replies: accept p.reply_to (a message in the same conversation).
do $$ declare d text; n int; begin
  d := pg_get_functiondef('lb_enqueue_message(uuid,uuid,jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, 'client_id, status, next_attempt_at, sent_by)', ''))) / length('client_id, status, next_attempt_at, sent_by)');
  if n <> 1 then raise exception 'enqueue patch: expected 1 column-list match, got %', n; end if;
  d := replace(d, 'client_id, status, next_attempt_at, sent_by)', 'client_id, status, next_attempt_at, sent_by, reply_to_id)');
  n := (length(d) - length(replace(d, 'p_client_id, ''queued'', now(), me.id)', ''))) / length('p_client_id, ''queued'', now(), me.id)');
  if n <> 1 then raise exception 'enqueue patch: expected 1 values match, got %', n; end if;
  d := replace(d, 'p_client_id, ''queued'', now(), me.id)',
    'p_client_id, ''queued'', now(), me.id, (select r.id from lb_messages r where r.id = nullif(p->>''reply_to'','''')::uuid and r.conversation_id = p_conv))');
  execute d;
end $$;

-- Inbound: link a customer's quoted reply to the original message (service role only).
create or replace function lb__link_reply(p_msg uuid, p_context_wamid text) returns void
language sql security definer set search_path = public as $$
  update lb_messages m set reply_to_wa_id = p_context_wamid,
    reply_to_id = (select r.id from lb_messages r where r.wa_message_id = p_context_wamid and r.conversation_id = m.conversation_id limit 1)
  where m.id = p_msg;
$$;

-- Inbound reaction on one of our messages (or theirs). Empty emoji = removed. Idempotent.
create or replace function lb__apply_reaction(p_target_wamid text, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update lb_messages set customer_reaction = nullif(p_emoji, '') where wa_message_id = p_target_wamid;
  return found;
end $$;

-- Agent reaction: checks access, send permission, number access and the 24h window; returns what the server needs to call Meta.
create or replace function lb_reaction_target(p_msg uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me lb_profiles := lb__me(); m lb_messages; c lb_conversations;
begin
  select * into m from lb_messages where id = p_msg;
  select * into c from lb_conversations where id = m.conversation_id;
  if m.id is null or not lb_can_see_conversation(c.company_id, c.team_id, c.assignee_id, c.number_id) then raise exception 'Not permitted' using errcode='42501'; end if;
  if not lb_can('chats.send') then raise exception 'You do not have permission to send WhatsApp messages' using errcode='42501'; end if;
  if c.assignee_id is distinct from me.id and not lb_can_use_number(c.number_id) then raise exception 'You do not have access to this business number' using errcode='42501'; end if;
  if m.wa_message_id is null then raise exception 'This message has no WhatsApp id yet'; end if;
  if c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours' then raise exception 'The 24-hour customer service window is closed.'; end if;
  return jsonb_build_object('number_id', c.number_id, 'wamid', m.wa_message_id, 'to', (select phone_e164 from lb_customers where id = c.customer_id));
end $$;

revoke execute on function lb__link_reply(uuid, text), lb__apply_reaction(text, text), lb_reaction_target(uuid) from public, anon, authenticated;
grant execute on function lb__link_reply(uuid, text), lb__apply_reaction(text, text), lb_reaction_target(uuid) to service_role;
grant execute on function lb_reaction_target(uuid) to authenticated;

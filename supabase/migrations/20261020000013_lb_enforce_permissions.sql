-- Enforce the role permission matrix inside the write RPCs. Each patch must
-- match exactly once, otherwise the migration aborts.
do $$
declare
  r record; def text; n int;
begin
  for r in select * from (values
    ('lb_create_lead(jsonb)',
     E'begin\n  if v_phone is null or v_phone',
     E'begin\n  if not lb_can(''leads.create'') then raise exception ''You do not have permission to create leads'' using errcode = ''42501''; end if;\n  if v_phone is null or v_phone'),
    ('lb_assign_leads(uuid[],uuid,text)',
     E'if not (me.role in (''super_admin'',''company_admin'',''team_leader'') or ''assign_leads'' = any(me.permissions)) then',
     E'if not lb_can(''leads.assign'') then'),
    ('lb_auto_allocate_leads(uuid[])',
     E'if me.role not in (''super_admin'',''company_admin'',''team_leader'') then raise exception ''Not allowed'' using errcode=''42501''; end if;',
     E'if not lb_can(''leads.assign'') then raise exception ''You do not have permission to assign leads'' using errcode=''42501''; end if;'),
    ('lb_change_status(uuid,uuid,text,numeric)',
     E'begin\n  if not lb_can_see_lead_id(p_lead)',
     E'begin\n  if not lb_can(''leads.status'') then raise exception ''You do not have permission to change lead status'' using errcode=''42501''; end if;\n  if not lb_can_see_lead_id(p_lead)'),
    ('lb_update_lead(uuid,jsonb)',
     E'begin\n  select * into l from lb_leads where id = p_lead for update;',
     E'begin\n  if not lb_can(''leads.edit'') then raise exception ''You do not have permission to edit leads'' using errcode=''42501''; end if;\n  select * into l from lb_leads where id = p_lead for update;'),
    ('lb_enqueue_message(uuid,uuid,jsonb)',
     E'  select * into c from lb_conversations where id = p_conv;\n',
     E'  if not lb_can(''chats.send'') then raise exception ''You do not have permission to send WhatsApp messages'' using errcode=''42501''; end if;\n  select * into c from lb_conversations where id = p_conv;\n'),
    ('lb_conversation_action(uuid,text,jsonb)',
     E'  elsif p_action = ''transfer'' then\n',
     E'  elsif p_action = ''transfer'' then\n    if not lb_can(''chats.transfer'') then raise exception ''You do not have permission to transfer chats'' using errcode=''42501''; end if;\n'),
    ('lb_conversation_action(uuid,text,jsonb)',
     E'  elsif p_action = ''create_lead'' then\n',
     E'  elsif p_action = ''create_lead'' then\n    if not lb_can(''leads.create'') then raise exception ''You do not have permission to create leads'' using errcode=''42501''; end if;\n'),
    ('lb_check_phones(text[])',
     E'if not (me.role in (''super_admin'',''company_admin'',''team_leader'') or ''import_leads'' = any(me.permissions)) then',
     E'if not lb_can(''leads.import'') then')
  ) v(sig, old, new)
  loop
    def := pg_get_functiondef(r.sig::regprocedure);
    n := (length(def) - length(replace(def, r.old, ''))) / length(r.old);
    if n <> 1 then raise exception 'Patch for % matched % times', r.sig, n; end if;
    execute replace(def, r.old, r.new);
  end loop;
end $$;

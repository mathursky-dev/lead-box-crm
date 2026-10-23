-- Fix: the completion check in lb_run_campaigns used table alias "r", which
-- collides with the loop variable "r" (ambiguous column error at runtime).
do $$ declare def text := pg_get_functiondef('lb_run_campaigns(integer)'::regprocedure);
  old text := 'not exists (select 1 from lb_campaign_recipients r where r.campaign_id = c.id and r.status = ''pending'')';
begin
  if position(old in def) = 0 then raise exception 'patch target not found'; end if;
  execute replace(def, old, 'not exists (select 1 from lb_campaign_recipients cr where cr.campaign_id = c.id and cr.status = ''pending'')');
end $$;

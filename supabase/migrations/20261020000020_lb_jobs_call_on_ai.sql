-- The minute scheduler also calls the app when AI jobs are queued.
do $$ declare def text := pg_get_functiondef('lb__call_jobs()'::regprocedure);
  old text := 'or exists (select 1 from lb_messages where direction = ''in'' and media_status = ''failed''';
begin
  if position(old in def) = 0 then raise exception 'patch target not found'; end if;
  execute replace(def, old, 'or exists (select 1 from lb_jobs where status = ''queued'' and next_run_at <= now()) ' || old);
end $$;

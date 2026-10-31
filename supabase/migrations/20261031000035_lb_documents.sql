-- Documents: a per-company file library (catalogues, price lists, brochures).
-- Files live in the private "lb-docs" bucket at {company_id}/{uuid}-{file name}.
-- Every read and write goes through server actions that filter by the caller's
-- company_id; the select policy below is a second guard.

create table if not exists public.lb_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lb_companies(id) on delete restrict,
  description text not null default '' check (length(description) <= 300),
  file_name text not null check (length(trim(file_name)) between 1 and 200),
  path text not null unique,
  mime text not null default 'application/octet-stream',
  size bigint not null default 0 check (size >= 0),
  created_by uuid references public.lb_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lb_documents_company on public.lb_documents (company_id, created_at desc);

alter table public.lb_documents enable row level security;
revoke all on public.lb_documents from anon;
revoke insert, update, delete on public.lb_documents from authenticated;
grant select on public.lb_documents to authenticated;
drop policy if exists lb_documents_read on public.lb_documents;
drop policy if exists lb_paid on public.lb_documents;
create policy lb_documents_read on public.lb_documents for select to authenticated
  using (public.lb_is_super() or company_id = public.lb_my_company());
create policy lb_paid on public.lb_documents as restrictive for all to authenticated
  using ((select public.lb_access_ok())) with check ((select public.lb_access_ok()));

-- Private bucket; no client policies (the server hands out signed URLs).
insert into storage.buckets (id, name, public, file_size_limit)
values ('lb-docs', 'lb-docs', false, 104857600)
on conflict (id) do nothing;

import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { DocumentsTable } from "./documents";
import type { Doc } from "@/lib/actions/documents";

export const metadata = { title: "Documents" };

const SIZES = [10, 20, 50, 100];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const size = SIZES.includes(Number(sp.size)) ? Number(sp.size) : 20;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const q = String(sp.q ?? "").slice(0, 80);
  const term = q.replace(/[%_,()\\]/g, " ").trim();

  // Super admins can read every company's documents through RLS, so filter to the caller's company.
  let qy = (await createClient()).from("lb_documents").select("id,description,file_name,mime,size,created_at,created_by", { count: "exact" })
    .eq("company_id", profile.company_id).order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  if (term) qy = qy.or(`description.ilike.%${term}%,file_name.ilike.%${term}%`);
  const [{ data, count, error }, refs] = await Promise.all([qy, loadRefs()]);
  const users = Object.fromEntries(refs.users.map((u) => [u.id, u.full_name]));

  return (
    <>
      <PageHeader icon="files" tone="violet" title="Documents"
        sub="Your company's file library: catalogues, price lists, brochures. Send any of them from the inbox with “Select from Documents”." />
      <DocumentsTable
        docs={(data ?? []) as Doc[]} total={count ?? 0} page={page} size={size} sizes={SIZES} q={q} error={error?.message}
        users={users} meId={profile.id} admin={isAdmin(profile)}
      />
    </>
  );
}

import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { Importer } from "./importer";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  const { profile } = await requireProfile();
  if (!can(profile, "leads.import")) redirect("/leads");
  const { data: jobs } = await (await createClient()).from("lb_import_jobs").select("id,filename,total_rows,created_count,duplicate_count,error_count,created_at").order("created_at", { ascending: false }).limit(10);
  return (
    <>
      <PageHeader title="Import leads (CSV)" sub="Map columns, preview validation and duplicates, then import. Product, source, branch, department and tags are matched by name; owner by email." />
      <Importer />
      {!!jobs?.length && (
        <section className="card mt-6 overflow-x-auto">
          <h2 className="p-4 pb-2 text-sm font-semibold text-navy-900">Recent imports</h2>
          <table className="w-full min-w-[600px] text-sm">
            <thead className="border-y bg-slate-50"><tr><th className="th">When</th><th className="th">File</th><th className="th">Rows</th><th className="th">Created</th><th className="th">Duplicates skipped</th><th className="th">Errors</th></tr></thead>
            <tbody className="divide-y">{jobs.map((j) => <tr key={j.id}><td className="td">{fmtDateTime(j.created_at)}</td><td className="td">{j.filename}</td><td className="td">{j.total_rows}</td><td className="td">{j.created_count}</td><td className="td">{j.duplicate_count}</td><td className="td">{j.error_count}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

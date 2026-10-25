import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { KnowledgeForm, KnowledgeButtons } from "./knowledge-forms";

export const metadata = { title: "AI knowledge" };
const TONE: Record<string, string> = { draft: "bg-slate-100", approved: "bg-brand-100 text-brand-700", archived: "bg-slate-200 text-slate-500" };

export default async function KnowledgePage() {
  const { profile } = await requireProfile();
  if (!can(profile, "knowledge.manage")) redirect("/nurture");
  const sb = await createClient();
  const { data } = await sb.from("lb_knowledge").select("id,title,content,status,updated_at,approved_at").neq("status", "archived").order("updated_at", { ascending: false });
  return (
    <>
      <PageHeader icon="book" tone="violet" title="AI knowledge" sub="Suggested replies may only use APPROVED entries (prices, policies, product facts). Editing an entry returns it to draft until re-approved." actions={<KnowledgeForm />} />
      {!data?.length ? <Empty title="No knowledge yet">Add product, pricing and policy facts, then approve them.</Empty> : (
        <div className="space-y-3">{data.map((k) => (
          <section key={k.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-navy-900">{k.title}</h2><span className={`badge capitalize ${TONE[k.status]}`}>{k.status}</span>
              <span className="text-xs text-slate-400">updated {fmtDateTime(k.updated_at)}</span>
              <span className="ml-auto flex gap-1"><KnowledgeForm k={k} /><KnowledgeButtons id={k.id} status={k.status} /></span></div>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-slate-600">{k.content}</p>
          </section>
        ))}</div>
      )}
    </>
  );
}

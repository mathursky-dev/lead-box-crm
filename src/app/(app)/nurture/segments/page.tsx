import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Empty } from "@/components/static";
import { SegmentForm } from "./segment-form";
import { CsvListForm } from "./csv-list";

export const metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const { profile } = await requireProfile();
  if (!can(profile, "campaigns.manage")) redirect("/nurture");
  const sb = await createClient();
  const refs = await loadRefs();
  const { data: segments } = await sb.from("lb_segments").select("*").order("name");
  const previews = await Promise.all((segments ?? []).map(async (s) => (await sb.rpc("lb_segment_preview", { p_segment: s.id })).data));
  return (
    <>
      <PageHeader title="Customer segments" sub="Reusable audiences for campaigns and segment-triggered journeys. Counts are live; consent and suppression are applied again right before each send."
        actions={<span className="flex gap-2"><CsvListForm canConsent={can(profile, "consent.manage")} /><SegmentForm refs={refs} /></span>} />
      {!segments?.length ? <Empty title="No segments yet" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {segments.map((s, i) => {
            const p = previews[i] as { total: number; eligible: number; opted_out: number; no_consent: number; suppressed: number; sample: { name: string | null; phone_e164: string }[] } | null;
            return (
              <div key={s.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-navy-900">{s.name}</div>
                  {s.rules?.kind === "list" ? <span className="badge bg-sky-50 text-sky-800">CSV list</span> : <SegmentForm refs={refs} segment={s} />}
                </div>
                {p && (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="badge bg-brand-100 text-brand-700">{p.eligible} eligible</span>
                      <span className="badge bg-slate-100">{p.total} matching</span>
                      <span className="badge bg-amber-50 text-amber-800">{p.no_consent} no consent</span>
                      <span className="badge bg-red-50 text-red-700">{p.opted_out} opted out</span>
                      <span className="badge bg-slate-200">{p.suppressed} suppressed</span>
                    </div>
                    {p.sample.length > 0 && <div className="mt-2 text-xs text-slate-500">e.g. {p.sample.map((x) => x.name || x.phone_e164).join(", ")}</div>}
                  </>
                )}
                {s.rules?.kind !== "list" && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-400">{JSON.stringify(Object.fromEntries(Object.entries(s.rules).filter(([, v]) => v !== "" && v !== false && v !== "any" && !(Array.isArray(v) && !v.length))))}</pre>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

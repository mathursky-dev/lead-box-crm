"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/kit";
import { Modal } from "@/components/ui";
import { StatusBadge } from "@/components/static";
import { fmtDateTime, fmtDay, money } from "@/lib/dates";
import { previewMerge, mergeLeads, type MergePreview } from "@/lib/actions/merge";

export type DupLead = {
  id: string; lead_no: number; status: string; category: string; owner: string | null; source: string | null; product: string | null;
  priority: string; expected_value: number | null; created_at: string; last_activity_at: string; next_followup_at: string | null;
  is_repeat: boolean; events: number; notes: number; followups: number;
};
export type DupGroup = { customer_id: string; name: string | null; phone: string; count: number; open: number; last_activity_at: string; leads: DupLead[] };

const CLOSED = ["won", "lost", "closed"];

/** Suggested lead to keep: a won lead, else the open lead worked most recently, else the latest. */
function suggestKeep(leads: DupLead[]) {
  const by = (a: DupLead, b: DupLead) => b.last_activity_at.localeCompare(a.last_activity_at);
  return ([...leads].filter((l) => l.category === "won").sort(by)[0]
    ?? [...leads].filter((l) => !CLOSED.includes(l.category)).sort(by)[0]
    ?? [...leads].sort(by)[0]).id;
}

const MOVE_LABEL: Record<string, string> = {
  lb_lead_events: "history entries", lb_notes: "notes", lb_followups: "follow-ups", lb_tasks: "tasks", lb_conversations: "WhatsApp chats",
  lb_journey_enrollments: "journey runs", lb_campaign_recipients: "campaign sends", lb_attributions: "attribution records",
  lb_complaints: "complaints", lb_signals: "signals", lb_ai_outputs: "AI results", lb_fb_lead_events: "Facebook lead records", lb_calls: "calls", new_tags: "new tags",
};

export function DuplicatesView({ groups }: { groups: DupGroup[] }) {
  const [done, setDone] = useState<{ text: string; id: string } | null>(null);
  return (
    <div className="space-y-4">
      {done && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-800">
          <Icon name="check" className="h-4 w-4" />{done.text}
          <Link href={`/leads/${done.id}`} className="ml-auto font-medium underline">Open lead</Link>
        </div>
      )}
      {/* Remount a group when its leads change so a partly merged number starts fresh. */}
      {groups.map((g) => <Group key={g.customer_id + g.leads.map((l) => l.id).join()} g={g} onDone={(text, id) => setDone({ text, id })} />)}
    </div>
  );
}

function Group({ g, onDone }: { g: DupGroup; onDone: (text: string, id: string) => void }) {
  const router = useRouter();
  const [keep, setKeep] = useState(() => suggestKeep(g.leads));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(g.leads.map((l) => l.id)));
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const merge = g.leads.filter((l) => l.id !== keep && picked.has(l.id)).map((l) => l.id);
  const keepLead = g.leads.find((l) => l.id === keep)!;

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openPreview = () => start(async () => {
    setErr(null);
    const r = await previewMerge(keep, merge);
    if (r.error) setErr(r.error); else setPreview(r.preview!);
  });
  const confirm = () => start(async () => {
    const r = await mergeLeads(keep, merge);
    if (r.error) { setErr(r.error); setPreview(null); return; }
    setPreview(null);
    onDone(`Merged ${r.merged!.map((n) => `LB-${n}`).join(", ")} into LB-${r.lead_no}.`, keep);
    router.refresh();
  });

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-700"><Icon name="phone" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <Link href={`/customers/${g.customer_id}`} className="font-semibold text-navy-900 hover:underline">{g.name || "Unnamed customer"}</Link>
          <div className="text-xs text-slate-500">{g.phone} · {g.count} active leads{g.open !== g.count ? ` (${g.open} open)` : ""}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn-primary btn-sm" disabled={!merge.length || pending} onClick={openPreview}>
            {pending && !preview ? "Checking…" : merge.length ? `Merge ${merge.length} into LB-${keepLead.lead_no}` : "Pick leads to merge"}
          </button>
        </div>
      </header>
      {err && <div role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Keep</th><th className="px-3 py-2">Merge</th><th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Source / product</th>
              <th className="px-3 py-2">Created</th><th className="px-3 py-2">Last activity</th><th className="px-3 py-2">History</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {g.leads.map((l) => {
              const isKeep = l.id === keep;
              return (
                <tr key={l.id} className={isKeep ? "bg-brand-50/60" : ""}>
                  <td className="px-3 py-2">
                    <input type="radio" name={`keep-${g.customer_id}`} checked={isKeep} onChange={() => setKeep(l.id)} aria-label={`Keep LB-${l.lead_no}`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={!isKeep && picked.has(l.id)} disabled={isKeep} onChange={() => toggle(l.id)} aria-label={`Merge LB-${l.lead_no}`} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/leads/${l.id}`} className="font-medium text-brand-700 hover:underline">LB-{l.lead_no}</Link>
                    {isKeep && <span className="badge ml-2 bg-brand-100 text-brand-800">Keep</span>}
                    {l.is_repeat && <span className="badge ml-2 bg-sky-50 text-sky-700">Repeat</span>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge name={l.status} category={l.category} /></td>
                  <td className="px-3 py-2">{l.owner ?? <span className="text-slate-400">Unassigned</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{[l.source, l.product].filter(Boolean).join(" · ") || "—"}{l.expected_value != null && <div className="text-xs text-slate-500">{money(l.expected_value)}</div>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(l.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTime(l.last_activity_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{l.events} events · {l.notes} notes · {l.followups} due</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!preview} onClose={() => !pending && setPreview(null)} title="Merge leads?">
        {preview && (
          <div className="space-y-4 text-sm">
            <p>
              <b>{preview.merge.map((m) => `LB-${m.lead_no}`).join(", ")}</b> will be merged into <b>LB-{preview.keep.lead_no}</b>.
              LB-{preview.keep.lead_no} keeps its status, owner and priority.
            </p>
            <div>
              <div className="mb-1 font-medium text-navy-900">Moves to LB-{preview.keep.lead_no}</div>
              <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                {Object.entries(preview.moves).filter(([, n]) => n > 0).map(([k, n]) => <li key={k}>{n} {MOVE_LABEL[k] ?? k.replace(/^lb_/, "").replace(/_/g, " ")}</li>)}
                {!Object.values(preview.moves).some((n) => n > 0) && <li>No history to move.</li>}
              </ul>
            </div>
            {preview.fills.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-navy-900">Empty fields filled from the merged leads</div>
                <p className="text-slate-700">{preview.fills.join(", ")}</p>
              </div>
            )}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              The merged leads are removed from all lists and reports, and old links open LB-{preview.keep.lead_no}. This cannot be undone.
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={pending} onClick={() => setPreview(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={pending} onClick={confirm}>{pending ? "Merging…" : `Merge ${preview.merge.length} lead${preview.merge.length > 1 ? "s" : ""}`}</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

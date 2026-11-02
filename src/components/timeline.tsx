import { fmtDateTime } from "@/lib/dates";

export type Ev = {
  id: string; type: string; is_work: boolean; reason: string | null; data: Record<string, unknown>; created_at: string;
  actor: string; from_user?: string; to_user?: string; from_status?: string; to_status?: string; lead_no?: number;
};

function describe(e: Ev) {
  switch (e.type) {
    case "created": return "Lead created";
    case "repeat_created": return "Repeat opportunity created";
    case "status_change": return <>Status <b>{e.from_status ?? "—"}</b> → <b>{e.to_status}</b></>;
    case "assignment":
      if (!e.to_user) return <>Unassigned from <b>{e.from_user}</b></>;
      return e.from_user ? <>Transferred <b>{e.from_user}</b> → <b>{e.to_user}</b></> : <>Assigned to <b>{e.to_user}</b></>;
    case "note": return <>Note: <span className="whitespace-pre-wrap">{String(e.data?.body ?? "")}</span></>;
    case "call": return e.data?.auto ? <>📞 {String(e.data?.body ?? "Call")} <span className="text-xs text-slate-400">(mobile app)</span></> : <>Call logged: <span className="whitespace-pre-wrap">{String(e.data?.body ?? "")}</span></>;
    case "message_out": return "WhatsApp message sent";
    case "message_in": return "WhatsApp message received";
    case "followup_created": return <>Follow-up scheduled{e.data?.due_at ? ` for ${fmtDateTime(String(e.data.due_at))}` : e.data?.journey ? ` by ${e.data.journey}` : ""}{e.data?.note ? ` — ${e.data.note}` : ""}</>;
    case "followup_done": return e.data?.cancelled ? "Follow-up cancelled" : "Follow-up completed";
    case "field_update":
      if (e.data && Array.isArray(e.data.merged_leads)) return <>Merged duplicate lead{e.data.merged_leads.length > 1 ? "s" : ""} <b>{(e.data.merged_leads as number[]).map((n) => `LB-${n}`).join(", ")}</b> into this lead{Array.isArray(e.data.filled) && e.data.filled.length ? ` · filled ${(e.data.filled as string[]).join(", ")}` : ""}</>;
      if (e.data && "merged_into" in e.data) return <>Merged into <b>LB-{String(e.data.merged_into)}</b></>;
      if (e.data && "sub_status" in e.data) return e.data.sub_status ? <>Sub-status set to <b>{String(e.data.sub_status)}</b></> : "Sub-status cleared";
      if (e.data && "next_followup" in e.data) return <>Follow-up moved to <b>{fmtDateTime(String(e.data.next_followup))}</b>{e.data.from_next_followup ? ` (was ${fmtDateTime(String(e.data.from_next_followup))})` : ""}</>;
      return <>Updated {Object.keys(e.data ?? {}).join(", ")}</>;
    default: return e.type;
  }
}

export function Timeline({ events }: { events: Ev[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">No history yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="text-sm">
          <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${e.is_work ? "bg-brand-500" : "bg-slate-300"}`} />
          <div className="text-slate-800">{e.lead_no ? <span className="mr-1 text-xs text-slate-500">LB-{e.lead_no}</span> : null}{describe(e)}</div>
          {e.reason && <div className="text-xs text-slate-600">Reason: {e.reason}</div>}
          <div className="text-xs text-slate-400">{e.actor} · {fmtDateTime(e.created_at)}{e.is_work ? " · counted as worked" : ""}</div>
        </li>
      ))}
    </ol>
  );
}

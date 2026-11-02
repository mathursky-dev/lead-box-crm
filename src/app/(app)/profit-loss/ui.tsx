"use client";
import { useState } from "react";
import { ActionForm, ActionButton, Submit } from "@/components/ui";
import { Icon } from "@/components/kit";
import { savePlEntry, deletePlEntry, syncMetaNow } from "@/lib/actions/profit-loss";

type Src = { id: string; name: string };
export type Row = { id: string; kind: "ad_cost" | "sale"; entry_date: string; amount: number; channel: string; source_id: string | null; note: string;
  origin: string; ext_name: string | null; currency: string | null; source: string; day: string };

const CHANNEL: Record<string, string> = { meta: "Meta (Facebook / Instagram)", google: "Google Ads", other: "Other" };
const inr = (v: number, cur?: string | null) => new Intl.NumberFormat("en-IN", { style: "currency", currency: cur || "INR", maximumFractionDigits: 0 }).format(v);

function Fields({ sources, e, defaultDate }: { sources: Src[]; e?: Row; defaultDate: string }) {
  const [kind, setKind] = useState<string>(e?.kind ?? "ad_cost");
  return (
    <>
      {e && <input type="hidden" name="id" value={e.id} />}
      <select className="input h-9" name="kind" value={kind} onChange={(x) => setKind(x.target.value)} aria-label="Type">
        <option value="ad_cost">Ad cost</option><option value="sale">Sale</option>
      </select>
      <input className="input h-9" type="date" name="entry_date" defaultValue={e?.entry_date ?? defaultDate} required aria-label="Date" />
      <input className="input h-9" type="number" name="amount" min="0" step="0.01" placeholder="Amount ₹" defaultValue={e?.amount ?? ""} required aria-label="Amount" />
      {kind === "ad_cost" && (
        <select className="input h-9" name="channel" defaultValue={e?.channel ?? "meta"} aria-label="Channel">
          {Object.entries(CHANNEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
      <select className="input h-9" name="source_id" defaultValue={e?.source_id ?? ""} aria-label="Lead source">
        <option value="">No source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input className="input h-9 sm:col-span-2" name="note" maxLength={500} placeholder="Note (campaign, invoice no…)" defaultValue={e?.note ?? ""} aria-label="Note" />
    </>
  );
}

export function EntryForm({ sources, defaultDate }: { sources: Src[]; defaultDate: string }) {
  return (
    <ActionForm action={savePlEntry} resetOnOk className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4 lg:grid-cols-8">
      <Fields sources={sources} defaultDate={defaultDate} />
      <Submit className="btn-primary h-9" pendingText="Adding…"><Icon name="plus" className="h-4 w-4" />Add</Submit>
    </ActionForm>
  );
}

export function EntryRow({ e, sources }: { e: Row; sources: Src[] }) {
  const [edit, setEdit] = useState(false);
  const meta = e.origin === "meta";
  if (edit) {
    return (
      <tr><td className="td" colSpan={7}>
        <ActionForm action={savePlEntry} onOk={() => setEdit(false)} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Fields sources={sources} e={e} defaultDate={e.entry_date} />
          <div className="flex gap-1"><Submit className="btn-primary h-9 flex-1">Save</Submit><button type="button" className="btn-ghost h-9" onClick={() => setEdit(false)}>Cancel</button></div>
        </ActionForm>
      </td></tr>
    );
  }
  return (
    <tr>
      <td className="td whitespace-nowrap">{e.day}</td>
      <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.kind === "sale" ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-800"}`}>{e.kind === "sale" ? "Sale" : "Ad cost"}</span></td>
      <td className="td">{e.kind === "sale" ? "—" : meta ? <span className="flex items-center gap-1"><Icon name="facebook" className="h-3.5 w-3.5 text-[#1877F2]" />{e.ext_name || "Meta ad account"} <span className="text-xs text-slate-400">auto</span></span> : CHANNEL[e.channel] ?? e.channel}</td>
      <td className="td">{e.source}</td>
      <td className="td max-w-56 truncate text-slate-600" title={e.note}>{e.note || "—"}</td>
      <td className="td text-right font-medium">{inr(Number(e.amount), meta ? e.currency : "INR")}</td>
      <td className="td whitespace-nowrap text-right">
        {!meta && (
          <span className="inline-flex gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(true)} aria-label="Edit"><Icon name="pencil" className="h-3.5 w-3.5" /></button>
            <ActionButton action={() => deletePlEntry(e.id)} confirm="Delete this entry?" className="btn-ghost btn-sm text-red-600"><Icon name="trash" className="h-3.5 w-3.5" /></ActionButton>
          </span>
        )}
      </td>
    </tr>
  );
}

export function SyncButton({ from, to }: { from: string; to: string }) {
  return (
    <ActionButton action={() => syncMetaNow(from, to)} className="btn-ghost btn-sm border border-slate-200">
      <Icon name="refresh" className="h-3.5 w-3.5" />Pull Meta spend now
    </ActionButton>
  );
}

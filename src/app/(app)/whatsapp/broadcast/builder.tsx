"use client";
import { useState } from "react";
import Link from "next/link";
import { BroadcastForm } from "@/components/broadcast-form";
import type { BroadcastRules } from "@/lib/actions/broadcast";
import { SMART, SMART_KEYS, type SmartKey } from "@/lib/segments";
import { Panel } from "../ui";

type O = { id: string; name: string };
const CLOSED = new Set(["won", "lost", "invalid"]);

function Chips({ label, opts, value, onChange }: { label: string; opts: (O & { hint?: string })[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!opts.length) return null;
  const on = new Set(value);
  return (
    <fieldset>
      <legend className="label">{label} <span className="font-normal text-slate-400">{value.length ? `(${value.length})` : "· any"}</span></legend>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
        {opts.map((o) => (
          <button key={o.id} type="button" aria-pressed={on.has(o.id)} title={o.hint}
            onClick={() => onChange(on.has(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`rounded-full border px-2.5 py-1 text-xs ${on.has(o.id) ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {o.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function BroadcastBuilder({ statuses, subStatuses, tags, sources, products, owners, smart = [] }: {
  statuses: (O & { category: string })[]; subStatuses: (O & { status_id: string | null })[]; tags: O[]; sources: O[]; products: O[]; owners: O[]; smart?: SmartKey[];
}) {
  const [r, setR] = useState<BroadcastRules>({ smart, status_ids: [], sub_status_ids: [], tag_ids: [], source_ids: [], product_ids: [], owner_ids: [], include_closed: false, created_within_days: "" });
  const set = (k: keyof BroadcastRules) => (v: unknown) => setR((x) => ({ ...x, [k]: v }));
  const pickedClosed = (r.status_ids ?? []).some((id) => CLOSED.has(statuses.find((s) => s.id === id)?.category ?? ""));
  const subs = subStatuses.filter((s) => !s.status_id || !(r.status_ids ?? []).length || (r.status_ids ?? []).includes(s.status_id));
  // Picking a Won/Lost/Invalid status means closed leads are wanted.
  const rules: BroadcastRules = { ...r, include_closed: r.include_closed || pickedClosed };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Panel title="1. Who should get it" icon="filter">
        <div className="space-y-3">
          <Chips label="Customer group" opts={SMART_KEYS.map((k) => ({ id: k, name: SMART[k].label }))} value={r.smart ?? []} onChange={set("smart")} />
          {(r.smart ?? []).length > 0 && <p className="-mt-1 text-[11px] text-slate-500">Groups are automatic (see <Link className="text-brand-700 hover:underline" href="/whatsapp/segments">Segments</Link>). Won and lost leads are included for these customers.</p>}
          <Chips label="Lead status" opts={statuses} value={r.status_ids ?? []} onChange={set("status_ids")} />
          <Chips label="Sub-status" opts={subs} value={r.sub_status_ids ?? []} onChange={set("sub_status_ids")} />
          <Chips label="Tag" opts={tags} value={r.tag_ids ?? []} onChange={set("tag_ids")} />
          <Chips label="Source" opts={sources} value={r.source_ids ?? []} onChange={set("source_ids")} />
          <Chips label="Product" opts={products} value={r.product_ids ?? []} onChange={set("product_ids")} />
          <Chips label="Owner" opts={owners} value={r.owner_ids ?? []} onChange={set("owner_ids")} />
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="block"><span className="label">Created in last (days)</span>
              <input className="input w-28" type="number" min={1} max={3650} value={r.created_within_days ?? ""} onChange={(e) => set("created_within_days")(e.target.value)} /></label>
            <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={!!rules.include_closed} disabled={pickedClosed} onChange={(e) => set("include_closed")(e.target.checked)} /> Include closed leads (won / lost / invalid)</label>
          </div>
          <p className="text-xs text-slate-500">Inside a group any choice matches; across groups all must match. Leave a group empty for “any”.</p>
        </div>
      </Panel>
      <Panel title="2. Message" icon="send">
        <BroadcastForm audience={{ rules }} />
      </Panel>
    </div>
  );
}

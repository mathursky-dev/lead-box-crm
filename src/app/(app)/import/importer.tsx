"use client";
import { useState } from "react";
import Papa from "papaparse";
import { previewImport, runImport, type ImportField, type PreviewRow } from "@/lib/actions/import";

const FIELDS: [ImportField, string, RegExp][] = [
  ["phone", "Mobile/WhatsApp *", /phone|mobile|whats|contact|number/i], ["name", "Customer name", /name/i], ["email", "Email", /mail/i],
  ["location", "Location", /location|city|address/i], ["product", "Product/Service", /product|service/i], ["source", "Source", /source/i],
  ["branch", "Branch", /branch/i], ["department", "Department", /dep/i], ["owner_email", "Owner email", /owner|agent|assign/i],
  ["priority", "Priority", /priority/i], ["expected_value", "Expected value", /value|amount|budget/i], ["notes", "Notes", /note|remark|comment/i], ["tags", "Tags", /tag/i],
];
const STATUS_STYLE: Record<string, string> = { new: "bg-brand-100 text-brand-700", duplicate: "bg-amber-50 text-amber-700", duplicate_in_file: "bg-amber-50 text-amber-700", invalid: "bg-red-50 text-red-700" };

export function Importer() {
  const [file, setFile] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Partial<Record<ImportField, string>>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [dupMode, setDupMode] = useState<"skip" | "repeat">("skip");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runImport>> | null>(null);

  const mapped = () => data.map((r) => Object.fromEntries(FIELDS.filter(([f]) => map[f]).map(([f]) => [f, (r[map[f]!] ?? "").toString()])));

  const onFile = (f: File) => {
    setErr(undefined); setPreview(null); setResult(null); setFile(f.name);
    Papa.parse<Record<string, string>>(f, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        if (!hs.length) { setErr("No header row found."); return; }
        setHeaders(hs); setData(res.data);
        const guess: Partial<Record<ImportField, string>> = {};
        const used = new Set<string>();
        for (const [f, , re] of FIELDS) { const h = hs.find((x) => re.test(x) && !used.has(x)); if (h) { guess[f] = h; used.add(h); } }
        setMap(guess);
      },
      error: (e) => setErr(e.message),
    });
  };

  const counts = preview?.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <p className="mt-2 text-xs text-slate-500">UTF-8 CSV with a header row, up to 2000 rows. Indian numbers may omit +91.</p>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      {headers.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Column mapping · {file} · {data.length} rows</h2>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {FIELDS.map(([f, label]) => (
              <label key={f} className="block"><span className="label">{label}</span>
                <select className="input" value={map[f] ?? ""} onChange={(e) => { setMap((m) => ({ ...m, [f]: e.target.value || undefined })); setPreview(null); }}>
                  <option value="">— not imported —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button className="btn-navy mt-3" disabled={!map.phone || busy} onClick={async () => {
            setBusy(true); setErr(undefined);
            const r = await previewImport(mapped());
            setBusy(false);
            if (r.error) setErr(r.error); else setPreview(r.rows!);
          }}>{busy ? "Checking…" : "Validate & preview"}</button>
        </div>
      )}

      {preview && !result && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="badge bg-brand-100 text-brand-700">{counts?.new ?? 0} new</span>
            <span className="badge bg-amber-50 text-amber-700">{counts?.duplicate ?? 0} already in CRM</span>
            <span className="badge bg-amber-50 text-amber-700">{counts?.duplicate_in_file ?? 0} repeated in file</span>
            <span className="badge bg-red-50 text-red-700">{counts?.invalid ?? 0} invalid</span>
          </div>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50"><tr><th className="th">Row</th><th className="th">Phone</th><th className="th">Name</th><th className="th">Result</th><th className="th">Detail</th></tr></thead>
              <tbody className="divide-y">{preview.map((r) => (
                <tr key={r.row}><td className="td">{r.row}</td><td className="td">{r.phone}</td><td className="td">{r.name}</td>
                  <td className="td"><span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status.replace(/_/g, " ")}</span></td><td className="td text-xs">{r.reason ?? r.existing}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1"><input type="radio" checked={dupMode === "skip"} onChange={() => setDupMode("skip")} /> Skip numbers already in CRM</label>
            <label className="flex items-center gap-1"><input type="radio" checked={dupMode === "repeat"} onChange={() => setDupMode("repeat")} /> Create repeat opportunities for them</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-allocate rows without an owner</label>
          </div>
          <button className="btn-primary mt-3" disabled={busy || !((counts?.new ?? 0) + (dupMode === "repeat" ? counts?.duplicate ?? 0 : 0))} onClick={async () => {
            if (!confirm("Import now? This creates leads and cannot be undone automatically.")) return;
            setBusy(true); setErr(undefined);
            const r = await runImport(mapped(), { filename: file, duplicates: dupMode, autoAllocate: auto });
            setBusy(false);
            if ("error" in r && r.error) setErr(r.error); else setResult(r);
          }}>{busy ? "Importing…" : "Import"}</button>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        </div>
      )}

      {result && "summary" in result && result.summary && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Import summary</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="badge bg-brand-100 text-brand-700">{result.summary.created} created</span>
            <span className="badge bg-sky-50 text-sky-700">{result.summary.created_repeat} repeat opportunities</span>
            <span className="badge bg-amber-50 text-amber-700">{result.summary.skipped_duplicate} duplicates skipped</span>
            <span className="badge bg-red-50 text-red-700">{result.summary.errors} errors</span>
          </div>
          {result.results!.some((r) => r.result === "error") && (
            <ul className="mt-3 max-h-60 overflow-auto text-xs text-red-700">{result.results!.filter((r) => r.result === "error").map((r) => <li key={r.row}>Row {r.row}: {r.detail}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

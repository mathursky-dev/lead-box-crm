"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { startDocUpload, createDocument, updateDocument, deleteDocuments, documentLinks, type Doc } from "@/lib/actions/documents";
import { Modal } from "@/components/ui";
import { Icon } from "@/components/kit";
import { fmtDay } from "@/lib/dates";

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Browser → storage upload through a signed URL (server functions cap request bodies at ~4.5 MB). */
async function uploadFile(f: File): Promise<{ path?: string; error?: string }> {
  const s = await startDocUpload(f.name, f.size);
  if (s.error || !s.path || !s.token) return { error: s.error ?? "Upload failed" };
  const up = await getBrowserClient().storage.from("lb-docs").uploadToSignedUrl(s.path, s.token, f, { contentType: f.type || "application/octet-stream" });
  if (up.error) return { error: /size|large|413/i.test(up.error.message) ? `File is too big for storage (${fileSize(f.size)}).` : `Upload failed: ${up.error.message}` };
  return { path: s.path };
}

function saveAs(url: string) {
  const a = document.createElement("a");
  a.href = url; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
}

type Props = {
  docs: Doc[]; total: number; page: number; size: number; sizes: number[]; q: string; error?: string;
  users: Record<string, string>; meId: string; admin: boolean;
};

export function DocumentsTable({ docs, total, page, size, sizes, q, error, users, meId, admin }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Doc | "new" | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string; id: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState<string | undefined>(error);
  const [search, setSearch] = useState(q);
  const pages = Math.max(1, Math.ceil(total / size));
  const canEdit = (d: Doc) => admin || d.created_by === meId;

  useEffect(() => setSel(new Set()), [docs]);
  useEffect(() => setSearch(q), [q]);
  // Search as you type (debounced); resets to page 1.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => start(() => router.replace(href({ q: search, page: 1 }))), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  function href(p: { q?: string; page?: number; size?: number }) {
    const u = new URLSearchParams();
    const qq = p.q ?? q, pg = p.page ?? page, sz = p.size ?? size;
    if (qq) u.set("q", qq);
    if (pg > 1) u.set("page", String(pg));
    if (sz !== 20) u.set("size", String(sz));
    const s = u.toString();
    return `/documents${s ? `?${s}` : ""}`;
  }

  const allOn = docs.length > 0 && docs.every((d) => sel.has(d.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function download(ids: string[]) {
    setMsg(undefined);
    const r = await documentLinks(ids, true);
    if (r.error || !r.links) { setMsg(r.error); return; }
    for (const [i, l] of r.links.entries()) setTimeout(() => saveAs(l.url), i * 400);
  }
  async function open(d: Doc) {
    setMsg(undefined);
    const r = await documentLinks([d.id], false);
    if (r.error || !r.links?.[0]) { setMsg(r.error); return; }
    setPreview(r.links[0]);
  }
  async function remove(ids: string[]) {
    if (!confirm(ids.length === 1 ? "Delete this document?" : `Delete ${ids.length} documents?`)) return;
    const r = await deleteDocuments(ids);
    setMsg(r.error);
    router.refresh();
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
        <h2 className="mr-auto text-base font-semibold text-navy-900">Documents</h2>
        <button className="btn-primary btn-sm" onClick={() => setEdit("new")}><Icon name="plus" className="h-4 w-4" /> Add</button>
        <div className="relative">
          <button className="btn btn-sm border border-slate-300 bg-white disabled:opacity-50" disabled={!sel.size} onClick={() => setMenu((m) => !m)}>
            Actions{sel.size ? ` (${sel.size})` : ""} <Icon name="chevronDown" className="h-3.5 w-3.5" />
          </button>
          {menu && sel.size > 0 && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
              <button className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setMenu(false); download([...sel]); }}>Download selected</button>
              <button className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => { setMenu(false); remove([...sel]); }}>Delete selected</button>
            </div>
          )}
        </div>
        <button className="btn btn-sm border border-slate-300 bg-white" title="Refresh" onClick={() => start(() => router.refresh())}>
          <Icon name="refresh" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        </button>
        <input className="input h-9 w-full sm:w-64" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {msg && <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">{msg}</div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-white">
            <tr>
              <th className="th w-10"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(docs.map((d) => d.id)))} /></th>
              <th className="th">Description</th><th className="th">File Name</th><th className="th">Size</th><th className="th">Created On</th><th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {docs.map((d) => (
              <tr key={d.id} className={sel.has(d.id) ? "bg-brand-50/50" : "hover:bg-slate-50"}>
                <td className="td"><input type="checkbox" aria-label={`Select ${d.file_name}`} checked={sel.has(d.id)} onChange={() => toggle(d.id)} /></td>
                <td className="td max-w-xs whitespace-pre-wrap font-medium text-navy-900">{d.description || <span className="text-slate-400">—</span>}</td>
                <td className="td max-w-sm break-all">{d.file_name}</td>
                <td className="td whitespace-nowrap text-slate-500">{fileSize(Number(d.size))}</td>
                <td className="td whitespace-nowrap" title={d.created_by ? `Added by ${users[d.created_by] ?? "a former user"}` : undefined}>{fmtDay(d.created_at)}</td>
                <td className="td">
                  <div className="flex justify-end gap-1.5">
                    {canEdit(d) && <IconBtn icon="pencil" title="Edit" tone="bg-sky-500" onClick={() => setEdit(d)} />}
                    <IconBtn icon="download" title="Download" tone="bg-violet-600" onClick={() => download([d.id])} />
                    <IconBtn icon="eye" title="Preview" tone="bg-teal-500" onClick={() => open(d)} />
                    {canEdit(d) && <IconBtn icon="trash" title="Delete" tone="bg-red-500" onClick={() => remove([d.id])} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {q ? <>No documents match “{q}”.</> : <>No documents yet. Click <b>Add</b> to upload your first catalogue or brochure.</>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm">
        <span>{total} Document{total === 1 ? "" : "s"} | Show</span>
        <select className="input h-8 w-20 py-0" value={size} onChange={(e) => router.push(href({ size: Number(e.target.value), page: 1 }))}>
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span>rows per page</span>
        <nav className="ml-auto flex items-center gap-1" aria-label="Pages">
          <PageLink to={href({ page: 1 })} off={page <= 1}>«</PageLink>
          <PageLink to={href({ page: page - 1 })} off={page <= 1}>‹</PageLink>
          {pageList(page, pages).map((p, i) => p === 0 ? <span key={`g${i}`} className="px-1 text-slate-400">…</span> : (
            <Link key={p} href={href({ page: p })} className={`grid h-8 min-w-8 place-items-center rounded-md px-2 ${p === page ? "bg-brand-600 font-semibold text-white" : "hover:bg-slate-100"}`}>{p}</Link>
          ))}
          <PageLink to={href({ page: page + 1 })} off={page >= pages}>›</PageLink>
          <PageLink to={href({ page: pages })} off={page >= pages}>»</PageLink>
        </nav>
      </div>

      <EditModal doc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); router.refresh(); }} />
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? "Preview"} wide>
        {preview && <Preview {...preview} onDownload={() => download([preview.id])} />}
      </Modal>
    </div>
  );
}

function pageList(page: number, pages: number): number[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: number[] = [];
  [...set].sort((a, b) => a - b).forEach((p, i, arr) => { if (i && p - arr[i - 1] > 1) out.push(0); out.push(p); });
  return out;
}

function PageLink({ to, off, children }: { to: string; off: boolean; children: React.ReactNode }) {
  return off ? <span className="grid h-8 w-8 place-items-center text-slate-300">{children}</span>
    : <Link href={to} className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100">{children}</Link>;
}

function IconBtn({ icon, title, tone, onClick }: { icon: string; title: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`grid h-7 w-7 place-items-center rounded-full text-white shadow-sm hover:opacity-90 ${tone}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

export function Preview({ url, name, mime, onDownload }: { url: string; name: string; mime: string; onDownload: () => void }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  let body: React.ReactNode;
  if (mime.startsWith("image/")) body = <img src={url} alt={name} className="mx-auto max-h-[70vh] rounded object-contain" />; // eslint-disable-line @next/next/no-img-element
  else if (mime === "application/pdf" || ext === "pdf" || mime.startsWith("text/")) body = <iframe src={url} title={name} className="h-[70vh] w-full rounded border" />;
  else if (mime.startsWith("video/")) body = <video src={url} controls className="mx-auto max-h-[70vh] w-full rounded" />;
  else if (mime.startsWith("audio/")) body = <audio src={url} controls className="w-full" />;
  else body = <p className="py-8 text-center text-sm text-slate-500">This file type can’t be previewed in the browser. Download it to open.</p>;
  return (
    <div className="space-y-3">
      {body}
      <div className="flex justify-end gap-2">
        <a className="btn btn-sm border border-slate-300" href={url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
        <button className="btn-primary btn-sm" onClick={onDownload}>Download</button>
      </div>
    </div>
  );
}

function EditModal({ doc, onClose, onSaved }: { doc: Doc | "new" | null; onClose: () => void; onSaved: () => void }) {
  const isNew = doc === "new";
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setDesc(doc && doc !== "new" ? doc.description : ""); setFile(null); setErr(undefined); setBusy(null); }, [doc]);

  async function save() {
    if (isNew && !file) { setErr("Choose a file to upload."); return; }
    setErr(undefined);
    try {
      let path: string | undefined;
      if (file) {
        setBusy(`Uploading ${file.name} (${fileSize(file.size)})…`);
        const u = await uploadFile(file);
        if (u.error || !u.path) { setErr(u.error); return; }
        path = u.path;
      }
      setBusy("Saving…");
      const r = isNew ? await createDocument(path!, desc) : await updateDocument((doc as Doc).id, desc, path);
      if (r.error) { setErr(r.error); return; }
      onSaved();
    } catch (e) {
      setErr(`Upload failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally { setBusy(null); }
  }

  return (
    <Modal open={!!doc} onClose={() => !busy && onClose()} title={isNew ? "Add document" : "Edit document"}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">Description
          <textarea className="input mt-1" rows={2} maxLength={300} placeholder="e.g. New home decor catalogue – Sep 2026" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <div>
          <div className="text-sm font-medium text-slate-700">{isNew ? "File" : "Replace file (optional)"}</div>
          {!isNew && doc && !file && <div className="mt-1 text-xs text-slate-500">Current: {(doc as Doc).file_name}</div>}
          <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-4 text-left text-sm text-slate-600 hover:border-brand-400"
            onClick={() => ref.current?.click()} disabled={!!busy}>
            <Icon name="upload" className="h-5 w-5 text-slate-400" />
            {file ? <span className="min-w-0 break-all"><b>{file.name}</b> · {fileSize(file.size)}</span> : <span>Choose a file (PDF, image, video, Excel…)</span>}
          </button>
          <input ref={ref} type="file" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </div>
        {busy && <p className="text-sm text-slate-600">{busy}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-sm border border-slate-300" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={save} disabled={!!busy || (isNew && !file)}>{busy ? "Please wait…" : isNew ? "Upload" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}

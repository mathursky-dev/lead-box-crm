"use client";
// Offline outbox for the field app. Entries (check-in, visit, expense, lead, note) are
// written to IndexedDB on the phone first, then sent to /api/field/sync one by one,
// oldest first, whenever there is network. Every entry has a client_id, so a retried
// send never makes a second copy on the server.
import type { QueueItem } from "@/lib/field";

const DB = "leadbox-offline";
const VERSION = 1;
export const QUEUE_EVENT = "lb-queue";

export type QueueEntry = {
  id: string;
  userId: string;
  item: QueueItem;
  hasFile: boolean;
  createdAt: number;
  attempts: number;
  /** Server refused it (validation, permission). Shown to the user; not retried automatically. */
  error?: string;
};

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser cannot save offline"));
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "id" });
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let out: T | undefined;
    const req = fn(t);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_EVENT)); };

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for very old WebViews.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export async function enqueue(userId: string, item: QueueItem, file?: Blob | null) {
  const entry: QueueEntry = { id: `${item.kind}:${item.client_id}`, userId, item, hasFile: !!file, createdAt: Date.now(), attempts: 0 };
  await tx(["queue", "files"], "readwrite", (t) => {
    t.objectStore("queue").put(entry);
    if (file) t.objectStore("files").put(file, entry.id);
  });
  changed();
  return entry;
}

export async function listQueue(userId: string): Promise<QueueEntry[]> {
  const all = ((await tx<QueueEntry[]>(["queue"], "readonly", (t) => t.objectStore("queue").getAll())) ?? []);
  return all.filter((e) => e.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeEntry(id: string) {
  await tx(["queue", "files"], "readwrite", (t) => { t.objectStore("queue").delete(id); t.objectStore("files").delete(id); });
  changed();
}

async function putEntry(e: QueueEntry) {
  await tx(["queue"], "readwrite", (t) => { t.objectStore("queue").put(e); });
  changed();
}

export async function retryEntry(id: string) {
  const e = await tx<QueueEntry>(["queue"], "readonly", (t) => t.objectStore("queue").get(id));
  if (e) await putEntry({ ...e, error: undefined });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try { return await tx<T>(["kv"], "readonly", (t) => t.objectStore("kv").get(key)); } catch { return undefined; }
}
export async function kvSet(key: string, value: unknown) {
  try { await tx(["kv"], "readwrite", (t) => { t.objectStore("kv").put(value, key); }); } catch { /* storage full / private mode */ }
}

/** Sign-out: forget the cached leads and pages on this phone. Unsent entries stay (they belong
 *  to that user and are sent only after the same user signs in again). */
export async function clearOfflineData() {
  try { await tx(["kv"], "readwrite", (t) => { t.objectStore("kv").clear(); }); } catch { /* ignore */ }
  try { if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("lb-")) await caches.delete(k); } catch { /* ignore */ }
}

export type FlushResult = { sent: number; failed: number; left: number; signedOut?: boolean; offline?: boolean };
export type SyncReply = { ok: boolean; error?: string; message?: string };

let running: Promise<FlushResult> | null = null;

/** Send waiting entries, oldest first. Stops at the first network problem (keeps order). */
export function flushQueue(userId: string): Promise<FlushResult> {
  running ??= (async () => {
    const run = async (): Promise<FlushResult> => {
      const r: FlushResult = { sent: 0, failed: 0, left: 0 };
      const list = await listQueue(userId);
      for (const e of list) {
        if (e.error) { r.failed++; continue; }
        if (typeof navigator !== "undefined" && navigator.onLine === false) { r.offline = true; break; }
        const fd = new FormData();
        fd.set("item", JSON.stringify(e.item));
        if (e.hasFile) {
          const f = await tx<Blob>(["files"], "readonly", (t) => t.objectStore("files").get(e.id));
          if (f) fd.set("file", f, "upload" + (f.type === "application/pdf" ? ".pdf" : ".jpg"));
        }
        let res: Response;
        try {
          res = await fetch("/api/field/sync", { method: "POST", body: fd, credentials: "same-origin", cache: "no-store" });
        } catch { r.offline = true; break; }
        if (res.status === 401) { r.signedOut = true; break; }
        if (res.status >= 500 || res.status === 429 || res.status === 408) { await putEntry({ ...e, attempts: e.attempts + 1 }); break; }
        const body = (await res.json().catch(() => ({ ok: false, error: "Unexpected reply from server" }))) as SyncReply;
        if (body.ok) { await removeEntry(e.id); r.sent++; }
        else { await putEntry({ ...e, attempts: e.attempts + 1, error: body.error ?? "Could not save" }); r.failed++; }
      }
      r.left = (await listQueue(userId)).length;
      return r;
    };
    // One sender at a time, also across tabs where the browser supports it.
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    try {
      return locks ? await locks.request("lb-field-sync", run) : await run();
    } catch {
      return { sent: 0, failed: 0, left: 0, offline: true };
    }
  })().finally(() => { running = null; });
  return running;
}

/** Location from the phone GPS (works without internet). Null when refused or unavailable. */
export function getGeo(timeout = 12000): Promise<{ lat: number; lng: number; acc: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), acc: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

/** Shrink a photo to max 1600px JPEG (~200-500 KB) before saving it on the phone. PDFs pass through. */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.8));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

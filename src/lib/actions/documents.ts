"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { enqueue, mediaKind, MAX_MB } from "@/lib/inbox-send";

// Company document library. Files sit in the private "lb-docs" bucket at {company_id}/{uuid}-{name}.
// Super admins can read every company's rows through RLS, so every query here filters by the
// caller's own company_id explicitly.

const BUCKET = "lb-docs";
const MB = 1024 * 1024;
type Result = { error?: string; ok?: boolean };

export type Doc = { id: string; description: string; file_name: string; mime: string; size: number; created_at: string; created_by: string | null };
const COLS = "id,description,file_name,mime,size,created_at,created_by";

const cleanName = (n: string) => String(n).replace(/[^\w.\- ()&]/g, "_").slice(-120) || "file";
const cleanDesc = (d: unknown) => String(d ?? "").trim().slice(0, 300);

/** Step 1 of an upload: a one-time signed URL so the browser sends the file straight to storage. */
export async function startDocUpload(name: string, size: number): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await requireProfile();
  if (!Number.isFinite(size) || size <= 0) return { error: "File is empty" };
  if (size > MAX_MB * MB) return { error: `File is too big. The limit is ${MAX_MB} MB.` };
  if (!hasServiceRole()) return { error: "Uploads need the server to be configured (service role key)." };
  const path = `${profile.company_id}/${randomUUID()}-${cleanName(name)}`;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: `Upload failed: ${error?.message ?? "no upload URL"}` };
  return { path: data.path, token: data.token };
}

/** Checks an uploaded object is in the caller's company folder and within the size limit. */
async function uploaded(companyId: string, path: string) {
  if (!path.startsWith(`${companyId}/`) || path.includes("..") || path.split("/").length !== 2) return { error: "Invalid upload" };
  const st = createAdminClient().storage.from(BUCKET);
  const { data: info, error } = await st.info(path);
  if (error || !info) return { error: "Upload not found. Please choose the file again." };
  const size = Number(info.size ?? info.metadata?.size ?? 0);
  if (size > MAX_MB * MB) { await st.remove([path]); return { error: `File is too big. The limit is ${MAX_MB} MB.` }; }
  const mime = String(info.contentType ?? info.metadata?.mimetype ?? "") || "application/octet-stream";
  return { size, mime, file_name: path.split("/")[1].replace(/^[0-9a-f-]{36}-/, "") };
}

/** Step 2: save the document row (new document). */
export async function createDocument(path: string, description: string): Promise<Result> {
  const { profile } = await requireProfile();
  const f = await uploaded(profile.company_id, String(path));
  if ("error" in f) return { error: f.error };
  const { error } = await createAdminClient().from("lb_documents").insert({
    company_id: profile.company_id, description: cleanDesc(description), file_name: f.file_name, path, mime: f.mime, size: f.size, created_by: profile.id,
  });
  if (error) { await createAdminClient().storage.from(BUCKET).remove([path]); return { error: errMsg(error) }; }
  revalidatePath("/documents");
  return { ok: true };
}

async function ownDoc(id: string) {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid document" } as const;
  const { data } = await createAdminClient().from("lb_documents").select("id,path,created_by,file_name").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!data) return { error: "Document not found" } as const;
  return { profile, doc: data, canEdit: isAdmin(profile) || data.created_by === profile.id };
}

/** Edit the description and, optionally, replace the file (newPath from startDocUpload). */
export async function updateDocument(id: string, description: string, newPath?: string): Promise<Result> {
  const o = await ownDoc(id);
  if ("error" in o) return { error: o.error };
  if (!o.canEdit) return { error: "Only the person who added it or an admin can edit this document." };
  const patch: Record<string, unknown> = { description: cleanDesc(description), updated_at: new Date().toISOString() };
  if (newPath) {
    const f = await uploaded(o.profile.company_id, newPath);
    if ("error" in f) return { error: f.error };
    Object.assign(patch, { path: newPath, file_name: f.file_name, mime: f.mime, size: f.size });
  }
  const { error } = await createAdminClient().from("lb_documents").update(patch).eq("id", id).eq("company_id", o.profile.company_id);
  if (error) return { error: errMsg(error) };
  if (newPath && newPath !== o.doc.path) await createAdminClient().storage.from(BUCKET).remove([o.doc.path]);
  revalidatePath("/documents");
  return { ok: true };
}

export async function deleteDocuments(ids: string[]): Promise<Result & { deleted?: number }> {
  const { profile } = await requireProfile();
  const list = ids.filter((i) => z.uuid().safeParse(i).success).slice(0, 200);
  if (!list.length) return { error: "Nothing selected" };
  let q = createAdminClient().from("lb_documents").select("id,path").in("id", list).eq("company_id", profile.company_id);
  if (!isAdmin(profile)) q = q.eq("created_by", profile.id);
  const { data } = await q;
  if (!data?.length) return { error: "Only the person who added a document or an admin can delete it." };
  const { error } = await createAdminClient().from("lb_documents").delete().in("id", data.map((d) => d.id)).eq("company_id", profile.company_id);
  if (error) return { error: errMsg(error) };
  await createAdminClient().storage.from(BUCKET).remove(data.map((d) => d.path));
  revalidatePath("/documents");
  const skipped = list.length - data.length;
  return { ok: true, deleted: data.length, error: skipped ? `${skipped} document(s) were added by someone else and were not deleted.` : undefined };
}

/** Short-lived links for preview (inline) or download (attachment). */
export async function documentLinks(ids: string[], download: boolean): Promise<{ error?: string; links?: { id: string; url: string; name: string; mime: string }[] }> {
  const { profile } = await requireProfile();
  const list = ids.filter((i) => z.uuid().safeParse(i).success).slice(0, 50);
  const { data } = await createAdminClient().from("lb_documents").select("id,path,file_name,mime").in("id", list).eq("company_id", profile.company_id);
  if (!data?.length) return { error: "Document not found" };
  const links = [];
  for (const d of data) {
    const { data: s, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(d.path, 600, download ? { download: d.file_name } : undefined);
    if (error || !s) return { error: `Could not open ${d.file_name}: ${error?.message ?? "no link"}` };
    links.push({ id: d.id, url: s.signedUrl, name: d.file_name, mime: d.mime });
  }
  return { links };
}

/** Search for the inbox picker. */
export async function searchDocuments(q: string): Promise<{ error?: string; docs?: Doc[] }> {
  const { profile } = await requireProfile();
  let qy = (await createClient()).from("lb_documents").select(COLS).eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(50);
  const term = q.replace(/[%_,()\\]/g, " ").trim().slice(0, 80);
  if (term) qy = qy.or(`description.ilike.%${term}%,file_name.ilike.%${term}%`);
  const { data, error } = await qy;
  if (error) return { error: errMsg(error) };
  return { docs: (data ?? []) as Doc[] };
}

/** Inbox: send a saved document to a chat without uploading it again. */
export async function sendDocumentToChat(convId: string, clientId: string, docId: string, caption: string, replyTo?: string): Promise<Result> {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(convId).success || !z.uuid().safeParse(docId).success || !z.uuid().safeParse(clientId).success) return { error: "Invalid request" };
  if (!hasServiceRole()) return { error: "Sending files needs the server to be configured (service role key)." };
  const { data: conv } = await (await createClient()).from("lb_conversations").select("id,company_id").eq("id", convId).maybeSingle();
  if (!conv) return { error: "Conversation not found" };
  if (conv.company_id !== profile.company_id) return { error: "This document library belongs to another company." };
  const { data: doc } = await createAdminClient().from("lb_documents").select("path,file_name,mime,size").eq("id", docId).eq("company_id", conv.company_id).maybeSingle();
  if (!doc) return { error: "Document not found" };
  // Copy into the chat's media folder so the message keeps working if the document is later edited or deleted.
  const dest = `${conv.company_id}/${conv.id}/${randomUUID()}-${cleanName(doc.file_name)}`;
  const { error } = await createAdminClient().storage.from(BUCKET).copy(doc.path, dest, { destinationBucket: "lb-media" });
  if (error) return { error: `Could not attach the document: ${error.message}` };
  return enqueue(convId, clientId, {
    type: mediaKind(doc.mime, Number(doc.size)), media_path: dest, media_mime: doc.mime, media_filename: doc.file_name,
    body: String(caption ?? "").trim().slice(0, 1024) || null, reply_to: z.uuid().safeParse(replyTo).data ?? null,
  });
}

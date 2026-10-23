"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, errMsg } from "@/lib/util";
import { fbAccount, fbApp } from "@/lib/facebook";
import { graph } from "@/lib/whatsapp";
import { fmtDateTime } from "@/lib/dates";

type FormState = { error?: string; ok?: string } | undefined;
export type FbAd = { id: string; name: string; status?: string };
export type TestResult = { error?: string; checks?: [string, boolean, string][] };

const ID = /^\d{3,30}$/;

async function connected() {
  const { profile: me } = await requireAdmin();
  if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) throw new Error("Server is not configured: SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY missing.");
  const acct = await fbAccount(me.company_id);
  if (!acct) throw new Error("Facebook is not connected.");
  return { me, acct, db: createAdminClient() };
}

function done(ok: string): FormState {
  revalidatePath("/admin/fb-login");
  revalidatePath("/admin/quick-setup");
  return { ok };
}

export async function setFbOnlySelected(on: boolean): Promise<FormState> {
  try {
    const { me, db } = await connected();
    const { error } = await db.from("lb_fb_accounts").update({ only_selected: on, updated_at: new Date().toISOString() }).eq("company_id", me.company_id);
    if (error) return { error: error.message };
    return done(on ? "Only selected pages and ads will be processed." : "All pages and ads will be processed.");
  } catch (e) { return { error: errMsg(e) }; }
}

export async function addFbPage(pageId: string): Promise<FormState> {
  if (!ID.test(pageId)) return { error: "Invalid page." };
  try {
    const { me, acct, db } = await connected();
    // shortcut: first 100 pages only, page through /me/accounts if an account manages more.
    const r = await graph<{ data: { id: string; name: string; access_token: string }[] }>(acct.token, "me/accounts?fields=id,name,access_token&limit=100");
    if (!r.ok) return { error: `Facebook: ${r.message}` };
    const page = r.data.data.find((x) => x.id === pageId);
    if (!page) return { error: "This Facebook account does not manage that page." };
    const { data: other } = await db.from("lb_fb_pages").select("company_id").eq("page_id", pageId).maybeSingle();
    if (other && other.company_id !== me.company_id) return { error: "This page is already connected to another company." };
    const sub = await graph(page.access_token, `${pageId}/subscribed_apps?subscribed_fields=leadgen`, { method: "POST" });
    const { error } = await db.from("lb_fb_pages").upsert({
      company_id: me.company_id, page_id: pageId, page_name: page.name, page_token_enc: encryptSecret(page.access_token), subscribed: sub.ok,
    }, { onConflict: "company_id,page_id" });
    if (error) return { error: error.message };
    if (!sub.ok) return { error: `Page saved, but subscribing it to leads failed: ${sub.message}` };
    return done(`${page.name} connected. New leads will arrive automatically.`);
  } catch (e) { return { error: errMsg(e) }; }
}

export async function setFbPageSelected(pageId: string, selected: boolean): Promise<FormState> {
  try {
    const { me, db } = await connected();
    const { error } = await db.from("lb_fb_pages").update({ is_selected: selected }).eq("company_id", me.company_id).eq("page_id", pageId);
    if (error) return { error: error.message };
    return done("Saved.");
  } catch (e) { return { error: errMsg(e) }; }
}

export async function removeFbPage(pageId: string): Promise<FormState> {
  try {
    const { me, db } = await connected();
    const { data: page } = await db.from("lb_fb_pages").select("page_token_enc").eq("company_id", me.company_id).eq("page_id", pageId).maybeSingle();
    if (!page) return { error: "Page not found." };
    if (page.page_token_enc) await graph(decryptSecret(page.page_token_enc), `${pageId}/subscribed_apps`, { method: "DELETE" }); // best-effort
    const { error } = await db.from("lb_fb_pages").delete().eq("company_id", me.company_id).eq("page_id", pageId);
    if (error) return { error: error.message };
    return done("Page removed.");
  } catch (e) { return { error: errMsg(e) }; }
}

export async function listFbAds(adAccountId: string): Promise<{ error?: string; ads?: FbAd[] }> {
  if (!/^act_\d{3,30}$/.test(adAccountId)) return { error: "Invalid ad account." };
  try {
    const { acct } = await connected();
    const r = await graph<{ data: FbAd[] }>(acct.token, `${adAccountId}/ads?fields=name,id,status&limit=200`);
    return r.ok ? { ads: r.data.data } : { error: `Facebook: ${r.message}` };
  } catch (e) { return { error: errMsg(e) }; }
}

export async function addFbAd(adAccountId: string, adAccountName: string, adId: string): Promise<FormState> {
  if (!/^act_\d{3,30}$/.test(adAccountId) || !ID.test(adId)) return { error: "Invalid ad." };
  try {
    const { me, acct, db } = await connected();
    const r = await graph<{ id: string; name: string; account_id: string }>(acct.token, `${adId}?fields=name,account_id`);
    if (!r.ok) return { error: `Facebook: ${r.message}` };
    if (`act_${r.data.account_id}` !== adAccountId) return { error: "Ad does not belong to that ad account." };
    const { error } = await db.from("lb_fb_ads").upsert({
      company_id: me.company_id, ad_account_id: adAccountId, ad_account_name: adAccountName.slice(0, 200) || null, ad_id: adId, ad_name: r.data.name,
    }, { onConflict: "company_id,ad_id" });
    if (error) return { error: error.message };
    return done(`${r.data.name} added.`);
  } catch (e) { return { error: errMsg(e) }; }
}

export async function removeFbAd(adId: string): Promise<FormState> {
  try {
    const { me, db } = await connected();
    const { error } = await db.from("lb_fb_ads").delete().eq("company_id", me.company_id).eq("ad_id", adId);
    if (error) return { error: error.message };
    return done("Ad removed.");
  } catch (e) { return { error: errMsg(e) }; }
}

export async function disconnectFacebook(): Promise<FormState> {
  try {
    const { me, acct, db } = await connected();
    const { data: pages } = await db.from("lb_fb_pages").select("page_id,page_token_enc").eq("company_id", me.company_id);
    // Best-effort cleanup on Meta's side; local rows are removed regardless.
    for (const p of pages ?? []) if (p.page_token_enc) await graph(decryptSecret(p.page_token_enc), `${p.page_id}/subscribed_apps`, { method: "DELETE" });
    await graph(acct.token, "me/permissions", { method: "DELETE" });
    for (const t of ["lb_fb_ads", "lb_fb_pages", "lb_fb_accounts"]) {
      const { error } = await db.from(t).delete().eq("company_id", me.company_id);
      if (error) return { error: error.message };
    }
    await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: "integration.facebook.disconnect", entity: "integration", entity_id: "facebook", data: { fb_user_id: acct.fb_user_id } });
    return done("Facebook disconnected.");
  } catch (e) { return { error: errMsg(e) }; }
}

/** Quick Setup → Test: token valid, selected pages subscribed to leadgen, last lead received. */
export async function testFacebook(): Promise<TestResult> {
  try {
    const { me, acct, db } = await connected();
    const checks: [string, boolean, string][] = [];
    const who = await graph<{ name: string }>(acct.token, "me?fields=id,name");
    checks.push(["Facebook token", who.ok, who.ok ? `Valid — ${who.data.name}` : who.message]);
    const app = await fbApp(me.company_id).catch(() => null);
    const { data: pages } = await db.from("lb_fb_pages").select("page_id,page_name,page_token_enc").eq("company_id", me.company_id).eq("is_selected", true);
    if (!pages?.length) checks.push(["Pages", false, "No page selected — add one in FB Login"]);
    for (const p of pages ?? []) {
      const r = p.page_token_enc ? await graph<{ data: { id: string; subscribed_fields?: string[] }[] }>(decryptSecret(p.page_token_enc), `${p.page_id}/subscribed_apps`) : null;
      const sub = r?.ok && r.data.data.some((a) => (!app || a.id === app.appId) && a.subscribed_fields?.includes("leadgen"));
      checks.push([p.page_name ?? p.page_id, Boolean(sub), sub ? "Subscribed to leadgen" : r && !r.ok ? r.message : "Not subscribed — remove and add the page again"]);
    }
    const { data: last } = await db.from("lb_fb_lead_events").select("created_at,status").eq("company_id", me.company_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    checks.push(["Last lead received", Boolean(last), last ? `${fmtDateTime(last.created_at)} (${last.status})` : "No lead received yet"]);
    return { checks };
  } catch (e) { return { error: errMsg(e) }; }
}

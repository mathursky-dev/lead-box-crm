import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { fbAccount } from "./facebook";
import { graph } from "./whatsapp";

// Pulls daily ad spend from the Meta Marketing API (GET act_X/insights, ads_read) for every
// ad account the connected Facebook user can see, and stores it in lb_pl_entries as
// origin 'meta' rows (one per ad account per day). Uses the token saved by FB-Login, so no
// extra setup is needed once Facebook is connected.

export type MetaSync = { synced_at: string | null; synced_from: string | null; synced_to: string | null; accounts: number; error: string | null };

type InsightsPage = { data: { date_start: string; spend: string }[]; paging?: { next?: string } };
const STALE_MS = 3 * 3600 * 1000;
const DAY = 86400000;
const addDays = (ymd: string, n: number) => new Date(new Date(ymd + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

export async function metaSyncState(companyId: string): Promise<{ connected: boolean; state: MetaSync | null }> {
  if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) return { connected: false, state: null };
  const db = createAdminClient();
  const [{ data: acct }, { data: state }] = await Promise.all([
    db.from("lb_fb_accounts").select("company_id").eq("company_id", companyId).maybeSingle(),
    db.from("lb_pl_sync").select("synced_at,synced_from,synced_to,accounts,error").eq("company_id", companyId).maybeSingle(),
  ]);
  return { connected: Boolean(acct), state: (state as MetaSync | null) ?? null };
}

/** Sync when the last pull is older than 3 hours or did not cover the range. Never throws. */
export async function syncMetaSpendIfStale(companyId: string, from: string, to: string, state: MetaSync | null) {
  const fresh = state?.synced_at && Date.now() - new Date(state.synced_at).getTime() < STALE_MS
    && state.synced_from && state.synced_to && state.synced_from <= from && state.synced_to >= to;
  if (fresh) return null;
  return syncMetaSpend(companyId, from, to).catch((e) => ({ error: (e as Error).message, accounts: 0 }));
}

/** Pull daily spend for [from, to] (inclusive dates, max ~13 months back per Meta). */
export async function syncMetaSpend(companyId: string, from: string, to: string): Promise<{ error?: string; accounts: number; rows?: number }> {
  const db = createAdminClient();
  const acct = await fbAccount(companyId);
  if (!acct) return { error: "Facebook is not connected (Admin → Facebook Lead Ads).", accounts: 0 };
  // Meta keeps insights for 37 months; also don't ask for future days.
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const until = to > today ? today : to;
  const since = from < addDays(today, -1100) ? addDays(today, -1100) : from;
  const save = (patch: Record<string, unknown>) => db.from("lb_pl_sync").upsert({ company_id: companyId, ...patch });
  if (since > until) return { accounts: 0, rows: 0 };

  const accR = await graph<{ data: { id: string; name: string; currency?: string }[] }>(acct.token, "me/adaccounts?fields=name,currency&limit=200");
  if (!accR.ok) {
    await save({ error: `Ad accounts: ${accR.message}`.slice(0, 500) });
    return { error: `Meta: ${accR.message}`, accounts: 0 };
  }
  const { data: src } = await db.from("lb_sources").select("id").eq("company_id", companyId).eq("name", "Facebook").maybeSingle();
  const range = encodeURIComponent(JSON.stringify({ since, until }));
  let rows = 0;
  const errors: string[] = [];
  for (const a of accR.data.data ?? []) {
    const days: { date_start: string; spend: string }[] = [];
    let next: string | null = `${a.id}/insights?fields=spend&level=account&time_increment=1&time_range=${range}&limit=500`;
    let failed = false;
    for (let page = 0; next && page < 20; page++) {
      const r: Awaited<ReturnType<typeof graph<InsightsPage>>> = await graph<InsightsPage>(acct.token, next);
      if (!r.ok) { errors.push(`${a.name || a.id}: ${r.message}`); failed = true; break; }
      days.push(...(r.data.data ?? []));
      next = r.data.paging?.next ?? null;
    }
    if (failed) continue;
    // Replace this account's rows in the range, so days that went back to 0 disappear.
    const del = await db.from("lb_pl_entries").delete().eq("company_id", companyId).eq("origin", "meta").eq("ext_ref", a.id)
      .gte("entry_date", since).lte("entry_date", until);
    if (del.error) { errors.push(del.error.message); continue; }
    const ins = days.filter((d) => Number(d.spend) > 0).map((d) => ({
      company_id: companyId, kind: "ad_cost", entry_date: d.date_start, amount: Math.round(Number(d.spend) * 100) / 100,
      channel: "meta", origin: "meta", ext_ref: a.id, ext_name: (a.name ?? "").slice(0, 200) || null, currency: a.currency ?? null,
      source_id: src?.id ?? null, note: "",
    }));
    if (ins.length) {
      const r = await db.from("lb_pl_entries").insert(ins);
      if (r.error) { errors.push(r.error.message); continue; }
      rows += ins.length;
    }
  }
  const accounts = accR.data.data?.length ?? 0;
  const error = errors.length ? errors.join(" · ").slice(0, 500) : null;
  await save({ synced_at: new Date().toISOString(), synced_from: since, synced_to: until, accounts, error });
  return { accounts, rows, ...(error ? { error } : {}) };
}

import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { Kpi, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { nowMs } from "@/lib/care";
import { fmtYmd, RETENTION_RESULT } from "@/lib/retention";
import { retentionSettings, RET_NOT_READY, retNotReady } from "@/lib/retention-server";

export const metadata = { title: "Birthday & anniversary wishes" };

type Row = { customer_id: string; name: string | null; phone_e164: string; kind: string; on_date: string; years: number | null; owner_id: string | null };

export default async function WishesPage() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const [s, { data, error }, { data: log }, refs] = await Promise.all([
    retentionSettings(sb, cid),
    sb.rpc("lb_upcoming_wishes", { p_days: 30 }),
    sb.from("lb_retention_log").select("id,kind,result,created_at,customer:lb_customers(name,phone_e164)").eq("company_id", cid).in("kind", ["birthday", "anniversary"]).order("created_at", { ascending: false }).limit(50),
    loadRefs(),
  ]);
  if (!s || error) return <ErrorBox message={!s || retNotReady(error?.message ?? "") ? RET_NOT_READY : error!.message} />;
  const rows = (data ?? []) as Row[];
  const today = new Date(nowMs() + 330 * 60000).toISOString().slice(0, 10);
  const todays = rows.filter((r) => r.on_date === today);
  const week = rows.filter((r) => r.on_date <= new Date(nowMs() + 330 * 60000 + 7 * 86400000).toISOString().slice(0, 10));
  const userName = new Map(refs.users.map((u) => [u.id, u.full_name]));
  const wa = (r: Row) => `https://wa.me/${r.phone_e164.replace(/\D/g, "")}?text=${encodeURIComponent(
    r.kind === "birthday" ? `Happy Birthday ${r.name?.split(" ")[0] ?? ""}! 🎂 Wishing you a wonderful year ahead.` : `Happy Anniversary ${r.name?.split(" ")[0] ?? ""}! 💍 Best wishes to you both.`)}`;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Add birthday / anniversary on any lead (<b>Loyalty & service</b> panel).{" "}
        {s.wishes_enabled ? <>Automatic WhatsApp wishes are <b className="text-brand-700">on</b> ({String(s.wish_hour).padStart(2, "0")}:00).</> : <>Automatic WhatsApp wishes are <b>off</b>{s.wish_notify_owner ? "; owners get a reminder every morning" : ""}. {isAdmin(profile) && <Link href="/care/settings" className="font-medium text-brand-700 underline">Settings</Link>}</>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Today" value={todays.length} icon="sparkle" tone="green" />
        <Kpi label="Next 7 days" value={week.length} icon="calendar" tone="blue" />
        <Kpi label="Next 30 days" value={rows.length} icon="heart" tone="violet" />
      </div>
      <div className="card overflow-hidden">
        <Table head={["Date", "Customer", "Occasion", "Owner", ""]} empty={rows.length ? undefined : "No birthdays or anniversaries in the next 30 days."}>
          {rows.map((r) => (
            <tr key={`${r.customer_id}:${r.kind}`} className={r.on_date === today ? "bg-amber-50" : undefined}>
              <td className="td whitespace-nowrap">{r.on_date === today ? <b>Today</b> : fmtYmd(r.on_date)}</td>
              <td className="td">{r.name || "—"}<div className="text-xs text-slate-500">{r.phone_e164}</div></td>
              <td className="td">{r.kind === "birthday" ? "🎂 Birthday" : "💍 Anniversary"}{r.years ? <span className="text-xs text-slate-500"> · {r.years}{r.kind === "birthday" ? " yrs" : " years"}</span> : null}</td>
              <td className="td text-sm">{r.owner_id ? userName.get(r.owner_id) ?? "—" : "—"}</td>
              <td className="td"><a href={wa(r)} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">Wish on WhatsApp</a></td>
            </tr>
          ))}
        </Table>
      </div>
      {(log?.length ?? 0) > 0 && (
        <div className="card overflow-hidden">
          <h2 className="px-4 pt-4 text-sm font-semibold text-navy-900">Recent automatic runs</h2>
          <Table head={["When", "Customer", "Occasion", "Result"]}>
            {(log ?? []).map((g) => {
              const c = g.customer as unknown as { name: string | null; phone_e164: string } | null;
              const res = RETENTION_RESULT(g.result as string);
              return (
                <tr key={g.id as string}>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(g.created_at as string)}</td>
                  <td className="td">{c?.name || c?.phone_e164 || "—"}</td>
                  <td className="td">{g.kind === "birthday" ? "🎂 Birthday" : "💍 Anniversary"}</td>
                  <td className="td"><span className={`rounded px-1.5 text-[10px] font-bold uppercase ${res.cls}`}>{res.label}</span></td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </div>
  );
}

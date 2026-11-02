import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi, PillTabs, Table } from "@/components/kit";
import { fmtDateTime, istDate, istMidnight } from "@/lib/dates";
import { apptStatus, nowMs } from "@/lib/care";
import { ApptStatus, LinkBar } from "../ui";
import { MeetingCell } from "../meetings/cell";

export const metadata = { title: "Appointments" };

type SP = Record<string, string | undefined>;
const VIEWS = [
  { key: "upcoming", label: "Upcoming" }, { key: "today", label: "Today" }, { key: "past", label: "Past" }, { key: "all", label: "All" },
];

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "upcoming";
  const now = new Date().toISOString();
  const t0 = istMidnight(istDate()).toISOString(), t1 = new Date(istMidnight(istDate()).getTime() + 86400000).toISOString();

  let q = sb.from("lb_appointments").select("id,appt_no,starts_at,ends_at,status,channel,name,phone_e164,note,lead_id,assigned_to,lead:lb_leads(lead_no),who:lb_profiles!lb_appointments_assigned_to_fkey(full_name)").eq("company_id", cid);
  if (sp.id && /^[0-9a-f-]{36}$/.test(sp.id)) q = q.eq("id", sp.id);
  else if (view === "upcoming") q = q.gte("starts_at", now).in("status", ["booked", "confirmed"]).order("starts_at");
  else if (view === "today") q = q.gte("starts_at", t0).lt("starts_at", t1).order("starts_at");
  else if (view === "past") q = q.lt("starts_at", now).order("starts_at", { ascending: false });
  else q = q.order("starts_at", { ascending: false });
  const [{ data, error }, { data: s }, today, week, noShow] = await Promise.all([
    q.limit(200),
    sb.from("lb_care_settings").select("booking_enabled,booking_code").eq("company_id", cid).maybeSingle(),
    sb.from("lb_appointments").select("id", { count: "exact", head: true }).eq("company_id", cid).gte("starts_at", t0).lt("starts_at", t1).in("status", ["booked", "confirmed", "done"]),
    sb.from("lb_appointments").select("id", { count: "exact", head: true }).eq("company_id", cid).gte("starts_at", now).lt("starts_at", new Date(nowMs() + 7 * 86400000).toISOString()).in("status", ["booked", "confirmed"]),
    sb.from("lb_appointments").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("status", "no_show").gte("starts_at", new Date(nowMs() - 30 * 86400000).toISOString()),
  ]);
  if (error) return <ErrorBox message={/lb_appointments|schema cache/i.test(error.message) ? "Customer care is not set up yet: the database update has to be run once (Supabase SQL)." : error.message} />;
  const admin = isAdmin(profile);
  // Meeting links (separate query: the page keeps working before the meeting links SQL is applied).
  const ids = (data ?? []).map((a) => a.id as string);
  const [{ data: meets }, { data: mode }] = ids.length
    ? await Promise.all([
      sb.from("lb_appointments").select("id,meeting_url,meeting_error").in("id", ids),
      sb.from("lb_care_settings").select("meeting_mode").eq("company_id", cid).maybeSingle(),
    ])
    : [{ data: null }, { data: null }];
  const meetOn = Boolean(mode?.meeting_mode && mode.meeting_mode !== "none");
  const meetBy = new Map((meets ?? []).map((m) => [m.id as string, m as { meeting_url: string | null; meeting_error: string | null }]));
  const showMeet = meetOn || [...meetBy.values()].some((m) => m.meeting_url);
  return (
    <div className="space-y-4">
      {s?.booking_enabled && s.booking_code ? (
        <LinkBar path={`/b/${s.booking_code}`} label="Booking link" share="📅 Book your appointment here:" settingsHref={admin ? "/care/settings" : undefined}
          note="Share it on WhatsApp, status or Instagram bio. Bookings show here, on the lead and in the owner's follow-ups." />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          Online booking is off. {admin ? <Link href="/care/settings" className="font-medium text-brand-700 underline">Turn on the booking page</Link> : "Ask your admin to turn on the booking page."} You can still book from any lead (Customer care panel).
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Today" value={today.count ?? 0} icon="calendar" tone="green" />
        <Kpi label="Next 7 days" value={week.count ?? 0} icon="clock" tone="blue" />
        <Kpi label="No-shows (30 days)" value={noShow.count ?? 0} icon="alert" tone="red" />
      </div>
      <PillTabs label="Appointment views" tabs={VIEWS.map((v) => ({ href: `/care/appointments?view=${v.key}`, label: v.label, active: !sp.id && v.key === view }))} />
      <div className="card overflow-hidden">
        <Table head={["When", "Customer", "Lead", "With", "Note", ...(showMeet ? ["Meeting"] : []), "Status"]} empty={data?.length ? undefined : "No appointments here yet."}>
          {(data ?? []).map((a) => {
            const st = apptStatus(a.status as string);
            const lead = a.lead as unknown as { lead_no: number } | null, who = a.who as unknown as { full_name: string } | null;
            return (
              <tr key={a.id as string} className={sp.id === a.id ? "bg-brand-50" : undefined}>
                <td className="td whitespace-nowrap"><b>{fmtDateTime(a.starts_at as string)}</b><div className="text-xs text-slate-500">#{a.appt_no as number} · {a.channel === "link" ? "booked online" : "by staff"}</div></td>
                <td className="td">{(a.name as string) || "—"}<div className="text-xs text-slate-500">{a.phone_e164 as string}</div></td>
                <td className="td">{a.lead_id && lead ? <Link href={`/leads/${a.lead_id}`} className="text-brand-700 hover:underline">LB-{lead.lead_no}</Link> : "—"}</td>
                <td className="td">{who?.full_name ?? "—"}</td>
                <td className="td max-w-xs truncate text-slate-600" title={(a.note as string) ?? ""}>{(a.note as string) || "—"}</td>
                {showMeet && (
                  <td className="td"><MeetingCell id={a.id as string} url={meetBy.get(a.id as string)?.meeting_url ?? null} error={meetBy.get(a.id as string)?.meeting_error ?? null}
                    canCreate={meetOn && ["booked", "confirmed"].includes(a.status as string)} /></td>
                )}
                <td className="td"><span className="sr-only">{st.label}</span><ApptStatus id={a.id as string} status={a.status as string} /></td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}

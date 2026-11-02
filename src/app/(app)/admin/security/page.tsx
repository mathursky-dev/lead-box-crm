import { requireAdmin, ROLE_LABEL, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Panel, Table, Kpi } from "@/components/kit";
import { ActionButton } from "@/components/ui";
import { setRequireTwoFactor, resetUserTwoFactor } from "@/lib/actions/security";
import { deviceLabel } from "@/lib/login-log";
import { fmtDateTime, daysAgoIso } from "@/lib/dates";

export const metadata = { title: "Security & login history" };

const METHOD: Record<string, string> = { password: "Password", otp: "OTP", logout: "Signed out", "2fa_setup": "2FA turned on", "2fa_off": "2FA turned off" };

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ failed?: string; user?: string }> }) {
  const { profile } = await requireAdmin();
  const { failed, user } = await searchParams;
  const sb = await createClient();
  let q = sb.from("lb_login_events").select("created_at,user_id,login,success,method,reason,ip,user_agent").eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(200);
  if (failed) q = q.eq("success", false);
  if (user) q = q.eq("user_id", user);
  const since = daysAgoIso(7);
  const [{ data: co, error }, { data: users }, { data: tfa }, { data: events }, { count: fails7 }] = await Promise.all([
    sb.from("lb_companies").select("require_2fa,is_demo").eq("id", profile.company_id).maybeSingle(),
    sb.from("lb_profiles").select("id,full_name,email,role,is_active").eq("company_id", profile.company_id).order("full_name"),
    sb.rpc("lb_company_2fa_status"),
    q,
    sb.from("lb_login_events").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("success", false).gte("created_at", since),
  ]);
  if (error) return <><PageHeader icon="shield" tone="navy" title="Security & login history" /><ErrorBox message="This page needs the new database update (SQL) first." /></>;
  const has = new Map(((tfa ?? []) as { user_id: string; has_2fa: boolean }[]).map((r) => [r.user_id, r.has_2fa]));
  const names = new Map((users ?? []).map((u) => [u.id as string, u.full_name as string]));
  const active = (users ?? []).filter((u) => u.is_active);
  const withTfa = active.filter((u) => has.get(u.id)).length;
  const lastLogin = new Map<string, string>();
  for (const e of events ?? []) if (e.success && e.user_id && e.method !== "logout" && !lastLogin.has(e.user_id)) lastLogin.set(e.user_id, e.created_at);
  return (
    <>
      <PageHeader icon="shield" tone="navy" title="Security & login history" sub="Two-factor login (OTP) for your team, and every sign-in attempt." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Users with 2FA" value={`${withTfa} / ${active.length}`} icon="shield" />
        <Kpi label="Failed sign-ins (7 days)" value={fails7 ?? 0} icon="alert" tone="red" href="/admin/security?failed=1" />
        <Kpi label="2FA for everyone" value={co?.require_2fa ? "Compulsory" : "Optional"} icon="key" tone="navy" />
      </div>
      <Panel title="Two-factor for the whole company" icon="key">
        <div className="space-y-2 text-sm">
          <p>When compulsory, every user must set up an authenticator app (Google / Microsoft Authenticator) and enter its 6-digit OTP at each sign-in. Users who have not set it up will be asked to do it at their next page load.</p>
          {co?.is_demo ? <p className="text-xs text-slate-500">Not available on the demo company.</p>
            : co?.require_2fa
              ? <ActionButton action={setRequireTwoFactor.bind(null, false)} className="btn-ghost btn-sm" confirm="Make two-factor optional again?">Make optional</ActionButton>
              : <ActionButton action={setRequireTwoFactor.bind(null, true)} className="btn-primary btn-sm" confirm="Make two-factor compulsory for every user of this company?">Make compulsory for everyone</ActionButton>}
        </div>
      </Panel>
      <Panel title="Team" icon="contacts" className="mt-4" sub="Lost phone? Reset removes the user's authenticator; they sign in with password and set it up again.">
        <Table head={["User", "Role", "2FA", "Last sign-in", ""]}>
          {active.map((u) => (
            <tr key={u.id}>
              <td className="td"><div className="font-medium text-navy-900">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
              <td className="td">{ROLE_LABEL[u.role as Role] ?? u.role}</td>
              <td className="td">{has.get(u.id) ? <span className="text-brand-700">On</span> : <span className="text-slate-400">Off</span>}</td>
              <td className="td whitespace-nowrap text-slate-600">{lastLogin.has(u.id) ? fmtDateTime(lastLogin.get(u.id)!) : "—"}</td>
              <td className="td text-right">
                <a href={`/admin/security?user=${u.id}#history`} className="mr-2 text-xs font-medium text-brand-700 hover:underline">History</a>
                {has.get(u.id) && u.id !== profile.id && <ActionButton action={resetUserTwoFactor.bind(null, u.id)} confirm={`Reset two-factor for ${u.full_name}?`} className="btn-ghost btn-sm text-red-600">Reset 2FA</ActionButton>}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <div id="history" />
      <Panel title={`Login history${user ? ` · ${names.get(user) ?? "user"}` : ""}${failed ? " · failed only" : ""}`} icon="clock" className="mt-4"
        actions={<>
          <a href="/admin/security#history" className={`btn-sm ${!failed && !user ? "btn-primary" : "btn-ghost"}`}>All</a>
          <a href="/admin/security?failed=1#history" className={`btn-sm ${failed ? "btn-primary" : "btn-ghost"}`}>Failed</a>
        </>}>
        <Table head={["When", "User", "Result", "Device", "IP"]} empty={events?.length ? undefined : "No sign-ins recorded yet. History starts from this update."}>
          {(events ?? []).map((e, i) => (
            <tr key={i}>
              <td className="td whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
              <td className="td">{(e.user_id && names.get(e.user_id)) ?? e.login ?? "—"}</td>
              <td className="td">{e.success ? <span className="text-brand-700">{METHOD[e.method] ?? e.method}{e.reason ? ` · ${e.reason}` : ""}</span> : <span className="text-red-600">Failed · {e.reason ?? METHOD[e.method]}</span>}</td>
              <td className="td">{deviceLabel(e.user_agent)}</td>
              <td className="td text-slate-500">{e.ip ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

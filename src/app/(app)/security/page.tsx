import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { Panel, Table } from "@/components/kit";
import { ActionButton } from "@/components/ui";
import { disableTwoFactor, signOutOtherDevices } from "@/lib/actions/security";
import { deviceLabel } from "@/lib/login-log";
import { fmtDateTime } from "@/lib/dates";
import { EnableTwoFactor } from "./enable";

export const metadata = { title: "Security" };

const METHOD: Record<string, string> = { password: "Password", otp: "OTP", logout: "Signed out", "2fa_setup": "2FA turned on", "2fa_off": "2FA turned off" };

export default async function SecurityPage() {
  const { profile } = await requireProfile({ allowUnpaid: true });
  const sb = await createClient();
  const [{ data: f }, { data: co }, { data: events }] = await Promise.all([
    sb.auth.mfa.listFactors(),
    sb.from("lb_companies").select("require_2fa").eq("id", profile.company_id).maybeSingle(),
    sb.from("lb_login_events").select("created_at,success,method,reason,ip,user_agent").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const on = Boolean(f?.totp?.length);
  const required = Boolean(co?.require_2fa);
  return (
    <>
      <PageHeader icon="shield" tone="navy" title="Security" sub="Two-factor login (OTP) and where your account has signed in." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Two-factor login (OTP)" icon="shield">
          {on ? (
            <div className="space-y-3 text-sm">
              <p><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">ON</span> Every sign-in asks for the 6-digit code from your authenticator app.</p>
              {required && profile.role !== "super_admin"
                ? <p className="text-xs text-slate-500">Your company requires two-factor, so it cannot be turned off.</p>
                : <ActionButton action={disableTwoFactor} className="btn-ghost btn-sm text-red-600" confirm="Turn off two-factor login?">Turn off two-factor</ActionButton>}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">OFF</span> Add an OTP step so a stolen password alone cannot open your account.</p>
              <p className="text-xs text-slate-500">You need Google Authenticator or Microsoft Authenticator (free) on your phone.</p>
              <EnableTwoFactor />
            </div>
          )}
        </Panel>
        <Panel title="Devices" icon="phone">
          <div className="space-y-3 text-sm">
            <p>Logged in on an old phone or a shared computer? Sign out everywhere except this device.</p>
            <ActionButton action={signOutOtherDevices} className="btn-ghost btn-sm" confirm="Sign out from all other devices?">Sign out other devices</ActionButton>
          </div>
        </Panel>
      </div>
      <Panel title="My recent sign-ins" icon="clock" className="mt-4">
        <Table head={["When", "Result", "Device", "IP"]} empty={events?.length ? undefined : "No sign-ins recorded yet."}>
          {(events ?? []).map((e, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="td whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
              <td className="td">{e.success ? <span className="text-brand-700">{METHOD[e.method] ?? e.method}</span> : <span className="text-red-600">Failed · {e.reason ?? METHOD[e.method]}</span>}</td>
              <td className="td">{deviceLabel(e.user_agent)}</td>
              <td className="td text-slate-500">{e.ip ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

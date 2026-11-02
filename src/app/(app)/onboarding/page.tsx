import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Icon } from "@/components/kit";
import { ActionButton, ActionForm, Field, Submit } from "@/components/ui";
import { saveCompanyStep, markStep, finishOnboarding } from "@/lib/actions/onboarding";

export const metadata = { title: "Setup wizard" };

type Step = { key: string; title: string; sub: string; done: boolean };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="Setup wizard is not available on this server." />;
  const db = createAdminClient();
  const cid = profile.company_id;
  const count = async (t: string) => {
    const { count: n } = await db.from(t).select("*", { count: "exact", head: true }).eq("company_id", cid);
    return n ?? 0;
  };
  const [{ data: co, error }, numbers, fb, users, statuses, sources, leads, connectors, rules] = await Promise.all([
    db.from("lb_companies").select("name,timezone,default_country,onboarding,onboarded_at").eq("id", cid).single(),
    count("lb_wa_numbers"), count("lb_fb_pages"), count("lb_profiles"), count("lb_lead_statuses"), count("lb_sources"),
    count("lb_leads"), count("lb_lead_connectors"), count("lb_alloc_sources"),
  ]);
  if (error || !co) return <ErrorBox message="The setup wizard needs the new database update (SQL) first." />;
  const marked = new Set(((co.onboarding ?? {}) as { done?: string[] }).done ?? []);
  const steps: Step[] = [
    { key: "company", title: "Company details", sub: "Name, country and time zone", done: marked.has("company") },
    { key: "whatsapp", title: "Connect WhatsApp", sub: numbers ? `${numbers} number${numbers > 1 ? "s" : ""} connected` : "Your WhatsApp Business number", done: numbers > 0 || marked.has("whatsapp") },
    { key: "team", title: "Add your team", sub: `${users} user${users === 1 ? "" : "s"}`, done: users > 1 || marked.has("team") },
    { key: "stages", title: "Lead stages & sources", sub: `${statuses} statuses · ${sources} sources`, done: marked.has("stages") },
    { key: "leads", title: "Get leads in", sub: leads ? `${leads} leads` : "Facebook, Excel import, website forms", done: leads > 0 || fb > 0 || connectors > 0 || marked.has("leads") },
    { key: "allocation", title: "Auto-assign leads", sub: rules ? "Allocation set" : "Share new leads among your team", done: rules > 0 || marked.has("allocation") },
  ];
  const sp = (await searchParams).step;
  const current = sp === "finish" ? "finish" : steps.find((s) => s.key === sp)?.key ?? steps.find((s) => !s.done)?.key ?? "finish";
  const doneN = steps.filter((s) => s.done).length;
  const next = (key: string) => <ActionButton action={markStep.bind(null, key)} className="btn-primary">Done, next step →</ActionButton>;
  const skip = (key: string) => <ActionButton action={markStep.bind(null, key)} className="btn-ghost">Skip for now</ActionButton>;
  const go = (href: string, label: string) => <Link href={href} className="btn-ghost border border-slate-200">{label} ↗</Link>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Let&apos;s set up {co.name}</h1>
          <p className="text-sm text-slate-500">{doneN} of {steps.length} steps done. You can leave and come back any time from Manage → Setup wizard.</p>
        </div>
        {!co.onboarded_at && <ActionButton action={finishOnboarding} className="btn-ghost btn-sm" confirm="Hide the setup reminder? You can open the wizard again from Manage → Setup wizard.">I&apos;ll do it later</ActionButton>}
      </div>
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(doneN / steps.length) * 100}%` }} /></div>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <ol className="card divide-y p-0">
          {steps.map((s, i) => (
            <li key={s.key}>
              <Link href={`/onboarding?step=${s.key}`} className={`flex items-center gap-3 px-4 py-3 ${current === s.key ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.done ? "bg-brand-600 text-white" : current === s.key ? "border-2 border-brand-600 text-brand-700" : "border border-slate-300 text-slate-500"}`}>
                  {s.done ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0"><span className="block text-sm font-medium text-navy-900">{s.title}</span><span className="block truncate text-xs text-slate-500">{s.sub}</span></span>
              </Link>
            </li>
          ))}
        </ol>
        <section className="card p-5">
          {current === "company" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Company details</h2>
              <p className="mb-4 text-sm text-slate-500">Used on quotes, reports and to show times correctly.</p>
              <ActionForm action={saveCompanyStep} className="max-w-md space-y-3">
                <Field label="Company name"><input name="name" className="input" defaultValue={co.name} required /></Field>
                <Field label="Country">
                  <select name="default_country" className="input" defaultValue={co.default_country ?? "IN"}>
                    {[["IN", "India"], ["AE", "UAE"], ["US", "USA"], ["GB", "UK"], ["NP", "Nepal"], ["BD", "Bangladesh"], ["SA", "Saudi Arabia"], ["SG", "Singapore"], ["AU", "Australia"], ["CA", "Canada"]].map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </Field>
                <Field label="Time zone">
                  <select name="timezone" className="input" defaultValue={co.timezone ?? "Asia/Kolkata"}>
                    {["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Riyadh", "Asia/Singapore", "Europe/London", "America/New_York", "America/Toronto", "Australia/Sydney"].map((z) => <option key={z}>{z}</option>)}
                  </select>
                </Field>
                <Submit>Save and continue →</Submit>
              </ActionForm>
            </>
          )}
          {current === "whatsapp" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Connect WhatsApp</h2>
              <p className="mb-4 text-sm text-slate-500">Connect your WhatsApp Business number so chats, auto-replies, broadcasts and chatbot flows work from Lead Box.</p>
              <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li><b>Official WhatsApp Cloud API</b> (recommended): green-tick ready, templates and broadcasts.</li>
                <li>Already connected numbers show here automatically.</li>
              </ul>
              <div className="flex flex-wrap gap-2">{go("/whatsapp/connections", "Connect a number")}{numbers ? next("whatsapp") : skip("whatsapp")}</div>
            </>
          )}
          {current === "team" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Add your team</h2>
              <p className="mb-4 text-sm text-slate-500">Add your sales agents and team leaders. Each person gets their own login (email or User ID). Choose what each role can see in Roles &amp; permissions.</p>
              <div className="flex flex-wrap gap-2">{go("/admin/users", "Add users")}{go("/admin/roles", "Roles & permissions")}{users > 1 ? next("team") : skip("team")}</div>
            </>
          )}
          {current === "stages" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Lead stages &amp; sources</h2>
              <p className="mb-4 text-sm text-slate-500">You already have {statuses} lead statuses and {sources} sources. Rename them to match how your team sells (for example New → Contacted → Site visit → Won), and add your own sources and tags.</p>
              <div className="flex flex-wrap gap-2">{go("/settings/statuses", "Edit statuses")}{go("/settings/sources", "Edit sources")}{next("stages")}</div>
            </>
          )}
          {current === "leads" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Get leads in</h2>
              <p className="mb-4 text-sm text-slate-500">Bring in your existing leads and connect the places new leads come from.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[["/import", "Import Excel / CSV", "upload"], ["/admin/fb-login", "Facebook & Instagram Lead Ads", "facebook"], ["/admin/quick-setup", "Google Ads, IndiaMART, JustDial", "globe"], ["/settings/forms", "Website lead form", "list"], ["/leads/new", "Add a lead by hand", "plus"]].map(([h, l, i]) => (
                  <Link key={h} href={h} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-navy-900 hover:border-brand-300 hover:bg-brand-50"><Icon name={i} className="h-4 w-4 text-brand-600" />{l}</Link>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">{leads ? next("leads") : skip("leads")}</div>
            </>
          )}
          {current === "allocation" && (
            <>
              <h2 className="mb-1 text-lg font-semibold text-navy-900">Auto-assign leads</h2>
              <p className="mb-4 text-sm text-slate-500">Share new leads among your agents automatically (round robin, ratio, daily limit per agent) so no lead waits.</p>
              <div className="flex flex-wrap gap-2">{go("/admin/allocation", "Set allocation")}{rules ? next("allocation") : skip("allocation")}</div>
            </>
          )}
          {current === "finish" && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white"><Icon name="check" className="h-7 w-7" /></div>
              <h2 className="text-lg font-semibold text-navy-900">{doneN === steps.length ? "All set!" : "Almost there"}</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{doneN === steps.length ? "Your CRM is ready. Open the dashboard to start working on leads." : "You can finish the remaining steps later from Manage → Setup wizard."}</p>
              <div className="mt-4 flex justify-center">{co.onboarded_at ? <Link href="/dashboard" className="btn-primary">Go to dashboard</Link> : <ActionButton action={finishOnboarding} className="btn-primary">Finish setup</ActionButton>}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

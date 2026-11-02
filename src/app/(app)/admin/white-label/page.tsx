import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel } from "@/components/kit";
import { fmtDay } from "@/lib/dates";
import { MyBrandForm, AddClientButton, type BrandRow } from "@/components/brand-forms";

export const metadata = { title: "White-label" };

type Client = {
  id: string; name: string; created_at: string; is_active: boolean; plan: string | null; plan_name: string | null;
  trial_ends_at: string | null; paid_until: string | null; suspended_at: string | null; users: number; leads_month: number;
  admin_name: string | null; admin_email: string | null;
};

function status(c: Client) {
  const now = Date.now();
  if (c.suspended_at) return ["Suspended", "bg-red-50 text-red-700"];
  if (c.plan === "internal") return ["Free forever", "bg-violet-50 text-violet-700"];
  if (c.paid_until && new Date(c.paid_until).getTime() > now) return ["Paid", "bg-emerald-50 text-emerald-700"];
  if (c.trial_ends_at && new Date(c.trial_ends_at).getTime() > now) return ["Trial", "bg-sky-50 text-sky-700"];
  return ["Expired", "bg-amber-50 text-amber-800"];
}

/** Reseller console: the partner's Company Admin edits its brand and sees / adds client companies. */
export default async function WhiteLabelPage() {
  await requireAdmin();
  const sb = await createClient();
  const { data: brandId } = await sb.rpc("lb_my_reseller_brand");
  if (!brandId) redirect("/dashboard");
  const [{ data: brand, error }, { data: clients }] = await Promise.all([
    sb.from("lb_brands").select("*").eq("id", brandId as string).single(),
    sb.rpc("lb_reseller_clients"),
  ]);
  if (error || !brand) return <ErrorBox message={error?.message ?? "Brand not found."} />;
  const b = brand as BrandRow;
  const rows = (clients ?? []) as Client[];
  const active = rows.filter((c) => ["Paid", "Trial", "Free forever"].includes(status(c)[0])).length;
  return (
    <>
      <PageHeader icon="sparkle" tone="violet" title="White-label" sub="Your brand: logo, colours and support contact your clients see. Add and track client companies."
        actions={<AddClientButton />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Client companies" value={rows.length} icon="building" tone="violet" />
        <Kpi label="Active" value={active} icon="check" tone="green" />
        <Kpi label="Users (all clients)" value={rows.reduce((n, c) => n + Number(c.users), 0)} icon="contacts" tone="blue" />
        <Kpi label="Your domain" value={<span className="text-base">{b.domain ?? "Not set"}</span>} sub={b.domain ? "Clients sign in here" : "Ask Lead Box support to add one"} icon="globe" tone="amber" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Branding" icon="sparkle" tone="violet" className="lg:col-span-2">
          <MyBrandForm brand={b} />
        </Panel>
        <Panel title="Clients" icon="list" tone="blue" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Company</th><th className="th">Plan</th><th className="th">Status</th><th className="th">Users</th><th className="th">Leads (month)</th><th className="th">Joined</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((c) => {
                  const [label, cls] = status(c);
                  return (
                    <tr key={c.id}>
                      <td className="td"><div className="font-medium text-navy-900">{c.name}</div><div className="text-xs text-slate-500">{c.admin_name ? `${c.admin_name} · ${c.admin_email}` : "No admin"}</div></td>
                      <td className="td">{c.plan_name ?? "—"}</td>
                      <td className="td"><span className={`badge ${cls}`}>{label}</span></td>
                      <td className="td">{c.users}</td>
                      <td className="td">{Number(c.leads_month).toLocaleString("en-IN")}</td>
                      <td className="td text-slate-500">{fmtDay(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <div className="px-3 py-6 text-center text-sm text-slate-500">No clients yet. Use “+ Add client”, or share your sign-up link{b.domain ? ` https://${b.domain}/signup` : ""}.</div>}
          </div>
        </Panel>
      </div>
    </>
  );
}

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { PermissionMatrix } from "./matrix";
import { PageAccessMatrix } from "./pages-matrix";
import { PAGES } from "@/lib/page-access";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const [{ data: catalog, error }, { data: saved }, { data: users }, { data: pageRows, error: pageErr }] = await Promise.all([
    sb.from("lb_permission_catalog").select("*").order("sort_order"),
    sb.from("lb_role_permissions").select("role,permission,allowed").eq("company_id", profile.company_id),
    sb.from("lb_profiles").select("full_name,role,permissions,is_active").eq("company_id", profile.company_id),
    sb.from("lb_role_page_access").select("role,page,can_view,can_edit,can_delete").eq("company_id", profile.company_id),
  ]);
  const pageValue = Object.fromEntries((pageRows ?? []).map((r) => [`${r.role}:${r.page}`, { view: r.can_view, edit: r.can_edit, delete: r.can_delete }]));
  const value = (role: "agent" | "team_leader", key: string, def: boolean) =>
    saved?.find((s) => s.role === role && s.permission === key)?.allowed ?? def;
  const counts = (r: string) => (users ?? []).filter((u) => u.role === r && u.is_active).length;
  const extras = (users ?? []).filter((u) => u.permissions?.length && u.is_active);
  return (
    <>
      <PageHeader icon="shield" tone="navy" title="Roles & permissions"
        sub="Choose what Agents and Team Leaders can do. Enforced by the database on every action, not just hidden buttons. Data visibility stays role-based: agents see their own leads and chats, team leaders their permitted teams, admins the whole company." />
      {error ? <ErrorBox message={error.message} /> : (
        <PermissionMatrix
          rows={(catalog ?? []).map((c) => ({ key: c.key, label: c.label, module: c.module, agent: value("agent", c.key, c.agent_default), team_leader: value("team_leader", c.key, c.team_leader_default) }))}
          counts={{ agent: counts("agent"), team_leader: counts("team_leader"), company_admin: counts("company_admin"), super_admin: counts("super_admin") }} />
      )}
      <h2 className="mb-1 mt-6 text-base font-semibold text-navy-900">Page access</h2>
      <p className="mb-3 text-sm text-slate-500">Choose which pages Agents and Team Leaders can open, and where they can edit or delete. Everything is allowed until you untick it.</p>
      {pageErr ? <ErrorBox message="Page access needs the new database update (SQL) first." /> : (
        <PageAccessMatrix pages={PAGES.map(({ key, label, edit, delete: del }) => ({ key, label, edit, delete: del }))} value={pageValue} />
      )}
      <section className="card mt-4 p-4 text-sm">
        <h2 className="mb-2 font-semibold text-navy-900">Per-user extra permissions</h2>
        <p className="mb-2 text-slate-500">Grant a single user more than their role allows from Admin → Users → Edit → Extra permissions.</p>
        {extras.length ? <ul className="space-y-1">{extras.map((u) => <li key={u.full_name}><b>{u.full_name}</b> <span className="text-slate-500">— {u.permissions.join(", ")}</span></li>)}</ul>
          : <p className="text-slate-400">No users have extra permissions.</p>}
      </section>
    </>
  );
}

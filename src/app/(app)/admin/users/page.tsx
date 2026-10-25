import { requireAdmin, ROLE_LABEL, type Role } from "@/lib/auth";
import { createClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { UserForm, UserRowActions } from "./user-forms";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const { profile: me } = await requireAdmin();
  const sb = await createClient();
  const [{ data: users, error }, refs, { data: access }, { data: load }] = await Promise.all([
    sb.from("lb_profiles").select("*").order("is_active", { ascending: false }).order("full_name"),
    loadRefs(),
    sb.from("lb_user_team_access").select("user_id,team_id"),
    sb.rpc("lb_open_lead_counts"),
  ]);
  const openCount = new Map<string, number>();
  ((load ?? []) as { owner_id: string; open_leads: number }[]).forEach((l) => openCount.set(l.owner_id, Number(l.open_leads)));
  const teamName = new Map(refs.teams.map((t) => [t.id, t.name]));
  return (
    <>
      <PageHeader icon="contacts" tone="violet" title="Users" sub="Create users, set role, placement, scoped permissions and allocation limits."
        actions={hasServiceRole() ? <UserForm refs={refs} meRole={me.role} />
          : <button className="btn-primary" disabled title="Server key missing — see the message below">+ Add user</button>} />
      {!hasServiceRole() && <div className="mb-4"><ErrorBox message="Adding, deactivating and inviting users is disabled: the server setting SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel → Project → Settings → Environment Variables (Production), then redeploy." /></div>}
      {error && <ErrorBox message={error.message} />}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr>
            <th className="th">Name</th><th className="th">Role</th><th className="th">Team</th><th className="th">Open leads</th><th className="th">Limit</th><th className="th">Status</th><th className="th"></th>
          </tr></thead>
          <tbody className="divide-y">
            {(users ?? []).map((u) => (
              <tr key={u.id} className={u.is_active ? "" : "bg-slate-50 text-slate-400"}>
                <td className="td"><div className="font-medium text-navy-900">{u.full_name}</div><div className="text-xs text-slate-500">{u.username ? <>ID: <b>{u.username}</b>{!u.email.includes("@users.") && <> · {u.email}</>}</> : u.email}</div></td>
                <td className="td">{ROLE_LABEL[u.role as Role]}{u.permissions?.length ? <div className="text-xs text-slate-500">+{u.permissions.join(", ")}</div> : null}</td>
                <td className="td">{u.team_id ? teamName.get(u.team_id) : "—"}</td>
                <td className="td">{openCount.get(u.id) ?? 0}</td>
                <td className="td">{u.allocation_limit ?? "∞"}{!u.accepts_auto_allocation && <div className="text-xs">no auto</div>}</td>
                <td className="td">{u.is_active ? <span className="badge bg-brand-100 text-brand-700">Active</span> : <span className="badge bg-slate-200 text-slate-600">Inactive</span>}</td>
                <td className="td text-right">
                  <UserRowActions user={u} refs={refs} meId={me.id} meRole={me.role}
                    teamAccess={(access ?? []).filter((a) => a.user_id === u.id).map((a) => a.team_id)} canManageAuth={hasServiceRole()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Deactivated users cannot sign in. Their leads, chats and history are kept; reassign their open leads from the Leads page.</p>
    </>
  );
}

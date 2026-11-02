/* eslint-disable @next/next/no-img-element -- uploaded logos */
import { requireProfile } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Panel, Notice } from "@/components/kit";
import { BrandButton, type BrandRow } from "@/components/brand-forms";

export const metadata = { title: "White-label brands" };

export default async function BrandsPage() {
  await requireProfile();
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server." />;
  const db = createAdminClient();
  const [{ data: brands, error }, { data: companies }, { data: plans }] = await Promise.all([
    db.from("lb_brands").select("*").order("created_at", { ascending: false }),
    db.from("lb_companies").select("id,name,brand_id").order("name"),
    db.from("lb_plans").select("id,name").eq("is_active", true).order("sort"),
  ]);
  if (error) return <ErrorBox message={error.message} />;
  const rows = (brands ?? []) as BrandRow[];
  const cos = (companies ?? []) as { id: string; name: string; brand_id: string | null }[];
  const name = new Map(cos.map((c) => [c.id, c.name]));
  const clients = (id: string) => cos.filter((c) => c.brand_id === id).length;
  const opts = cos.map((c) => ({ id: c.id, name: c.name }));
  const planOpts = (plans ?? []) as { id: string; name: string }[];
  return (
    <>
      <PageHeader icon="building" tone="violet" title="White-label brands"
        sub="Resellers sell Lead Box under their own name: logo, colours, support contact and their own domain."
        actions={<BrandButton companies={opts} plans={planOpts} />} />
      <div className="mb-4">
        <Notice tone="green">
          <b>How it works:</b> 1) Create a brand and pick the partner&apos;s company as reseller. 2) Their admins get <b>Manage → White-label</b> to change the look and add clients.
          3) Open any company and pick a brand to move it under that partner. <b>Custom domain:</b> the partner adds a CNAME record <code>crm.partner.com → cname.vercel-dns.com</code>,
          then the domain is added to the Vercel project (Lead Box team does this). Login on that domain shows the partner&apos;s look.
        </Notice>
      </div>
      <Panel title="Brands" icon="list" tone="violet">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="th">Brand</th><th className="th">Domain</th><th className="th">Reseller</th><th className="th">Clients</th><th className="th">Colours</th><th className="th">Status</th><th className="th" />
            </tr></thead>
            <tbody className="divide-y">
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="flex items-center gap-2">
                      {b.logo_url ? <img src={b.logo_url} alt="" className="h-7 w-auto max-w-[7rem] object-contain" /> : null}
                      <span className="font-medium text-navy-900">{b.name}</span>
                    </div>
                  </td>
                  <td className="td">{b.domain ? <a className="text-brand-700 hover:underline" href={`https://${b.domain}/login`} target="_blank" rel="noreferrer">{b.domain}</a> : <span className="text-slate-400">—</span>}</td>
                  <td className="td">{b.owner_company_id ? name.get(b.owner_company_id) ?? "—" : <span className="text-slate-400">Platform</span>}</td>
                  <td className="td">{clients(b.id)}</td>
                  <td className="td"><span className="inline-flex gap-1"><span className="h-5 w-5 rounded" style={{ background: b.primary_color }} title={b.primary_color} /><span className="h-5 w-5 rounded" style={{ background: b.sidebar_color }} title={b.sidebar_color} /></span></td>
                  <td className="td">{b.is_active ? <span className="badge bg-emerald-50 text-emerald-700">Active</span> : <span className="badge bg-slate-100 text-slate-600">Off</span>}</td>
                  <td className="td text-right"><BrandButton brand={b} companies={opts} plans={planOpts} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="px-3 py-6 text-center text-sm text-slate-500">No brands yet. Every company uses the Lead Box look.</div>}
        </div>
      </Panel>
    </>
  );
}

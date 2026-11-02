"use client";
/* eslint-disable @next/next/no-img-element -- user-uploaded logos */
import { useState } from "react";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveBrand, saveMyBrand, setCompanyBrand, addClientCompany } from "@/lib/actions/brands";

export type BrandRow = {
  id: string; name: string; domain: string | null; logo_url: string | null; icon_url: string | null;
  primary_color: string; sidebar_color: string; tagline: string | null; support_email: string | null; support_phone: string | null;
  website: string | null; hide_powered_by: boolean; owner_company_id: string | null; default_plan_id: string | null; is_active: boolean;
};
type Opt = { id: string; name: string };

/** Live preview of the sidebar + button with the chosen colours and logo. */
function Preview({ name, logo, primary, sidebar }: { name: string; logo: string | null; primary: string; sidebar: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 text-xs" aria-label="Preview">
      <div className="flex h-10 items-center bg-white px-3">
        {logo ? <img src={logo} alt="" className="h-6 w-auto max-w-[8rem] object-contain" /> : <span className="font-bold text-slate-800">{name || "Your brand"}</span>}
      </div>
      <div className="flex">
        <div className="w-24 space-y-1 p-2" style={{ background: sidebar }}>
          <div className="h-2 w-16 rounded bg-white/40" /><div className="h-2 w-12 rounded bg-white/20" /><div className="h-2 w-14 rounded bg-white/20" />
        </div>
        <div className="flex flex-1 items-center gap-2 bg-slate-50 p-3">
          <span className="rounded-md px-2.5 py-1 font-medium text-white" style={{ background: primary }}>Save</span>
          <span className="font-medium" style={{ color: primary }}>Link</span>
        </div>
      </div>
    </div>
  );
}

function LookFields({ b }: { b?: Partial<BrandRow> }) {
  const [name, setName] = useState(b?.name ?? "");
  const [primary, setPrimary] = useState(b?.primary_color ?? "#15803d");
  const [sidebar, setSidebar] = useState(b?.sidebar_color ?? "#0b1f3a");
  const [logo, setLogo] = useState<string | null>(b?.logo_url ?? null);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand name"><input className="input" name="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Tagline (login page)"><input className="input" name="tagline" maxLength={120} defaultValue={b?.tagline ?? ""} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Logo" hint="PNG / JPG / WEBP, under 1 MB. Wide logos look best.">
          <input className="input" type="file" name="logo" accept="image/png,image/jpeg,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogo(URL.createObjectURL(f)); }} />
          {b?.logo_url && <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="logo_remove" onChange={(e) => setLogo(e.target.checked ? null : b.logo_url ?? null)} /> Remove logo</label>}
        </Field>
        <Field label="Browser tab icon (optional)" hint="Square PNG or ICO.">
          <input className="input" type="file" name="icon" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/webp" />
          {b?.icon_url && <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="icon_remove" /> Remove icon</label>}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Main colour (buttons, links)">
          <div className="flex gap-2"><input type="color" className="h-9 w-12 cursor-pointer rounded border" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            <input className="input" name="primary_color" value={primary} onChange={(e) => setPrimary(e.target.value)} pattern="#[0-9a-fA-F]{6}" required /></div>
        </Field>
        <Field label="Sidebar colour">
          <div className="flex gap-2"><input type="color" className="h-9 w-12 cursor-pointer rounded border" value={sidebar} onChange={(e) => setSidebar(e.target.value)} />
            <input className="input" name="sidebar_color" value={sidebar} onChange={(e) => setSidebar(e.target.value)} pattern="#[0-9a-fA-F]{6}" required /></div>
        </Field>
      </div>
      <Preview name={name} logo={logo} primary={primary} sidebar={sidebar} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Support phone"><input className="input" name="support_phone" maxLength={30} defaultValue={b?.support_phone ?? ""} /></Field>
        <Field label="Support email"><input className="input" name="support_email" type="email" maxLength={200} defaultValue={b?.support_email ?? ""} /></Field>
        <Field label="Website"><input className="input" name="website" type="url" placeholder="https://" maxLength={500} defaultValue={b?.website ?? ""} /></Field>
      </div>
    </>
  );
}

// ------------------------------------------------------------- platform

export function BrandButton({ brand, companies, plans }: { brand?: BrandRow; companies: Opt[]; plans: Opt[] }) {
  return (
    <ModalButton label={brand ? "Edit" : "+ New brand"} title={brand ? `Edit ${brand.name}` : "New white-label brand"} className={brand ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {() => (
        <ActionForm action={saveBrand}>
          <input type="hidden" name="id" value={brand?.id ?? ""} />
          <LookFields b={brand} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Custom domain" hint="e.g. crm.partner.com — also add it in Vercel (see note on the page).">
              <input className="input" name="domain" maxLength={200} placeholder="crm.partner.com" defaultValue={brand?.domain ?? ""} autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Partner company (reseller)" hint="Its admins can edit this look and add clients.">
              <select className="input" name="owner_company_id" defaultValue={brand?.owner_company_id ?? ""}>
                <option value="">— Platform only —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Plan for new clients">
              <select className="input" name="default_plan_id" defaultValue={brand?.default_plan_id ?? ""}>
                <option value="">First public plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="hide_powered_by" defaultChecked={brand?.hide_powered_by ?? false} /> Hide &quot;Powered by Lead Box&quot;</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={brand?.is_active ?? true} /> Active</label>
          </div>
          <Submit>{brand ? "Save brand" : "Create brand"}</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function CompanyBrandForm({ companyId, brands, current }: { companyId: string; brands: Opt[]; current: string | null }) {
  return (
    <ActionForm action={setCompanyBrand} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="company_id" value={companyId} />
      <label className="min-w-40 flex-1"><span className="label">White-label brand</span>
        <select className="input" name="brand_id" defaultValue={current ?? ""}>
          <option value="">Lead Box (default look)</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <Submit className="btn-ghost">Apply</Submit>
    </ActionForm>
  );
}

// ------------------------------------------------------------- reseller

export function MyBrandForm({ brand }: { brand: BrandRow }) {
  return (
    <ActionForm action={saveMyBrand}>
      <LookFields b={brand} />
      <Submit>Save branding</Submit>
    </ActionForm>
  );
}

export function AddClientButton() {
  return (
    <ModalButton label="+ Add client" title="Add a client company">
      {() => (
        <ActionForm action={addClientCompany} resetOnOk>
          <Field label="Company name"><input className="input" name="company" required maxLength={120} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admin name"><input className="input" name="name" required maxLength={120} /></Field>
            <Field label="Admin mobile"><input className="input" name="phone" type="tel" placeholder="+91 98765 43210" /></Field>
          </div>
          <Field label="Admin email (login)"><input className="input" name="email" type="email" required autoCapitalize="none" spellCheck={false} /></Field>
          <Field label="Password" hint="Leave empty to generate one; it is shown once after saving."><input className="input" name="password" type="text" minLength={8} autoComplete="off" /></Field>
          <p className="text-xs text-slate-500">The client starts on a free trial and sees your logo and colours.</p>
          <Submit pendingText="Creating…">Create client</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

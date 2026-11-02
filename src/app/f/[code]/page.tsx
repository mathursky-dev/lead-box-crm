import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { viewFields, type FormFieldDef, type CustomField } from "@/lib/settings-shared";
import { PublicForm } from "./public-form";

export const dynamic = "force-dynamic";

async function load(code: string) {
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) return null;
  const db = createAdminClient();
  const { data: fm } = await db.from("lb_forms").select("company_id,name,description,bg_color,font,title_size,label_size,fields,is_active").eq("code", code.toUpperCase()).maybeSingle();
  if (!fm) return null;
  const { data: cf } = await db.from("lb_custom_fields").select("id,key,label,field_type,options,is_required,sort_order,is_active").eq("company_id", fm.company_id).eq("is_active", true);
  return { fm, fields: viewFields(fm.fields as FormFieldDef[], (cf ?? []) as CustomField[]) };
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const r = await load((await params).code);
  return { title: r?.fm.name ?? "Form", robots: { index: false } };
}

export default async function FormPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await load(code);
  if (!r) notFound();
  const { fm, fields } = r;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-lg">
        {fm.is_active ? (
          <PublicForm code={code.toUpperCase()} fields={fields}
            look={{ name: fm.name, description: fm.description, bg_color: fm.bg_color, font: fm.font, title_size: fm.title_size, label_size: fm.label_size }} />
        ) : (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow">This form is not accepting responses right now.</div>
        )}
      </div>
    </main>
  );
}

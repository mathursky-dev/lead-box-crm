"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/util";
import type { FormFieldDef } from "@/lib/settings-shared";

export type SubmitState = { error?: string; done?: boolean; thankYou?: string; redirect?: string | null } | undefined;

// Best-effort burst guard per server instance (public, unauthenticated endpoint).
const hits = new Map<string, number[]>();
function tooMany(ip: string) {
  const now = Date.now(), win = hits.get(ip)?.filter((t) => now - t < 60_000) ?? [];
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();
  return win.length > 8;
}

/** Public lead form (/f/<code>) submission → lb_submit_form (service role). */
export async function submitLeadForm(code: string, _: SubmitState, form: FormData): Promise<SubmitState> {
  if (String(form.get("website") ?? "")) return { done: true, thankYou: "Thank you!" }; // honeypot
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (tooMany(ip)) return { error: "Too many tries. Please wait a minute and try again." };
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { error: "Form not found." };

  const db = createAdminClient();
  const { data: fm } = await db.from("lb_forms").select("id,company_id,fields,thank_you,redirect_url,is_active").eq("code", code).maybeSingle();
  if (!fm || !fm.is_active) return { error: "This form is not accepting responses right now." };
  const [{ data: co }, { data: cfs }] = await Promise.all([
    db.from("lb_companies").select("default_country").eq("id", fm.company_id).maybeSingle(),
    db.from("lb_custom_fields").select("key,label,field_type").eq("company_id", fm.company_id).eq("is_active", true),
  ]);
  const cfType = new Map((cfs ?? []).map((c) => [`cf:${c.key}`, c.field_type as string]));

  const val = (k: string) => String(form.get(k) ?? "").trim().slice(0, 2000);
  const p: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  const answers: { label: string; value: string }[] = [];
  for (const f of (fm.fields ?? []) as FormFieldDef[]) {
    const type = cfType.get(f.key);
    if (f.key.startsWith("cf:") && !type) continue; // field removed since
    const v = type === "checkbox" ? (form.get(f.key) ? "true" : "false") : val(f.key);
    if ((f.required || f.key === "phone") && (!v || (type === "checkbox" && v !== "true"))) return { error: `Please fill “${f.label}”.` };
    if (!v) continue;
    if (f.key === "phone") {
      const e164 = normalizePhone(v, co?.default_country ?? "IN");
      if (!e164) return { error: "Please enter a valid mobile number." };
      p.phone_e164 = e164;
    } else if (f.key.startsWith("cf:")) custom[f.key.slice(3)] = v;
    else p[f.key] = v;
    answers.push({ label: f.label, value: type === "checkbox" ? (v === "true" ? "Yes" : "No") : v });
  }
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email))) return { error: "Please enter a valid email." };

  const { error } = await db.rpc("lb_submit_form", { p_code: code, p: { ...p, custom, answers } });
  if (error) {
    const m = error.message ?? "";
    return { error: /must be|invalid choice|Valid phone/i.test(m) ? m : "Could not send the form. Please try again." };
  }
  return { done: true, thankYou: fm.thank_you, redirect: fm.redirect_url };
}

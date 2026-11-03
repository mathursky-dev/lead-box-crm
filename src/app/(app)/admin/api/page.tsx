import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { ApiAdmin, type KeyRow, type HookRow, type DeliveryRow } from "./ui";

export const metadata = { title: "API & webhooks" };

export default async function ApiPage() {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="Server is not configured (service role key)." />;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "wacrm.leadboxs.in"}`;
  const db = createAdminClient();
  const [keys, hooks, del] = await Promise.all([
    db.from("lb_api_keys").select("id,name,prefix,scopes,created_at,last_used_at,revoked_at,expires_at").eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(50),
    db.from("lb_webhooks").select("id,name,url,events,is_active,last_status,last_error,last_sent_at,created_at").eq("company_id", profile.company_id).order("created_at"),
    db.from("lb_webhook_deliveries").select("id,webhook_id,event,status,attempts,response_code,error,created_at,sent_at").eq("company_id", profile.company_id).order("id", { ascending: false }).limit(30),
  ]);
  const err = keys.error ?? hooks.error ?? del.error;
  if (err) return <ErrorBox message={err.message} />;
  return (
    <>
      <PageHeader icon="code" title="API & webhooks" sub="Connect your website, ERP, Zapier or any software: create leads and read them with an API key, and get a call on your URL when a lead is created, assigned or its status changes." />
      <ApiAdmin origin={origin} keys={(keys.data ?? []) as KeyRow[]} hooks={(hooks.data ?? []) as HookRow[]} deliveries={(del.data ?? []) as DeliveryRow[]} />
    </>
  );
}

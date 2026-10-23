import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Panel, Notice } from "../ui";
import { SendForm } from "./send-form";

export const metadata = { title: "Send · WhatsApp" };

export default async function Send({ searchParams }: { searchParams: Promise<{ phone?: string; template?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data: numbers }, { data: templates }] = await Promise.all([
    sb.from("lb_wa_numbers").select("id,label,display_phone,waba_id,status").eq("is_active", true).order("label"),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED").order("name"),
  ]);
  if (!can(profile, "chats.send")) return <Notice tone="red">You do not have permission to send WhatsApp messages.</Notice>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Send a message" icon="send">
        {!numbers?.length ? <Notice>Connect a WhatsApp number first.</Notice> : (
          <SendForm numbers={numbers} defaultPhone={sp.phone} defaultTemplate={sp.template}
            templates={(templates ?? []).map((t) => ({ name: t.name, language: t.language, category: t.category, waba_id: t.waba_id,
              body: (t.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text ?? "" }))} />
        )}
      </Panel>
      <Panel title="How sending works" icon="alert">
        <ul className="list-disc space-y-2 pl-4 text-sm text-slate-600">
          <li><b>Template</b>: works any time. Needed to start a conversation or when the customer has not written in 24 hours.</li>
          <li><b>Free text</b>: only inside the 24-hour window after the customer’s last message.</li>
          <li>New numbers become a contact and a lead automatically (normal allocation rules apply).</li>
          <li>Marketing templates are blocked for opted-out contacts.</li>
          <li>Delivery and read ticks show up in Live chat and Reports.</li>
        </ul>
      </Panel>
    </div>
  );
}

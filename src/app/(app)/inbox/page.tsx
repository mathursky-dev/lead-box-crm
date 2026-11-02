import Link from "next/link";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { Inbox } from "./inbox";
import { SocialInbox } from "./social";
import { aiConfigured } from "@/lib/ai";

export const metadata = { title: "Inbox" };

type Ch = "whatsapp" | "instagram" | "messenger";

/** Instagram / Messenger channels the company turned on (none before their SQL is applied). */
async function socialChannels(companyId: string): Promise<Ch[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient().from("lb_fb_pages").select("messenger_enabled,ig_enabled").eq("company_id", companyId);
  if (error || !data) return [];
  return [...(data.some((r) => r.ig_enabled) ? ["instagram" as const] : []), ...(data.some((r) => r.messenger_enabled) ? ["messenger" as const] : [])];
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; ch?: string; t?: string }> }) {
  const { c, ch, t } = await searchParams;
  const { profile } = await requireProfile();
  const refs = await loadRefs();
  const sb = await createClient();
  const social = await socialChannels(profile.company_id);
  const channel: Ch = social.includes(ch as Ch) ? (ch as Ch) : "whatsapp";
  let tabs: React.ReactNode = null;
  if (social.length) {
    const { data: unread } = await sb.from("lb_social_threads").select("channel,unread_count").eq("company_id", profile.company_id).gt("unread_count", 0).limit(1000);
    const count = (k: Ch) => (unread ?? []).filter((r) => r.channel === k).reduce((n, r) => n + (r.unread_count as number), 0);
    const items: { key: Ch; label: string; dot: string }[] = [
      { key: "whatsapp", label: "WhatsApp", dot: "bg-[#25D366]" },
      ...social.map((k) => ({ key: k, label: k === "instagram" ? "Instagram" : "Messenger", dot: k === "instagram" ? "bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600" : "bg-[#0084FF]" })),
    ];
    tabs = (
      <nav aria-label="Inbox channels" className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5">
        {items.map((x) => {
          const n = x.key === "whatsapp" ? 0 : count(x.key);
          return (
            <Link key={x.key} href={x.key === "whatsapp" ? "/inbox" : `/inbox?ch=${x.key}`} aria-current={channel === x.key ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${channel === x.key ? "bg-navy-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${x.dot}`} />{x.label}
              {n > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{n}</span>}
            </Link>
          );
        })}
      </nav>
    );
  }
  if (channel !== "whatsapp") {
    return (
      <div className="flex h-full flex-col">
        {tabs}
        <div className="min-h-0 flex-1">
          <SocialInbox key={channel} channel={channel} initialId={t && /^[0-9a-f-]{36}$/i.test(t) ? t : null}
            me={{ id: profile.id, manager: isManager(profile), canSend: can(profile, "chats.send"), canTransfer: can(profile, "chats.transfer"), canLead: can(profile, "leads.create") }}
            users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} />
        </div>
      </div>
    );
  }
  const [{ data: quick }, { data: templates }] = await Promise.all([
    sb.from("lb_quick_replies").select("shortcut,title,body").order("shortcut"),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED").order("name"),
  ]);
  const { data: co } = await sb.from("lb_companies").select("ai_enabled").eq("id", profile.company_id).single();
  const aiOn = co?.ai_enabled && aiConfigured();
  const { data: numbers } = await sb.from("lb_wa_numbers").select("id,label,waba_id,status,last_error,is_active").order("label");
  const inbox = (
    <Inbox
      me={{ id: profile.id, manager: isManager(profile), canSend: can(profile, "chats.send"), canTransfer: can(profile, "chats.transfer"), canAi: can(profile, "ai.use") && Boolean(aiOn), canComplaints: can(profile, "complaints.manage"), canPause: can(profile, "nurture.view") }}
      initialId={c && /^[0-9a-f-]{36}$/i.test(c) ? c : null}
      users={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))}
      tags={refs.tags}
      statuses={refs.statuses.filter((s) => s.is_active)}
      numbers={numbers ?? []}
      quick={quick ?? []}
      templates={(templates ?? []).map((t) => ({ ...t, body: ((t.components as { type: string; text?: string }[]).find((x) => x.type === "BODY")?.text) ?? "" }))}
    />
  );
  if (!tabs) return inbox;
  return (
    <div className="flex h-full flex-col">
      {tabs}
      <div className="min-h-0 flex-1">{inbox}</div>
    </div>
  );
}

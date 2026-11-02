"use server";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { aiConfigured } from "@/lib/ai";
import type { ChatContext } from "@/app/(app)/inbox/inbox";

// Everything the inbox chat panel needs, loaded on demand when a chat popup opens
// (mirrors the inbox page).
export async function getChatContext(): Promise<ChatContext> {
  const { profile } = await requireProfile();
  const refs = await loadRefs();
  const sb = await createClient();
  const [{ data: quick }, { data: templates }, { data: co }, { data: numbers }] = await Promise.all([
    sb.from("lb_quick_replies").select("shortcut,title,body").order("shortcut"),
    sb.from("lb_wa_templates").select("name,language,category,waba_id,components").eq("status", "APPROVED").order("name"),
    sb.from("lb_companies").select("ai_enabled").eq("id", profile.company_id).single(),
    sb.from("lb_wa_numbers").select("id,label,waba_id,status,last_error,is_active").order("label"),
  ]);
  const aiOn = co?.ai_enabled && aiConfigured();
  return {
    me: { id: profile.id, manager: isManager(profile), canSend: can(profile, "chats.send"), canTransfer: can(profile, "chats.transfer"), canAi: can(profile, "ai.use") && Boolean(aiOn), canComplaints: can(profile, "complaints.manage"), canPause: can(profile, "nurture.view") },
    users: refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name })),
    tags: refs.tags,
    statuses: refs.statuses.filter((s) => s.is_active),
    numbers: numbers ?? [],
    quick: quick ?? [],
    templates: (templates ?? []).map((t) => ({ ...t, body: ((t.components as { type: string; text?: string }[]).find((x) => x.type === "BODY")?.text) ?? "" })),
  };
}

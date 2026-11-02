"use server";
import { requireProfile, isAdmin, can, ROLE_LABEL } from "@/lib/auth";
import { answerHelp, aiConfigured, AiError, type HelpTurn } from "@/lib/ai";
import { visibleFeatures, searchFeatures, guideText } from "@/lib/feature-guide";
import { rateLimit } from "./auth";

export type HelpAnswer = { text?: string; ai: boolean; error?: string; matches?: { id: string; title: string; href: string }[] };

/** Help bot: AI answer from the feature guide, or the best-matching guides when AI is not available. */
export async function askHelp(question: string, history: HelpTurn[] = []): Promise<HelpAnswer> {
  const q = String(question ?? "").trim().slice(0, 1000);
  if (!q) return { ai: false, error: "Type a question." };
  const { profile, features } = await requireProfile();
  const list = visibleFeatures({ admin: isAdmin(profile), superAdmin: profile.role === "super_admin", reports: can(profile, "reports.view"), features });
  const matches = searchFeatures(list, q, 3).map((f) => ({ id: f.id, title: f.title, href: f.href }));
  if (!aiConfigured() || !(await rateLimit(`help:${profile.id}`, 40, 3600))) return { ai: false, matches };
  try {
    const who = `${ROLE_LABEL[profile.role]}${isAdmin(profile) ? " (admin)" : ""}`;
    const turns = (Array.isArray(history) ? history : []).filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.text === "string");
    const text = await answerHelp(guideText(list), who, turns, q);
    return { text, ai: true, matches };
  } catch (e) {
    return { ai: false, matches, error: e instanceof AiError ? e.message : "AI request failed." };
  }
}

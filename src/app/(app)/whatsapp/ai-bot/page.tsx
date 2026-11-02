import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { aiConfigured } from "@/lib/ai";
import { transcribeConfigured } from "@/lib/transcribe";
import { DEFAULT_AI_BOT, type AiBotSettings, type AiFaqRow } from "@/lib/ai-faq-bot-shared";
import { Kpi, Panel, EmptyState, Notice } from "../ui";
import { SubTabs } from "../tabs";
import { agoIso } from "../data";
import { SettingsForm, FaqForm, BulkAdd, FaqRowActions, TestBot } from "./forms";

export const metadata = { title: "AI FAQ bot · WhatsApp" };

export default async function AiBotPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "faqs";
  const { profile, features } = await requireProfile();
  const admin = isAdmin(profile);
  const sb = await createClient();
  const since = agoIso(7 * 86400000);
  const [st, fq, { data: numbers }, { data: users }, { data: events }, { data: co }] = await Promise.all([
    sb.from("lb_ai_bot_settings").select("*").eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_ai_faqs").select("id,kind,question,answer,price,unit,category,is_active,sort,hit_count").eq("company_id", profile.company_id).order("sort").order("question").limit(2000),
    sb.from("lb_wa_numbers").select("id,label").eq("company_id", profile.company_id).order("label"),
    sb.from("lb_profiles").select("id,full_name").eq("company_id", profile.company_id).eq("is_active", true).order("full_name"),
    sb.from("lb_wa_bot_events").select("id,kind,body,detail,conversation_id,created_at").eq("company_id", profile.company_id).in("kind", ["ai_reply", "ai_handover"])
      .gte("created_at", agoIso(30 * 86400000)).order("created_at", { ascending: false }).limit(500),
    sb.from("lb_companies").select("ai_enabled").eq("id", profile.company_id).maybeSingle(),
  ]);
  const sqlMissing = Boolean(st.error || fq.error);
  const s: AiBotSettings = { ...DEFAULT_AI_BOT, ...(st.data ?? {}) };
  const rows = (fq.data ?? []) as AiFaqRow[];
  const q = (sp.q ?? "").toLowerCase();
  const faqs = rows.filter((r) => r.kind === "faq" && (!q || `${r.question} ${r.answer} ${r.category ?? ""}`.toLowerCase().includes(q)));
  const prices = rows.filter((r) => r.kind === "price" && (!q || `${r.question} ${r.answer} ${r.category ?? ""}`.toLowerCase().includes(q)));
  const ev7 = (events ?? []).filter((e) => e.created_at >= since);
  const answered = ev7.filter((e) => e.kind === "ai_reply").length;
  const handed = ev7.filter((e) => e.kind === "ai_handover").length;
  const aiPlan = features.includes("ai");
  const blocker = !aiPlan ? "AI is not in your plan — upgrade from Billing to use the AI FAQ bot."
    : !aiConfigured() ? "The server has no AI key (ANTHROPIC_API_KEY) yet."
    : !co?.ai_enabled ? "AI is turned off for this company. Turn it on in Admin → Settings (Automation, AI & digests)." : null;

  return (
    <>
      {sqlMissing && <div className="mb-4"><Notice tone="red">AI FAQ bot database update is not applied yet. Run <b>20261102180000_lb_ai_faq_bot.sql</b> in Supabase first.</Notice></div>}
      {blocker && <div className="mb-4"><Notice>{blocker}</Notice></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="AI FAQ bot" value={<span className={`badge ${s.enabled && !blocker ? "bg-brand-100 text-brand-700" : "bg-slate-200"}`}>{s.enabled ? (blocker ? "On (blocked)" : "On") : "Off"}</span>}
          sub={s.hours_rule === "always" ? "answers 24x7" : `only ${s.hours_rule} business hours`} icon="sparkle" tone="violet" />
        <Kpi label="FAQs & prices" value={rows.filter((r) => r.is_active).length} sub={`${rows.filter((r) => r.kind === "faq").length} FAQs · ${rows.filter((r) => r.kind === "price").length} price items`} icon="book" tone="slate" />
        <Kpi label="AI answers · 7 days" value={answered} sub="questions answered automatically" icon="send" tone="green" />
        <Kpi label="Handed to agents · 7 days" value={handed} sub={answered + handed ? `${Math.round((answered / (answered + handed)) * 100)}% answered by AI` : "—"} icon="agent" tone="amber" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Try it" icon="chat" tone="violet" sub="Type what a customer would write and see the bot's answer.">
          <TestBot disabled={blocker && blocker.includes("plan") ? blocker : !aiConfigured() ? "The server has no AI key yet." : undefined} />
        </Panel>
        <Panel title="How it works" icon="flow">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Customer writes (or sends a voice note) on WhatsApp.</li>
            <li>Your <Link href="/whatsapp/flows" className="text-violet-700">chatbot flows</Link> and <Link href="/whatsapp/chatbots" className="text-violet-700">keyword bots</Link> run first, exactly as before.</li>
            <li>If none of them matched, the AI FAQ bot answers from your FAQs and price list — in the customer&apos;s language (Hindi / Hinglish / English).</li>
            <li>Not in your data, wants a person, order / payment, or a complaint → your handover message goes out and the chat is given to an agent (it stays quiet in that chat for {s.handover_pause_hours} h).</li>
            <li>When an agent replies in a chat, all bots pause there for 2 hours.</li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">Voice notes: {transcribeConfigured() ? "transcribed to text automatically, so the bot answers them too." : "voice-to-text key not set on the server yet."}</p>
        </Panel>
      </div>

      <SubTabs base="/whatsapp/ai-bot" current={tab} tabs={[
        { key: "faqs", label: "FAQs", icon: "book", count: rows.filter((r) => r.kind === "faq").length },
        { key: "prices", label: "Price list", icon: "rupee", count: rows.filter((r) => r.kind === "price").length },
        { key: "settings", label: "Settings", icon: "gear" },
        { key: "activity", label: "Activity", icon: "clock" }]} />

      {(tab === "faqs" || tab === "prices") && (() => {
        const kind = tab === "faqs" ? "faq" as const : "price" as const;
        const list = kind === "faq" ? faqs : prices;
        return (
          <Panel title={kind === "faq" ? "Your FAQs" : "Your price list"} icon={kind === "faq" ? "book" : "rupee"}
            actions={admin ? <div className="flex gap-2"><BulkAdd kind={kind} /><FaqForm kind={kind} /></div> : null}>
            <form className="mb-3"><input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search…" /></form>
            {!list.length ? (
              <EmptyState icon={kind === "faq" ? "book" : "rupee"} title={kind === "faq" ? "No FAQs yet" : "No price list yet"}
                action={admin ? <div className="flex gap-2"><BulkAdd kind={kind} /><FaqForm kind={kind} /></div> : null}>
                {kind === "faq" ? "Add the questions customers ask most (timings, location, delivery, payment, returns…). The bot answers only from these." : "Add your products / services with prices. Store products are used too (Settings tab)."}
              </EmptyState>
            ) : kind === "faq" ? (
              <div className="space-y-2">
                {list.map((r) => (
                  <div key={r.id} className={`rounded-lg border p-3 ${r.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 max-w-3xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-navy-900">{r.question}</span>
                          {r.category && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{r.category}</span>}
                          {!r.is_active && <span className="badge bg-slate-200">off</span>}
                          <span className="text-xs text-slate-500">used {r.hit_count}×</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.answer}</div>
                      </div>
                      {admin && <div className="flex gap-1"><FaqForm kind="faq" row={r} /><FaqRowActions id={r.id} active={r.is_active} label={r.question} /></div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th">Category</th><th className="th text-right">Price</th><th className="th">Note</th><th className="th">Used</th><th className="th"></th></tr></thead>
                <tbody className="divide-y">{list.map((r) => (
                  <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                    <td className="td font-medium">{r.question}</td>
                    <td className="td text-xs">{r.category}</td>
                    <td className="td text-right">{r.price != null ? `₹${Number(r.price).toLocaleString("en-IN")}` : "on request"}{r.unit ? <span className="text-xs text-slate-500"> / {r.unit}</span> : null}</td>
                    <td className="td max-w-xs truncate text-xs">{r.answer}</td>
                    <td className="td text-xs">{r.hit_count}×</td>
                    <td className="td">{admin && <div className="flex justify-end gap-1"><FaqForm kind="price" row={r} /><FaqRowActions id={r.id} active={r.is_active} label={r.question} /></div>}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
        );
      })()}

      {tab === "settings" && (
        <Panel title="Bot settings" icon="gear">
          {admin ? <SettingsForm s={s} aiPlan={aiPlan} numbers={(numbers ?? []).map((n) => ({ id: n.id, label: n.label }))} users={(users ?? []).map((u) => ({ id: u.id, label: u.full_name ?? "User" }))} />
            : <p className="text-sm text-slate-500">Only admins can change the AI FAQ bot.</p>}
        </Panel>
      )}

      {tab === "activity" && (
        <Panel title="AI bot activity · 30 days" icon="clock">
          {!events?.length ? <p className="text-sm text-slate-500">No AI bot activity yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Result</th><th className="th">Customer wrote</th><th className="th">Why</th><th className="th"></th></tr></thead>
              <tbody className="divide-y">{events.slice(0, 200).map((e) => (
                <tr key={e.id}>
                  <td className="td text-xs">{fmtDateTime(e.created_at)}</td>
                  <td className="td"><span className={`badge ${e.kind === "ai_reply" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-800"}`}>{e.kind === "ai_reply" ? "answered" : "handed over"}</span></td>
                  <td className="td max-w-xs truncate">{e.body}</td>
                  <td className="td max-w-xs truncate text-xs text-slate-500">{e.detail}</td>
                  <td className="td">{e.conversation_id && <Link href={`/inbox?c=${e.conversation_id}`} className="text-xs text-brand-700 hover:underline">chat</Link>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
      )}
    </>
  );
}

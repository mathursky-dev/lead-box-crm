"use client";
import { useState, useTransition } from "react";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveAiBotSettings, saveFaq, bulkAddFaqs, toggleFaq, deleteFaq, testAiBot, type AiTestOut } from "@/lib/actions/ai-bot";
import type { AiBotSettings, AiFaqRow } from "@/lib/ai-faq-bot-shared";

type Opt = { id: string; label: string };

export function SettingsForm({ s, numbers, users, aiPlan }: { s: AiBotSettings; numbers: Opt[]; users: Opt[]; aiPlan: boolean }) {
  return (
    <ActionForm action={saveAiBotSettings}>
      <label className="flex items-start gap-2 rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={s.enabled} disabled={!aiPlan && !s.enabled} className="mt-1" />
        <span><b>AI FAQ bot ON</b> — answers customers on WhatsApp 24x7 from your FAQs and price list. When it can&apos;t answer (or the customer asks for a person, wants to order/pay, or complains) it sends your handover message and gives the chat to an agent.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bot name" hint="Used in its tone, e.g. “Riya from Lead Box”."><input className="input" name="bot_name" defaultValue={s.bot_name} maxLength={60} required /></Field>
        <Field label="When should it answer?">
          <select className="input" name="hours_rule" defaultValue={s.hours_rule}>
            <option value="always">24x7 (any time)</option>
            <option value="outside">Only outside business hours</option>
            <option value="inside">Only inside business hours</option>
          </select>
        </Field>
        <Field label="WhatsApp number">
          <select className="input" name="number_id" defaultValue={s.number_id ?? ""}>
            <option value="">All numbers</option>{numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </Field>
        <Field label="Give handed-over chats to" hint="Only when the chat has no owner yet.">
          <select className="input" name="handover_assign_to" defaultValue={s.handover_assign_to ?? ""}>
            <option value="">Keep as is (unassigned chats stay in the queue)</option>{users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Handover message" hint="Sent when the bot passes the chat to your team.">
        <textarea className="input" name="handover_message" rows={2} maxLength={1000} required defaultValue={s.handover_message} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stay quiet after handover (hours)"><input className="input" type="number" name="handover_pause_hours" min={1} max={168} defaultValue={s.handover_pause_hours} /></Field>
        <Field label="Max AI replies per chat / day"><input className="input" type="number" name="max_replies_per_chat" min={1} max={100} defaultValue={s.max_replies_per_chat} /></Field>
        <Field label="Max AI replies per day (company)"><input className="input" type="number" name="daily_limit" min={1} max={5000} defaultValue={s.daily_limit} /></Field>
      </div>
      <Field label="Extra instructions (optional)" hint="Tone and style only, e.g. “Always reply in Hinglish, be short, end with: call 98xxxx for urgent help”. The bot still never invents prices.">
        <textarea className="input" name="instructions" rows={3} maxLength={2000} defaultValue={s.instructions ?? ""} />
      </Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="use_products" defaultChecked={s.use_products} className="mt-1" />
        <span>Also use my <b>Store products</b> and their prices.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="use_knowledge" defaultChecked={s.use_knowledge} className="mt-1" />
        <span>Also use approved <b>Knowledge articles</b> (Nurture → Knowledge).</span></label>
      <Submit>Save bot settings</Submit>
    </ActionForm>
  );
}

export function FaqForm({ kind, row }: { kind: "faq" | "price"; row?: AiFaqRow }) {
  const price = kind === "price";
  return (
    <ModalButton label={row ? "Edit" : price ? "+ Add price" : "+ Add FAQ"} title={row ? "Edit" : price ? "Add price list item" : "Add FAQ"} className={row ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {(close) => (
        <ActionForm action={saveFaq} onOk={close}>
          <input type="hidden" name="kind" value={kind} />
          {row && <input type="hidden" name="id" value={row.id} />}
          {price ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Item / service"><input className="input" name="question" required maxLength={500} defaultValue={row?.question} placeholder="e.g. Facial – Gold" /></Field>
                <Field label="Category (optional)"><input className="input" name="category" maxLength={60} defaultValue={row?.category ?? ""} /></Field>
                <Field label="Price (₹)" hint="Leave empty for “on request”."><input className="input" name="price" type="number" step="0.01" min={0} defaultValue={row?.price ?? ""} /></Field>
                <Field label="Per (optional)"><input className="input" name="unit" maxLength={40} defaultValue={row?.unit ?? ""} placeholder="session / kg / month" /></Field>
              </div>
              <Field label="Note (optional)" hint="Offers, what's included, GST, delivery etc."><textarea className="input" name="answer" rows={3} maxLength={4000} defaultValue={row?.answer} /></Field>
            </>
          ) : (
            <>
              <Field label="Customer question"><input className="input" name="question" required maxLength={500} defaultValue={row?.question} placeholder="e.g. Do you deliver to Jaipur?" /></Field>
              <Field label="Answer"><textarea className="input" name="answer" rows={5} required maxLength={4000} defaultValue={row?.answer} /></Field>
              <Field label="Category (optional)"><input className="input" name="category" maxLength={60} defaultValue={row?.category ?? ""} placeholder="Delivery, Payment, Timing…" /></Field>
            </>
          )}
          <Field label="Order"><input className="input w-28" name="sort" type="number" min={0} max={9999} defaultValue={row?.sort ?? 100} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={row ? row.is_active : true} /> Active</label>
          <Submit>{row ? "Save" : "Add"}</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function BulkAdd({ kind }: { kind: "faq" | "price" }) {
  const price = kind === "price";
  return (
    <ModalButton label="Bulk paste" title={price ? "Paste your price list" : "Paste your FAQs"} className="btn-ghost" wide>
      {(close) => (
        <ActionForm action={bulkAddFaqs} onOk={close}>
          <input type="hidden" name="kind" value={kind} />
          <Field label={price ? "One item per line: Item | Price | Per | Note" : "Q: / A: blocks, or one “question | answer” per line"}
            hint={price ? "Copy straight from Excel (tab separated) also works. Up to 500 lines." : "Up to 500 FAQs at once."}>
            <textarea className="input font-mono text-xs" name="text" rows={12} required
              placeholder={price ? "Gold facial | 1499 | session | includes cleanup\nHair spa | 999 | session\nBridal package | 25000 | | advance 30%" : "Q: What are your timings?\nA: Mon–Sat, 10 AM to 8 PM.\n\nQ: Do you have parking?\nA: Yes, free parking for 2-wheelers and cars."} />
          </Field>
          <Submit>Add all</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function FaqRowActions({ id, active, label }: { id: string; active: boolean; label: string }) {
  return (
    <>
      <ActionButton action={() => toggleFaq(id, !active)}>{active ? "Turn off" : "Turn on"}</ActionButton>
      <ActionButton action={() => deleteFaq(id)} confirm={`Delete “${label.slice(0, 60)}”?`}>Delete</ActionButton>
    </>
  );
}

export function TestBot({ disabled }: { disabled?: string }) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<AiTestOut | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await testAiBot(text))); }}>
      <div className="flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. gold facial kitne ka hai? / kya aap Sunday open ho?" maxLength={1000} required />
        <button className="btn-primary shrink-0" disabled={pending || !!disabled}>{pending ? "Thinking…" : "Test"}</button>
      </div>
      <p className="text-xs text-slate-500">{disabled ?? "Dry run — nothing is sent to any customer. Works even while the bot is off."}</p>
      {res?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{res.error}</div>}
      {res?.reply && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${res.action === "answer" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-800"}`}>{res.action === "answer" ? "AI answers" : "Hands over to agent"}</span>
            {res.reason && <span className="text-xs text-slate-500">{res.reason}</span>}
          </div>
          <div className="whitespace-pre-wrap rounded-lg bg-[#e7f8ee] p-2 text-sm text-slate-800">{res.reply}</div>
          {!!res.used?.length && <div className="text-xs text-slate-500">Used: {res.used.join(" · ")}</div>}
        </div>
      )}
    </form>
  );
}

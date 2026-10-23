"use client";
import { useState, useTransition } from "react";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveBot, toggleBot, deleteBot, testBotMessage } from "@/lib/actions/wa";
import type { WaBot } from "@/lib/wa";

export const BOT_LIBRARY: Omit<WaBot, "id" | "is_active" | "reply_count" | "number_id">[] = [
  { name: "Welcome", keywords: ["hi", "hello", "hey", "namaste", "hii"], match_type: "exact", hours_rule: "always", priority: 10,
    reply: "Hello! 👋 Welcome. How can we help you today?\n\nReply:\n1️⃣ PRICE – price list\n2️⃣ TIMING – working hours\n3️⃣ AGENT – talk to our team" },
  { name: "Price list", keywords: ["price", "rate", "cost", "kitna", "charges", "1"], match_type: "contains", hours_rule: "always", priority: 20,
    reply: "Here is our latest price list: <add link or details>.\nReply AGENT to talk to our team." },
  { name: "Working hours", keywords: ["timing", "time", "open", "hours", "2"], match_type: "contains", hours_rule: "always", priority: 30,
    reply: "We are open Monday to Saturday, 9:00 AM – 6:00 PM." },
  { name: "Talk to agent", keywords: ["agent", "human", "call me", "callback", "3"], match_type: "contains", hours_rule: "always", priority: 40,
    reply: "Sure! Our team will reply here shortly. 🙏" },
  { name: "Location", keywords: ["address", "location", "where", "map"], match_type: "contains", hours_rule: "always", priority: 50,
    reply: "Our address: <add address>\nGoogle Maps: <add link>" },
];

type Num = { id: string; label: string };

export function BotForm({ numbers, bot, library }: { numbers: Num[]; bot?: WaBot; library?: boolean }) {
  const [preset, setPreset] = useState<(typeof BOT_LIBRARY)[number] | null>(null);
  const v = bot ?? preset;
  return (
    <ModalButton label={bot ? "Edit" : library ? "Add from library" : "+ New bot"} title={bot ? `Edit ${bot.name}` : "New keyword bot"} wide
      className={bot ? "btn-ghost btn-sm" : library ? "btn-ghost" : "btn-primary"}>
      {(close) => (
        <div className="space-y-3">
          {!bot && (
            <div>
              <span className="label">Start from the library</span>
              <div className="flex flex-wrap gap-1">{BOT_LIBRARY.map((b) => (
                <button key={b.name} type="button" onClick={() => setPreset(b)} className={`rounded-full border px-3 py-1 text-xs ${preset?.name === b.name ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300"}`}>{b.name}</button>
              ))}</div>
            </div>
          )}
          <ActionForm key={v?.name ?? "blank"} action={saveBot} onOk={close}>
            {bot && <input type="hidden" name="id" value={bot.id} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="input" name="name" required defaultValue={v?.name} maxLength={80} /></Field>
              <Field label="Order (lower runs first)"><input className="input" name="priority" type="number" min={1} max={9999} defaultValue={v?.priority ?? 100} /></Field>
              <Field label="Keywords" hint="Comma separated. Matching ignores case and punctuation.">
                <input className="input" name="keywords" required defaultValue={v?.keywords.join(", ")} placeholder="price, rate, cost" />
              </Field>
              <Field label="Match">
                <select className="input" name="match_type" defaultValue={v?.match_type ?? "contains"}>
                  <option value="contains">Message contains the word</option><option value="exact">Whole message is the keyword</option><option value="starts">Message starts with it</option>
                </select>
              </Field>
              <Field label="When">
                <select className="input" name="hours_rule" defaultValue={v?.hours_rule ?? "always"}>
                  <option value="always">Any time</option><option value="inside">Only inside business hours</option><option value="outside">Only outside business hours</option>
                </select>
              </Field>
              <Field label="Number">
                <select className="input" name="number_id" defaultValue={bot?.number_id ?? ""}>
                  <option value="">All numbers</option>{numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Reply" hint="Plain text, emojis and links are fine. Sent as a normal message inside the 24-hour window.">
              <textarea className="input" name="reply" rows={5} required maxLength={4096} defaultValue={v?.reply} />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={bot ? bot.is_active : true} /> Active</label>
            <Submit>{bot ? "Save bot" : "Create bot"}</Submit>
          </ActionForm>
        </div>
      )}
    </ModalButton>
  );
}

export function BotRowActions({ id, active, name }: { id: string; active: boolean; name: string }) {
  return (
    <>
      <ActionButton action={() => toggleBot(id, !active)}>{active ? "Turn off" : "Turn on"}</ActionButton>
      <ActionButton action={() => deleteBot(id)} confirm={`Delete bot “${name}”?`}>Delete</ActionButton>
    </>
  );
}

export function TestMessage() {
  const [text, setText] = useState("");
  const [res, setRes] = useState<{ result: string; reply?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <ModalButton label="Test a message" title="Test a message" className="btn-ghost">
      {() => (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await testBotMessage(text))); }}>
          <Field label="What the customer writes" hint="Dry run — nothing is sent.">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. price kitna hai?" required />
          </Field>
          <button className="btn-primary" disabled={pending}>{pending ? "…" : "Test"}</button>
          {res && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
              <div>{res.result}</div>
              {res.reply && <div className="whitespace-pre-wrap rounded-lg bg-[#e7f8ee] p-2 text-xs">{res.reply}</div>}
            </div>
          )}
        </form>
      )}
    </ModalButton>
  );
}

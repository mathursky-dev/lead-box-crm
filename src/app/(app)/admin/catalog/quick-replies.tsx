"use client";
import { ActionForm, ActionButton, Field, Submit } from "@/components/ui";
import { saveQuickReply, deleteQuickReply } from "@/lib/actions/admin";

export function QuickReplies({ items }: { items: { id: string; shortcut: string; title: string; body: string }[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Quick replies</h2>
      <ActionForm action={saveQuickReply} resetOnOk className="mb-4 grid gap-2 sm:grid-cols-[140px_200px_1fr_auto] sm:items-end">
        <Field label="Shortcut"><input className="input" name="shortcut" placeholder="price" required /></Field>
        <Field label="Title"><input className="input" name="title" required /></Field>
        <Field label="Message"><textarea className="input" name="body" rows={1} required /></Field>
        <Submit>Add</Submit>
      </ActionForm>
      {items.length === 0 ? <p className="text-sm text-slate-500">No quick replies. Agents type “/” in the chat box to use them.</p> : (
        <ul className="divide-y text-sm">
          {items.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-3 py-2">
              <div><span className="font-mono text-brand-700">/{q.shortcut}</span> <span className="font-medium">{q.title}</span>
                <div className="whitespace-pre-wrap text-slate-600">{q.body}</div></div>
              <ActionButton action={() => deleteQuickReply(q.id)} confirm={`Delete quick reply /${q.shortcut}?`}>Delete</ActionButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

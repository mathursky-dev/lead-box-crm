"use client";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveKnowledge, knowledgeAction } from "@/lib/actions/automation";

export function KnowledgeForm({ k }: { k?: { id: string; title: string; content: string } }) {
  return (
    <ModalButton label={k ? "Edit" : "+ Add entry"} title={k ? "Edit knowledge" : "New knowledge entry"} className={k ? "btn-ghost btn-sm" : "btn-primary"} wide>
      {(close) => (
        <ActionForm action={saveKnowledge} onOk={close}>
          {k && <input type="hidden" name="id" value={k.id} />}
          <Field label="Title"><input className="input" name="title" defaultValue={k?.title} required maxLength={200} /></Field>
          <Field label="Content" hint="Facts only. AI is told to answer only from approved entries and to say when it doesn't know.">
            <textarea className="input min-h-48" name="content" defaultValue={k?.content} required maxLength={20000} /></Field>
          <Submit>Save draft</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function KnowledgeButtons({ id, status }: { id: string; status: string }) {
  return (
    <>
      {status !== "approved" && <ActionButton action={() => knowledgeAction(id, "approve")} confirm="Approve? AI suggestions may then quote this entry.">Approve</ActionButton>}
      {status === "approved" && <ActionButton action={() => knowledgeAction(id, "draft")}>Unapprove</ActionButton>}
      <ActionButton action={() => knowledgeAction(id, "archive")} confirm="Archive this entry?">Archive</ActionButton>
    </>
  );
}

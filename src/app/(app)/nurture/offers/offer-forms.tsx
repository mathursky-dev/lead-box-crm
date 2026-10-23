"use client";
import { ActionForm, ActionButton, Field, ModalButton, Submit } from "@/components/ui";
import { saveOffer, offerAction } from "@/lib/actions/nurture";
import { toLocalInput } from "@/lib/dates";

type O = { id: string; name: string; description: string | null; code: string | null; valid_from: string; valid_to: string };

export function OfferForm({ offer }: { offer?: O }) {
  return (
    <ModalButton label={offer ? "Edit" : "+ New offer"} title={offer ? `Edit ${offer.name}` : "New offer"} className={offer ? "btn-ghost btn-sm" : "btn-primary"}>
      {(close) => (
        <ActionForm action={saveOffer} onOk={close}>
          {offer && <input type="hidden" name="id" value={offer.id} />}
          <Field label="Name"><input className="input" name="name" defaultValue={offer?.name} required /></Field>
          <Field label="Description"><textarea className="input" name="description" rows={2} defaultValue={offer?.description ?? ""} /></Field>
          <Field label="Coupon / offer code" hint="Available in templates as {{offer_code}}"><input className="input" name="code" defaultValue={offer?.code ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valid from (IST)"><input className="input" type="datetime-local" name="valid_from" required defaultValue={toLocalInput(offer?.valid_from)} /></Field>
            <Field label="Valid until (IST)"><input className="input" type="datetime-local" name="valid_to" required defaultValue={toLocalInput(offer?.valid_to)} /></Field>
          </div>
          <Submit>Save draft</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function OfferButtons({ id, status, manage, approve }: { id: string; status: string; manage: boolean; approve: boolean }) {
  return (
    <>
      {manage && (status === "draft" || status === "rejected") && <ActionButton action={() => offerAction(id, "submit")}>Submit</ActionButton>}
      {approve && status === "pending_approval" && (
        <>
          <ActionButton className="btn-primary btn-sm" action={() => offerAction(id, "approve")} confirm="Approve this offer for use in campaigns and journeys?">Approve</ActionButton>
          <ActionButton action={() => { const r = prompt("Reason for rejecting?"); return r ? offerAction(id, "reject", r) : Promise.resolve(undefined); }}>Reject</ActionButton>
        </>
      )}
    </>
  );
}

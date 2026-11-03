"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton, ActionForm, Field, Modal, Submit } from "@/components/ui";
import { deletePurchaseOrder, receivePurchaseOrder, recordVendorPayment, setPurchaseOrderStatus } from "@/lib/actions/purchases";
import { rupees } from "@/lib/store";
import { poLabel } from "@/lib/purchases";

type Po = { id: string; po_no: number; status: string; total: number; amount_paid: number; due: number };
type Left = { id: string; name: string; unit: string; left: number; tracked: boolean };

export function PoActions({ po, items, editable, today, waPhone, waText }: { po: Po; items: Left[]; editable: boolean; today: string; waPhone: string | null; waText: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"receive" | "pay" | null>(null);
  const canReceive = po.status === "ordered" || po.status === "partial" || po.status === "draft";
  const wa = `https://wa.me/${waPhone ?? ""}?text=${encodeURIComponent(waText)}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden">
      {po.status === "draft" && <ActionButton className="btn-primary btn-sm" action={() => setPurchaseOrderStatus(po.id, "ordered")}>Mark ordered</ActionButton>}
      {canReceive && items.length > 0 && <button type="button" className={po.status === "draft" ? "btn-ghost btn-sm" : "btn-primary btn-sm"} onClick={() => setOpen("receive")}>Receive goods</button>}
      {po.status !== "draft" && <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("pay")}>Record payment</button>}
      <a className="btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer" title={waPhone ? "Opens WhatsApp with the PO text" : "Vendor has no phone; pick the chat in WhatsApp"}>Send on WhatsApp</a>
      <button type="button" className="btn-ghost btn-sm" onClick={() => window.print()}>Print</button>
      {editable && <Link className="btn-ghost btn-sm" href={`/store/purchases/${po.id}/edit`}>Edit</Link>}
      {po.status === "ordered" && editable && <ActionButton action={() => setPurchaseOrderStatus(po.id, "draft")}>Back to draft</ActionButton>}
      {(po.status === "ordered" || po.status === "partial") && (
        <ActionButton action={() => setPurchaseOrderStatus(po.id, "cancelled")} className="btn-ghost btn-sm text-red-600"
          confirm={po.status === "partial" ? "Close this PO? The items not received yet will not come; received stock stays." : `Cancel ${poLabel(po.po_no)}?`}>
          {po.status === "partial" ? "Close (rest not coming)" : "Cancel PO"}
        </ActionButton>
      )}
      {po.status === "draft" && (
        <ActionButton className="btn-ghost btn-sm text-red-600" confirm={`Delete draft ${poLabel(po.po_no)}?`}
          action={async () => { const r = await deletePurchaseOrder(po.id); if (r?.ok) router.push("/store/purchases"); return r; }}>Delete</ActionButton>
      )}

      {open === "receive" && (
        <Modal open onClose={() => setOpen(null)} title={`Receive goods · ${poLabel(po.po_no)}`} wide>
          <ActionForm action={receivePurchaseOrder} onOk={() => setOpen(null)}>
            <input type="hidden" name="po_id" value={po.id} />
            <p className="text-sm text-slate-600">Enter what arrived now. Store products get this quantity added to their stock. For a part delivery, receive the rest later.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Pending</th><th className="th w-32 text-right">Received now</th></tr></thead>
                <tbody className="divide-y">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="td">{i.name}{i.unit && <span className="text-slate-500"> · {i.unit}</span>}{!i.tracked && <span className="block text-xs text-slate-400">Not a store product: stock not changed</span>}</td>
                      <td className="td text-right">{i.left}</td>
                      <td className="td"><input className="input text-right" type="number" name={`qty_${i.id}`} min={0} max={i.left} step={1} defaultValue={i.left} aria-label={`${i.name} received`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Received on"><input className="input" type="date" name="received_on" defaultValue={today} max={today} /></Field>
              <Field label="Note" hint="Bill no., challan no., etc."><input className="input" name="note" maxLength={500} /></Field>
            </div>
            <Submit pendingText="Receiving…">Receive & add to stock</Submit>
          </ActionForm>
        </Modal>
      )}
      {open === "pay" && (
        <Modal open onClose={() => setOpen(null)} title={`Payment to vendor · ${poLabel(po.po_no)}`}>
          <ActionForm action={recordVendorPayment} onOk={() => setOpen(null)}>
            <input type="hidden" name="po_id" value={po.id} />
            <p className="text-sm text-slate-600">Paid so far {rupees(po.amount_paid)} of {rupees(po.total)}. To pay now: <b>{rupees(po.due)}</b>.</p>
            <Field label="Amount paid (₹)" hint="Use a minus amount to correct a mistake"><input className="input" type="number" name="amount" step="0.01" defaultValue={po.due || ""} required /></Field>
            <Field label="Note" hint="UPI ref, cheque no., cash"><input className="input" name="note" maxLength={200} /></Field>
            <Submit>Save payment</Submit>
          </ActionForm>
        </Modal>
      )}
    </div>
  );
}

"use client";
import { ActionForm, Field, Submit } from "@/components/ui";
import { saveQuoteSettings, saveRazorpayKeys } from "@/lib/actions/quotes";
import type { QuoteSettings } from "@/lib/quotes-server";

export function QuoteSettingsForm({ st, statuses }: { st: QuoteSettings; statuses: { id: string; name: string }[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-1 text-base font-semibold text-navy-900">Quotation &amp; invoice details</h2>
      <p className="mb-3 text-xs text-slate-500">Printed on every PDF.</p>
      <ActionForm action={saveQuoteSettings}>
        <Field label="Business name"><input className="input" name="business_name" defaultValue={st.business_name} maxLength={120} /></Field>
        <Field label="Address"><textarea className="input min-h-16" name="address" defaultValue={st.address} maxLength={500} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="GSTIN"><input className="input uppercase" name="gstin" defaultValue={st.gstin} maxLength={20} /></Field>
          <Field label="Phone"><input className="input" name="phone" defaultValue={st.phone} maxLength={40} /></Field>
          <Field label="Email"><input className="input" type="email" name="email" defaultValue={st.email} maxLength={120} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Quote prefix"><input className="input" name="quote_prefix" defaultValue={st.quote_prefix} maxLength={12} /></Field>
          <Field label="Next quote no."><input className="input" type="number" min={1} name="next_quote_no" defaultValue={st.next_quote_no} /></Field>
          <Field label="Invoice prefix"><input className="input" name="invoice_prefix" defaultValue={st.invoice_prefix} maxLength={12} /></Field>
          <Field label="Next invoice no."><input className="input" type="number" min={1} name="next_invoice_no" defaultValue={st.next_invoice_no} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default GST %"><input className="input" type="number" min={0} max={100} step="0.01" name="default_tax_pct" defaultValue={st.default_tax_pct} /></Field>
          <Field label="Quotation valid for (days)"><input className="input" type="number" min={0} max={365} name="quote_validity_days" defaultValue={st.quote_validity_days} /></Field>
        </div>
        <Field label="Default terms & conditions"><textarea className="input min-h-20" name="terms" defaultValue={st.terms} maxLength={5000} /></Field>
        <Field label="Bank / UPI details"><textarea className="input min-h-16" name="bank_details" defaultValue={st.bank_details} maxLength={1000} placeholder="Bank, A/c no., IFSC, UPI ID" /></Field>
        <Field label="Footer note"><input className="input" name="footer_note" defaultValue={st.footer_note} maxLength={200} /></Field>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="auto_status_on_send" defaultChecked={st.auto_status_on_send} /> When a quotation is sent, move the lead to this status:</label>
          <select className="input" name="quote_status_id" defaultValue={st.quote_status_id ?? ""} aria-label="Status after sending a quotation">
            <option value="">&quot;Quotation sent&quot; (created automatically)</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="flex items-center gap-2"><input type="checkbox" name="won_on_payment" defaultChecked={st.won_on_payment} /> When a payment link is fully paid, mark the lead <b>Won</b></label>
        </div>
        <Submit>Save</Submit>
      </ActionForm>
    </section>
  );
}

export function RazorpayForm({ keyId, hasSecret, hasWebhook, webhookUrl }: { keyId: string | null; hasSecret: boolean; hasWebhook: boolean; webhookUrl: string }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-base font-semibold text-navy-900">Razorpay (payment links)</h2>
        <p className="text-xs text-slate-500">Your own Razorpay account: customers pay you directly. {keyId ? <b className="text-emerald-700">Connected: {keyId}</b> : <b className="text-amber-700">Not connected</b>}</p>
      </div>
      <ActionForm action={saveRazorpayKeys}>
        <Field label="Key ID" hint="Razorpay Dashboard → Account & Settings → API Keys"><input className="input font-mono" name="key_id" defaultValue={keyId ?? ""} placeholder="rzp_live_..." required /></Field>
        <Field label="Key Secret"><input className="input font-mono" type="password" name="key_secret" autoComplete="off" placeholder={hasSecret ? "Saved (leave empty to keep)" : ""} /></Field>
        <Field label="Webhook secret" hint="Optional, but needed for instant 'paid' updates (see steps below)."><input className="input font-mono" type="password" name="webhook_secret" autoComplete="off" placeholder={hasWebhook ? "Saved (leave empty to keep)" : ""} /></Field>
        <Submit>Save &amp; test keys</Submit>
      </ActionForm>
      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <b className="text-navy-900">Webhook setup</b> (Razorpay → Account &amp; Settings → Webhooks → Add):
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>URL: <code className="break-all rounded bg-white px-1">{webhookUrl}</code></li>
          <li>Secret: any strong text; paste the same text above as <i>Webhook secret</i>.</li>
          <li>Events: <code>payment_link.paid</code>, <code>payment_link.partially_paid</code>, <code>payment_link.cancelled</code>, <code>payment_link.expired</code>.</li>
        </ol>
        <p className="mt-1">Without the webhook, status still updates when the customer returns after paying, or when you press refresh on the link.</p>
      </div>
      {keyId && (
        <ActionForm action={saveRazorpayKeys} confirm="Remove Razorpay keys? New payment links can't be made until you add them again.">
          <input type="hidden" name="remove" value="1" />
          <Submit className="btn-ghost btn-sm text-red-600">Remove keys</Submit>
        </ActionForm>
      )}
    </section>
  );
}

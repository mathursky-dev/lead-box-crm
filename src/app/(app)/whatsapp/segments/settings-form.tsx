"use client";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { saveSegmentSettings } from "@/lib/actions/segments";
import { inr, type SegmentSettings } from "@/lib/segments";

export function SegmentSettingsButton({ settings: s, p90 }: { settings: SegmentSettings; p90: number | null }) {
  const num = (name: keyof SegmentSettings, label: string, hint?: string, min = 1) => (
    <Field label={label} hint={hint}><input className="input" type="number" name={name} min={min} step={1} defaultValue={s[name]} required /></Field>
  );
  return (
    <ModalButton label="Segment rules" title="Segment rules" className="btn-ghost">
      {(close) => (
        <ActionForm action={saveSegmentSettings} onOk={close}>
          <div className="grid gap-3 sm:grid-cols-2">
            {num("vip_min_spend", "VIP: total spend at least (₹)", p90 ? `Your top 10% of buyers spent ${inr(p90)}+` : undefined, 0)}
            {num("vip_min_orders", "VIP: or purchases at least")}
            {num("repeat_min_orders", "Repeat buyer: purchases at least", undefined, 2)}
            {num("new_buyer_days", "New buyer: first purchase within (days)")}
            {num("at_risk_days", "At risk: no purchase for (days)")}
            {num("inactive_days", "Inactive: no message or purchase for (days)")}
          </div>
          <p className="text-xs text-slate-500">A purchase is a store order (confirmed or paid), a paid invoice, or a won lead without either.</p>
          <Submit>Save rules</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

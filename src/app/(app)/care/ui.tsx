"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { ActionForm, Field, Submit } from "@/components/ui";
import { APPT_STATUSES, DAYS, REF_STATUSES, type CareSettings } from "@/lib/care";
import { saveCareSettings, setAppointmentStatus, setReferralStatus } from "@/lib/actions/care";

/** A public link with copy / open / share-on-WhatsApp. path = "/b/CODE". */
export function LinkBar({ path, label, share, note, settingsHref }: { path: string; label: string; share: string; note?: React.ReactNode; settingsHref?: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#25D366]/15 text-[#128C7E]"><Icon name="link" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <a href={path} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-brand-700 hover:underline">{url.replace(/^https?:\/\//, "")}</a>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-ghost btn-sm">{copied ? "Copied ✓" : "Copy link"}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${share} ${url}`)}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">Share on WhatsApp</a>
        {settingsHref && <a href={settingsHref} className="btn-ghost btn-sm">Settings</a>}
      </div>
      {note && <p className="w-full text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ error?: string } | undefined>) => start(async () => {
    const r = await fn();
    setError(r?.error);
    if (!r?.error) router.refresh();
  });
  return { pending, error, run };
}

export function ApptStatus({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <select className="input !w-auto !py-1 text-xs" value={status} disabled={pending} aria-label="Appointment status"
        onChange={(e) => { const v = e.target.value; run(() => setAppointmentStatus(id, v)); }}>
        {APPT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function RefStatus({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {status === "won" && (
          <button type="button" className="btn-primary btn-sm" disabled={pending}
            onClick={() => { const note = window.prompt("Reward given (optional note, e.g. ₹500 Paytm / gift voucher):", "") ; if (note !== null) run(() => setReferralStatus(id, "rewarded", note)); }}>
            Mark rewarded
          </button>
        )}
        <select className="input !w-auto !py-1 text-xs" value={status} disabled={pending} aria-label="Referral status"
          onChange={(e) => { const v = e.target.value; run(() => setReferralStatus(id, v)); }}>
          {REF_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

// ------------------------------------------------------------- settings
const Check = ({ name, label, defaultChecked }: { name: string; label: React.ReactNode; defaultChecked: boolean }) => (
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5" /> <span>{label}</span></label>
);
const Card = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="card max-w-3xl p-5">
    <h2 className="text-base font-semibold text-navy-900">{title}</h2>
    <p className="mb-4 text-sm text-slate-500">{sub}</p>
    {children}
  </div>
);

export function CareSettingsForms({ s, sources, defaultCode }: { s: CareSettings; sources: { id: string; name: string }[]; defaultCode: string }) {
  const [code, setCode] = useState(s.booking_code ?? defaultCode);
  const gen = () => setCode(Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""));
  return (
    <div className="space-y-4">
      <Card title="Booking page" sub="Customers pick a free slot from a link. Each booking lands on their lead and in the owner's follow-ups as a meeting.">
        <ActionForm action={saveCareSettings} className="space-y-4">
          <input type="hidden" name="section" value="booking" />
          <Check name="booking_enabled" defaultChecked={s.booking_enabled} label={<>Booking page is <b>on</b></>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link code" hint="Your booking link is /b/CODE">
              <div className="flex gap-2">
                <input className="input font-mono uppercase" name="booking_code" required pattern="[A-Za-z0-9]{4,12}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <button type="button" className="btn-ghost btn-sm" onClick={gen}>New</button>
              </div>
            </Field>
            <Field label="Page title"><input className="input" name="booking_title" required maxLength={80} defaultValue={s.booking_title} /></Field>
            <Field label="Address / meeting place" hint="Shown on the page and in the confirmation"><input className="input" name="booking_location" maxLength={200} defaultValue={s.booking_location} placeholder="Showroom, C-Scheme, Jaipur" /></Field>
            <Field label="Lead source for bookings" hint="Empty = “Appointment booking”">
              <select className="input" name="booking_source_id" defaultValue={s.booking_source_id ?? ""}>
                <option value="">Appointment booking (auto)</option>
                {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Slot length (minutes)"><input className="input" name="slot_minutes" type="number" min={10} max={480} defaultValue={s.slot_minutes} /></Field>
            <Field label="Bookings per slot" hint="How many customers you can see at the same time"><input className="input" name="slot_capacity" type="number" min={1} max={50} defaultValue={s.slot_capacity} /></Field>
            <Field label="Show days ahead"><input className="input" name="days_ahead" type="number" min={1} max={90} defaultValue={s.days_ahead} /></Field>
            <Field label="Minimum notice (hours)"><input className="input" name="min_notice_hours" type="number" min={0} max={168} defaultValue={s.min_notice_hours} /></Field>
          </div>
          <div>
            <span className="label">Working hours</span>
            <div className="mt-1 space-y-1.5">
              {DAYS.map((d) => {
                const h = s.week_hours?.[d.key];
                return (
                  <div key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex w-20 items-center gap-2"><input type="checkbox" name={`day_${d.key}`} defaultChecked={Boolean(h)} /> {d.label}</label>
                    <input type="time" className="input !w-auto !py-1" name={`from_${d.key}`} defaultValue={h?.[0] ?? "10:00"} aria-label={`${d.label} opens`} />
                    <span className="text-slate-400">to</span>
                    <input type="time" className="input !w-auto !py-1" name={`to_${d.key}`} defaultValue={h?.[1] ?? "18:00"} aria-label={`${d.label} closes`} />
                  </div>
                );
              })}
            </div>
          </div>
          <Field label="Holidays (no bookings)" hint="Dates as YYYY-MM-DD, separated by commas">
            <input className="input" name="closed_dates" defaultValue={(s.closed_dates ?? []).join(", ")} placeholder="2026-11-08, 2026-12-25" />
          </Field>
          <Field label="Intro text"><textarea className="input" name="booking_intro" rows={2} maxLength={500} defaultValue={s.booking_intro} placeholder="Free consultation with our designer." /></Field>
          <Field label="Thank-you message"><input className="input" name="booking_thank_you" maxLength={300} defaultValue={s.booking_thank_you} /></Field>
          <Submit>Save booking page</Submit>
        </ActionForm>
      </Card>

      <Card title="Feedback & NPS" sub="Ask “How likely are you to recommend us?” (0–10) after a deal is Won. Unhappy answers alert the owner and admins.">
        <ActionForm action={saveCareSettings} className="space-y-4">
          <input type="hidden" name="section" value="feedback" />
          <Check name="feedback_auto" defaultChecked={s.feedback_auto} label={<>Send the feedback link <b>automatically</b> on WhatsApp when a lead is Won <span className="text-slate-500">(only works inside the 24-hour WhatsApp window; otherwise the owner is reminded to send it)</span></>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Send after (hours)"><input className="input" name="feedback_delay_hours" type="number" min={0} max={720} defaultValue={s.feedback_delay_hours} /></Field>
            <Field label="Google review link" hint="Happy customers (9–10) are asked to post a review"><input className="input" name="review_url" maxLength={500} defaultValue={s.review_url ?? ""} placeholder="https://g.page/r/…/review" /></Field>
          </div>
          <Field label="Question"><input className="input" name="feedback_question" required maxLength={200} defaultValue={s.feedback_question} /></Field>
          <Field label="WhatsApp message" hint="Use {name}, {company} and {link}"><textarea className="input" name="feedback_message" required rows={3} maxLength={1000} defaultValue={s.feedback_message} /></Field>
          <Submit>Save feedback settings</Submit>
        </ActionForm>
      </Card>

      <Card title="Referral program" sub="Every customer gets a personal referral link. Friends who fill it become leads (source “Referral”); when the friend's lead is Won the reward is due.">
        <ActionForm action={saveCareSettings} className="space-y-4">
          <input type="hidden" name="section" value="referral" />
          <Check name="referral_enabled" defaultChecked={s.referral_enabled} label={<>Referral program is <b>on</b></>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reward" hint="Shown to the customer, e.g. ₹500 off on your next order"><input className="input" name="referral_reward" maxLength={300} defaultValue={s.referral_reward} /></Field>
            <Field label="Lead source for referrals" hint="Empty = “Referral”">
              <select className="input" name="referral_source_id" defaultValue={s.referral_source_id ?? ""}>
                <option value="">Referral (auto)</option>
                {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="WhatsApp message" hint="Use {name}, {company} and {link}"><textarea className="input" name="referral_message" required rows={3} maxLength={1000} defaultValue={s.referral_message} /></Field>
          <Submit>Save referral settings</Submit>
        </ActionForm>
      </Card>

      <Card title="Customer portal" sub="A private link per customer showing their quotations, invoices, payment links, orders and appointments. Send it from any lead.">
        <ActionForm action={saveCareSettings} className="space-y-4">
          <input type="hidden" name="section" value="portal" />
          <Check name="portal_enabled" defaultChecked={s.portal_enabled} label={<>Customer portal is <b>on</b></>} />
          <Field label="Note at the bottom of the portal"><input className="input" name="portal_note" maxLength={500} defaultValue={s.portal_note} placeholder="For any help, WhatsApp us on 98xxxxxxx" /></Field>
          <Submit>Save portal settings</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}

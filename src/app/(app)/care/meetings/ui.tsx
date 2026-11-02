"use client";
import { useState } from "react";
import { ActionButton, ActionForm, Field, Submit } from "@/components/ui";
import { disconnectMeetings, saveGoogleCalendar, saveMeetingMode, saveZoomKeys } from "@/lib/actions/meetings";

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div><h2 className="font-semibold text-navy-900">{title}</h2>{sub && <p className="text-sm text-slate-500">{sub}</p>}</div>
      {children}
    </section>
  );
}

const MODES = [
  { value: "none", label: "Off", sub: "No video link (in-person appointments)." },
  { value: "google", label: "Google Meet", sub: "A Meet link from your connected Google Calendar." },
  { value: "zoom", label: "Zoom", sub: "A new Zoom meeting for every appointment." },
  { value: "fixed", label: "Fixed link", sub: "Always the same link (your personal room, Teams, Jitsi…)." },
];

export function MeetingForms({ mode, fixedUrl, zoom, google, googleReady }: {
  mode: string; fixedUrl: string; zoom: { accountId: string; clientId: string } | null; google: { email: string; calendar: string } | null; googleReady: boolean;
}) {
  const [m, setM] = useState(mode);
  return (
    <div className="space-y-4">
      <Card title="Video meeting on appointments" sub="Every appointment (booked online or by staff) gets its own meeting link. It is sent in the WhatsApp confirmation and shown on the appointment.">
        <ActionForm action={saveMeetingMode} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((x) => (
              <label key={x.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${m === x.value ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}>
                <input type="radio" name="mode" value={x.value} checked={m === x.value} onChange={() => setM(x.value)} />
                <span><b>{x.label}</b><span className="block text-xs text-slate-500">{x.sub}</span></span>
              </label>
            ))}
          </div>
          {m === "fixed" && <Field label="Meeting link"><input className="input" name="fixed_url" type="url" required defaultValue={fixedUrl} placeholder="https://meet.google.com/abc-defg-hij" /></Field>}
          {m === "zoom" && !zoom && <p className="text-sm text-amber-700">Save your Zoom app keys below first.</p>}
          {m === "google" && !google && <p className="text-sm text-amber-700">Connect Google below first.</p>}
          <Submit>Save</Submit>
        </ActionForm>
      </Card>

      <Card title="Google Meet" sub="Sign in with the Google account whose calendar should hold the meetings. Only calendar events are used.">
        {google ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="badge bg-green-100 text-green-800">Connected</span> <b>{google.email}</b>
              <ActionButton action={() => disconnectMeetings("google")} confirm="Disconnect Google? New appointments won't get Meet links.">Disconnect</ActionButton>
            </div>
            <ActionForm action={saveGoogleCalendar} className="flex flex-wrap items-end gap-2">
              <Field label="Calendar ID" hint="primary = the account's main calendar"><input className="input" name="calendar_id" defaultValue={google.calendar} /></Field>
              <Submit className="btn-ghost">Save</Submit>
            </ActionForm>
          </div>
        ) : googleReady ? (
          <a href="/api/meet/google/login" className="btn-primary inline-flex">Connect Google</a>
        ) : (
          <p className="text-sm text-amber-700">Google sign-in is not set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, redirect URL /api/meet/google/callback). Ask Lead Box support.</p>
        )}
      </Card>

      <Card title="Zoom" sub="In Zoom App Marketplace create a “Server-to-Server OAuth” app with the meeting:write:meeting and user:read:user scopes, activate it, and paste its keys here.">
        {zoom && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="badge bg-green-100 text-green-800">Connected</span> Client ID <code>{zoom.clientId}</code>
            <ActionButton action={() => disconnectMeetings("zoom")} confirm="Remove the Zoom keys?">Disconnect</ActionButton>
          </div>
        )}
        <ActionForm action={saveZoomKeys} className="grid gap-3 sm:grid-cols-3">
          <Field label="Account ID"><input className="input" name="account_id" required defaultValue={zoom?.accountId} autoComplete="off" /></Field>
          <Field label="Client ID"><input className="input" name="client_id" required defaultValue={zoom?.clientId} autoComplete="off" /></Field>
          <Field label="Client secret"><input className="input" name="client_secret" type="password" required autoComplete="new-password" placeholder={zoom ? "•••••• (saved)" : ""} /></Field>
          <div className="sm:col-span-3"><Submit pendingText="Testing…">{zoom ? "Update keys" : "Test & save"}</Submit></div>
        </ActionForm>
      </Card>
    </div>
  );
}

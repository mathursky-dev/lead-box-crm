"use client";
import { useState } from "react";
import { ActionForm, ActionButton, Field, Submit } from "@/components/ui";
import { saveMetaIntegration, generateVerifyToken } from "@/lib/actions/integrations";

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1">
        <input className="input font-mono text-xs" readOnly value={shown ? value : "•".repeat(Math.min(value.length, 32))} onFocus={(e) => e.target.select()} />
        {secret && <button type="button" className="btn-ghost btn-sm" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>}
        <button type="button" className="btn-ghost btn-sm" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function VerifyToken({ token, envFallback, disabled }: { token: string | null; envFallback: boolean; disabled: boolean }) {
  return (
    <div>
      {token ? <CopyField label="Verify token" value={token} secret /> : (
        <div><span className="label">Verify token</span>
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{envFallback ? "Using the WHATSAPP_VERIFY_TOKEN server setting. Generate one here to manage it from the app." : "No verify token yet."}</p></div>
      )}
      <div className="mt-2">
        {disabled ? <span className="text-xs text-red-600">Needs the server service key before tokens can be saved.</span> : (
          <ActionButton action={generateVerifyToken} className="btn-ghost btn-sm"
            confirm={token ? "Generate a new verify token? You must paste the new one into Meta and click Verify and save again." : undefined}>
            {token ? "Regenerate token" : "Generate token"}
          </ActionButton>
        )}
      </div>
    </div>
  );
}

export function MetaForm({ appId, secretSaved, envSecret, disabled, updated }: { appId: string; secretSaved: boolean; envSecret: boolean; disabled: boolean; updated: string | null }) {
  return (
    <ActionForm action={saveMetaIntegration} className="grid gap-3 sm:grid-cols-2">
      <Field label="Meta App ID"><input className="input" name="meta_app_id" defaultValue={appId} inputMode="numeric" disabled={disabled} /></Field>
      <Field label="App Secret" hint={secretSaved ? "Saved (encrypted). Leave blank to keep it." : envSecret ? "Using the WHATSAPP_APP_SECRET server setting." : "Not set — webhooks will be rejected until it is."}>
        <input className="input" name="app_secret" type="password" autoComplete="off" placeholder={secretSaved ? "••••••••••••••••" : ""} disabled={disabled} />
      </Field>
      {secretSaved && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="clear_secret" disabled={disabled} /> Remove the saved App Secret</label>}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Submit>Save credentials</Submit>
        {updated && <span className="text-xs text-slate-500">Last updated {updated}</span>}
        {disabled && <span className="text-xs text-red-600">Needs the server service key and encryption key.</span>}
      </div>
    </ActionForm>
  );
}

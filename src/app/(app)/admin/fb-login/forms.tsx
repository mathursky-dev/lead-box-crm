"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Alert, type FormState } from "@/components/ui";
import { setFbOnlySelected, addFbPage, setFbPageSelected, removeFbPage, listFbAds, addFbAd, removeFbAd, disconnectFacebook, type FbAd } from "@/lib/actions/facebook";

/** Runs a server action, keeps its feedback and refreshes server data on success. */
function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>();
  const router = useRouter();
  const run = (fn: () => Promise<FormState>) => start(async () => {
    const r = await fn();
    setState(r);
    if (!r?.error) router.refresh();
  });
  return { pending, state, run };
}

export function FbHeader({ name, id, onlySelected }: { name: string; id: string; onlySelected: boolean }) {
  const { pending, state, run } = useRun();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-navy-900">Meta Account - {name} ({id.slice(-4)})</span>
          <ActionButton action={disconnectFacebook} className="btn btn-sm rounded-full bg-red-600 px-3 text-white hover:bg-red-700"
            confirm="Disconnect Facebook? Pages will stop sending leads to LEAD BOX.">✕ Disconnect FB</ActionButton>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Process FB Leads only for Selected Pages and Ads
          <span className="cursor-help text-slate-400" title="When on, leads are created only from checked pages and, if any ads are saved below, only from those ads.">ⓘ</span>
          <button type="button" role="switch" aria-checked={onlySelected} aria-label="Process FB Leads only for Selected Pages and Ads" disabled={pending}
            onClick={() => run(() => setFbOnlySelected(!onlySelected))}
            className={`relative h-5 w-9 rounded-full transition ${onlySelected ? "bg-violet-600" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${onlySelected ? "left-4.5" : "left-0.5"}`} />
          </button>
        </label>
      </div>
      <Alert state={state} />
    </div>
  );
}

export function FbPickers({ pages, adAccounts }: { pages: { id: string; name: string }[]; adAccounts: { id: string; name: string }[] }) {
  const { pending, state, run } = useRun();
  const [account, setAccount] = useState("");
  const [ads, setAds] = useState<FbAd[] | null>(null);
  const [loading, startLoad] = useTransition();
  const [adErr, setAdErr] = useState<string>();

  const pickAccount = (id: string) => {
    setAccount(id);
    setAds(null);
    setAdErr(undefined);
    if (id) startLoad(async () => { const r = await listFbAds(id); setAds(r.ads ?? []); setAdErr(r.error); });
  };
  const accountName = adAccounts.find((a) => a.id === account)?.name ?? "";

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Select Page</span>
          <select className="input" value="" disabled={pending} onChange={(e) => e.target.value && run(() => addFbPage(e.target.value))}>
            <option value="">{pages.length ? "Choose a page…" : "No pages found"}</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Select Ad Account</span>
          <select className="input" value={account} onChange={(e) => pickAccount(e.target.value)}>
            <option value="">{adAccounts.length ? "Choose an ad account…" : "No ad accounts found"}</option>
            {adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Select Ad</span>
          <select className="input" value="" disabled={!account || loading || pending} onChange={(e) => e.target.value && run(() => addFbAd(account, accountName, e.target.value))}>
            <option value="">{loading ? "Loading ads…" : !account ? "Choose an ad account first" : ads?.length ? "Choose an ad…" : "No ads found"}</option>
            {(ads ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.status && a.status !== "ACTIVE" ? ` (${a.status.toLowerCase()})` : ""}</option>)}
          </select>
        </label>
      </div>
      {adErr && <p className="text-xs text-red-600">{adErr}</p>}
      {pending && <p className="text-xs text-slate-500">Saving…</p>}
      <Alert state={state} />
    </div>
  );
}

const TRASH = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700";

export function SavedPages({ pages }: { pages: { page_id: string; page_name: string | null; is_selected: boolean; subscribed: boolean }[] }) {
  const { pending, state, run } = useRun();
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-navy-900">Pages</h2>
      {!pages.length ? <p className="text-xs text-slate-500">No page added yet — pick one above.</p> : (
        <ul className="space-y-2">
          {pages.map((p) => (
            <li key={p.page_id} className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Process leads from ${p.page_name ?? p.page_id}`} checked={p.is_selected} disabled={pending}
                onChange={(e) => run(() => setFbPageSelected(p.page_id, e.target.checked))} />
              <input className="input" disabled value={`${p.page_name ?? ""} (${p.page_id})`} />
              {!p.subscribed && <span className="badge bg-amber-50 text-amber-800">not subscribed</span>}
              <ActionButton action={() => removeFbPage(p.page_id)} className={TRASH} confirm={`Remove ${p.page_name ?? p.page_id}? It will stop sending leads.`}>
                <span aria-label="Remove page">🗑</span>
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <Alert state={state} />
    </div>
  );
}

export function SavedAds({ ads }: { ads: { ad_id: string; ad_name: string | null; ad_account_name: string | null }[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-navy-900">Ads</h2>
      {!ads.length ? <p className="text-xs text-slate-500">No ad added — leads from all ads are processed.</p> : (
        <ul className="space-y-2">
          {ads.map((a) => (
            <li key={a.ad_id} className="flex items-center gap-2">
              <input className="input" disabled value={`${a.ad_name ?? ""} (${a.ad_id})${a.ad_account_name ? ` · ${a.ad_account_name}` : ""}`} />
              <ActionButton action={() => removeFbAd(a.ad_id)} className={TRASH} confirm={`Remove ad ${a.ad_name ?? a.ad_id}?`}>
                <span aria-label="Remove ad">🗑</span>
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

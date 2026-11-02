"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSocialChannel } from "@/lib/actions/social";

type Page = { id: string; name: string; ig: string | null; messenger: boolean; instagram: boolean };

function Toggle({ page, channel, on, disabled }: { page: string; channel: "messenger" | "instagram"; on: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={pending || disabled} aria-pressed={on}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"} disabled:opacity-50`}
        onClick={() => start(async () => { const r = await setSocialChannel(page, channel, !on); setMsg(r); if (!r.error) router.refresh(); })}>
        {pending ? "…" : on ? "On" : "Off"}
      </button>
      {msg?.error && <span className="max-w-xs text-xs text-red-600">{msg.error}</span>}
    </span>
  );
}

export function SocialPages({ pages }: { pages: Page[] }) {
  if (!pages.length) return <div className="card p-6 text-center text-sm text-slate-500">This Facebook account doesn&apos;t manage any page.</div>;
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="td">Facebook page</th><th className="td">Messenger</th><th className="td">Instagram</th></tr></thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="td"><b>{p.name}</b><div className="text-xs text-slate-500">{p.id}</div></td>
              <td className="td"><Toggle page={p.id} channel="messenger" on={p.messenger} /></td>
              <td className="td">
                {p.ig ? <div className="mb-1 text-xs text-slate-600">@{p.ig.replace(/^@/, "")}</div> : <div className="mb-1 text-xs text-slate-400">No Instagram linked</div>}
                <Toggle page={p.id} channel="instagram" on={p.instagram} disabled={!p.ig && !p.instagram} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { aiScoreConversation, aiScoreLead, type ScoreOut } from "@/lib/actions/ai";
import { fmtDateTime } from "@/lib/dates";
import { Icon } from "@/components/kit";

export type AiScore = "hot" | "warm" | "cold";

export const AI_SCORE_STYLE: Record<AiScore, { label: string; emoji: string; cls: string; bar: string }> = {
  hot: { label: "Hot", emoji: "🔥", cls: "bg-red-50 text-red-700 ring-red-200", bar: "bg-red-500" },
  warm: { label: "Warm", emoji: "🌤️", cls: "bg-amber-50 text-amber-700 ring-amber-200", bar: "bg-amber-500" },
  cold: { label: "Cold", emoji: "❄️", cls: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-500" },
};

/** Small Hot / Warm / Cold pill. The reason shows on hover. */
export function AiScoreBadge({ score, points, reason, className = "" }: { score?: string | null; points?: number | null; reason?: string | null; className?: string }) {
  const s = score ? AI_SCORE_STYLE[score as AiScore] : null;
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.cls} ${className}`}
      title={`AI score${points != null ? ` ${points}/100` : ""}${reason ? ` · ${reason}` : ""}`}>
      <span aria-hidden>{s.emoji}</span>{s.label}{points != null && <span className="font-normal opacity-70">{points}</span>}
    </span>
  );
}

type Saved = { score: string | null; points: number | null; reason: string | null; next_step: string | null; scored_at: string | null };

/** Lead page box: current AI score with reason + next step, and a (re)score button. */
export function AiScoreCard({ leadId, initial, canAi }: { leadId: string; initial: Saved; canAi: boolean }) {
  const [v, setV] = useState<Saved>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const s = v.score ? AI_SCORE_STYLE[v.score as AiScore] : null;
  const run = async () => {
    setBusy(true); setErr(undefined);
    const r: ScoreOut = await aiScoreLead(leadId);
    setBusy(false);
    if (r.error) setErr(r.error);
    else setV({ score: r.score!, points: r.points!, reason: r.reason!, next_step: r.next_step!, scored_at: r.scored_at! });
  };
  if (!s && !canAi) return null;
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-navy-900"><Icon name="sparkle" className="h-4 w-4 text-violet-600" />AI lead score</h2>
        {canAi && <button className="btn-ghost btn-sm" disabled={busy} onClick={run}>{busy ? "Reading chat…" : s ? "Re-score" : "Score with AI"}</button>}
      </div>
      {s ? (
        <>
          <div className="flex items-center gap-3">
            <AiScoreBadge score={v.score} points={null} className="text-sm" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${s.bar}`} style={{ width: `${v.points ?? 0}%` }} /></div>
            <span className="text-sm font-semibold text-navy-900">{v.points ?? "—"}<span className="text-xs font-normal text-slate-400">/100</span></span>
          </div>
          {v.reason && <p className="mt-2 text-sm text-slate-700">{v.reason}</p>}
          {v.next_step && <p className="mt-1 text-xs text-slate-600"><b>Next step:</b> {v.next_step}</p>}
          {v.scored_at && <p className="mt-1 text-[11px] text-slate-400">Scored {fmtDateTime(v.scored_at)} from the WhatsApp chat. Updates by itself when the customer writes.</p>}
        </>
      ) : <p className="text-xs text-slate-500">AI reads this lead&apos;s WhatsApp chat and tells you if it is Hot, Warm or Cold, with the reason and the next step.</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </section>
  );
}

/** Inbox header chip: the linked lead's AI score; click to re-score. */
export function AiScoreChip({ convId, leadId, canAi, tick = 0 }: { convId: string; leadId: string | null; canAi: boolean; tick?: number }) {
  const [v, setV] = useState<{ score: string | null; points: number | null; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let live = true;
    setV(null); setErr(undefined);
    if (!leadId) return;
    getBrowserClient().from("lb_leads").select("ai_score,ai_score_points,ai_score_reason").eq("id", leadId).maybeSingle()
      .then(({ data }: { data: { ai_score: string | null; ai_score_points: number | null; ai_score_reason: string | null } | null }) => { if (live && data) setV({ score: data.ai_score, points: data.ai_score_points, reason: data.ai_score_reason }); });
    return () => { live = false; };
  }, [leadId, tick]);
  if (!leadId || (!v?.score && !canAi)) return null;
  const run = async () => {
    if (!canAi || busy) return;
    setBusy(true); setErr(undefined);
    const r = await aiScoreConversation(convId);
    setBusy(false);
    if (r.error) setErr(r.error); else setV({ score: r.score!, points: r.points!, reason: r.reason! });
  };
  return (
    <button type="button" onClick={run} disabled={!canAi || busy} className="shrink-0" title={err ?? (canAi ? "AI lead score. Click to re-score from this chat." : "AI lead score")}>
      {busy ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">Scoring…</span>
        : v?.score ? <AiScoreBadge score={v.score} points={v.points} reason={err ?? v.reason} />
        : <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${err ? "bg-red-50 text-red-700 ring-red-200" : "bg-violet-50 text-violet-700 ring-violet-200"}`}>✨ {err ? "Retry score" : "AI score"}</span>}
    </button>
  );
}

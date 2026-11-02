import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader } from "@/components/static";
import { istDate } from "@/lib/dates";
import { TargetsView, type TargetRow } from "./view";

export const metadata = { title: "Targets" };
export const dynamic = "force-dynamic";

const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const today = istDate();
  const now = today.slice(0, 7);
  // Next month is allowed so targets can be set in advance.
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! <= shift(now, 1) ? sp.month! : now;
  const { data, error } = await (await createClient()).rpc("lb_agent_targets", { p_month: `${month}-01` });
  const res = data as { rows: TargetRow[]; can_edit: boolean; editable: string[] | null } | null;

  // Month pace: share of the month gone (today counted as half a day done).
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(today.slice(8, 10));
  const elapsed = month < now ? daysInMonth : month > now ? 0 : day - 0.5;
  const daysLeft = month < now ? 0 : month > now ? daysInMonth : daysInMonth - day + 1;

  return (
    <>
      <PageHeader icon="target" tone="green" title="Targets"
        sub="Monthly targets and progress for each agent: won leads, revenue, calls, follow-ups and field visits. Times in IST."
        actions={
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
            <Link href={`/targets?month=${shift(month, -1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous month">‹</Link>
            <span className="min-w-32 text-center font-semibold text-navy-900">{label(month)}</span>
            {month <= now
              ? <Link href={`/targets?month=${shift(month, 1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next month">›</Link>
              : <span className="px-2 py-1 text-slate-300">›</span>}
          </div>
        } />
      {error || !res ? (
        <ErrorBox message={error?.message.includes("lb_agent_targets") ? "Targets are not set up in the database yet (run the agent targets SQL)." : error?.message ?? "Could not load targets"} />
      ) : (
        <TargetsView key={month} month={`${month}-01`} rows={res.rows} me={profile.id} canEdit={res.can_edit} editable={res.editable}
          pace={daysInMonth ? elapsed / daysInMonth : 0} daysLeft={daysLeft} />
      )}
    </>
  );
}

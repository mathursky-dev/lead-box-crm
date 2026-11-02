import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox, PageHeader } from "@/components/static";
import { istDate } from "@/lib/dates";
import { Board, type BoardRow } from "./board";

export const metadata = { title: "Leaderboard" };

const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const now = istDate().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! <= now ? sp.month! : now;
  const { data, error } = await (await createClient()).rpc("lb_leaderboard", { p_month: `${month}-01` });
  const res = data as { rows: BoardRow[]; can_edit: boolean; editable: string[] | null } | null;

  return (
    <>
      <PageHeader icon="trophy" tone="amber" title="Leaderboard"
        sub="Monthly ranking by targets, revenue, conversion and first-reply time. Times in IST."
        actions={
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
            <Link href={`/leaderboard?month=${shift(month, -1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous month">‹</Link>
            <span className="min-w-32 text-center font-semibold text-navy-900">{label(month)}</span>
            {month < now
              ? <Link href={`/leaderboard?month=${shift(month, 1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next month">›</Link>
              : <span className="px-2 py-1 text-slate-300">›</span>}
          </div>
        } />
      {error || !res ? <ErrorBox message={error?.message ?? "Could not load the leaderboard"} /> : (
        <Board key={month} month={`${month}-01`} rows={res.rows} me={profile.id} canEdit={res.can_edit} editable={res.editable} current={month === now} />
      )}
    </>
  );
}

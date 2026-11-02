import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty, ErrorBox } from "@/components/static";
import { errMsg } from "@/lib/util";
import { DuplicatesView, type DupGroup } from "./duplicates-view";

export const metadata = { title: "Duplicate leads" };

const PER = 20;
type SP = Record<string, string | undefined>;

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) redirect("/leads");
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const open = sp.open === "1";
  const customer = /^[0-9a-f-]{36}$/i.test(sp.customer ?? "") ? sp.customer! : "";
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const { data, error } = await (await createClient()).rpc("lb_duplicate_leads", {
    p: { q, open_only: open, customer_id: customer || null, limit: PER, offset: (page - 1) * PER },
  });
  const total = (data?.total as number | undefined) ?? 0;
  const groups = (data?.groups as DupGroup[] | undefined) ?? [];
  const href = (set: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string> = { q, open: open ? "1" : "", customer, page: page > 1 ? String(page) : "" };
    for (const [k, v] of Object.entries({ ...cur, ...set })) if (v) u.set(k, v);
    const s = u.toString();
    return `/leads/duplicates${s ? `?${s}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(total / PER));

  return (
    <div className="space-y-4">
      <PageHeader title="Duplicate leads" icon="layers" tone="amber"
        sub="Leads with the same phone number. Pick the lead to keep and merge the rest into it: history, notes, follow-ups, tags, tasks and chats move to the kept lead."
        actions={<Link href="/leads" className="btn-ghost">Back to leads</Link>} />

      <form className="card flex flex-wrap items-center gap-2 p-3" action="/leads/duplicates">
        <input name="q" defaultValue={q} placeholder="Search name, phone or LB-123" className="input h-9 w-full max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="open" value="1" defaultChecked={open} /> Only numbers with 2+ open leads
        </label>
        <button className="btn-primary btn-sm">Search</button>
        {(q || open || customer) && <Link href="/leads/duplicates" className="btn-ghost btn-sm">Clear</Link>}
        <span className="ml-auto text-sm text-slate-500">{total.toLocaleString("en-IN")} number{total === 1 ? "" : "s"} with duplicates</span>
      </form>

      {error ? <ErrorBox message={errMsg(error)} />
        : groups.length === 0 ? (
          <Empty icon="check" title="No duplicate leads">{q || open || customer ? "Nothing matches this search." : "Every phone number has only one active lead."}</Empty>
        ) : (
          <>
            <DuplicatesView groups={groups} />
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                {page > 1 && <Link className="btn-ghost btn-sm" href={href({ page: String(page - 1) })}>Previous</Link>}
                <span className="text-slate-500">Page {page} of {pages}</span>
                {page < pages && <Link className="btn-ghost btn-sm" href={href({ page: String(page + 1) })}>Next</Link>}
              </div>
            )}
          </>
        )}
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/care";
import { daysUntil, fmtYmd, OPEN_TICKET, ticketPriority, ticketStatus } from "@/lib/retention";
import { retentionSettings } from "@/lib/retention-server";
import { AdjustButton, EditDatesButton, NewRenewalButton, NewTicketButton, RedeemButton } from "./retention-ui";

// "Loyalty & service" panel on the lead page: points, birthday / anniversary, tickets, renewals.
export async function LeadRetention({ leadId, companyId, customerId, canEdit, admin, users, products }: {
  leadId: string; companyId: string; customerId: string; canEdit: boolean; admin: boolean;
  users: { id: string; name: string }[]; products: { id: string; name: string }[];
}) {
  const sb = await createClient();
  const s = await retentionSettings(sb, companyId).catch(() => null);
  if (!s) return null; // SQL not applied yet.
  const [{ data: bal }, { data: cust }, { data: tickets }, { data: renewals }] = await Promise.all([
    sb.rpc("lb_loyalty_balance", { p_customer: customerId }),
    sb.from("lb_customers").select("birthday,anniversary").eq("id", customerId).maybeSingle(),
    sb.from("lb_tickets").select("id,ticket_no,subject,status,priority,created_at").eq("customer_id", customerId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(6),
    sb.from("lb_renewals").select("id,title,due_date,status").eq("customer_id", customerId).eq("company_id", companyId).in("status", ["active", "lapsed"]).order("due_date").limit(6),
  ]);
  const balance = Number(bal ?? 0);
  const now = nowMs();
  const openTickets = (tickets ?? []).filter((t) => OPEN_TICKET.includes(t.status as string));
  const bday = (cust?.birthday as string | null) ?? null, anniv = (cust?.anniversary as string | null) ?? null;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Loyalty & service</h2>

      {(s.loyalty_enabled || balance !== 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2.5">
          <div>
            <div className="text-xs text-slate-500">Loyalty points</div>
            <div className="text-lg font-bold text-navy-900">{balance.toLocaleString("en-IN")} <span className="text-xs font-normal text-slate-500">= ₹{(balance * s.point_value).toLocaleString("en-IN")}</span></div>
          </div>
          <div className="flex gap-1.5">
            {canEdit && s.loyalty_enabled && balance > 0 && <RedeemButton customerId={customerId} leadId={leadId} balance={balance} pointValue={s.point_value} minRedeem={s.min_redeem} maxPct={s.max_redeem_pct} />}
            {admin && <AdjustButton customerId={customerId} leadId={leadId} />}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>🎂 {bday ? fmtYmd(bday) : <span className="text-slate-400">No birthday</span>} · 💍 {anniv ? fmtYmd(anniv) : <span className="text-slate-400">No anniversary</span>}</span>
        {canEdit && (
          <EditDatesButton customerId={customerId} leadId={leadId} birthday={bday} anniversary={anniv} />
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tickets {openTickets.length ? `· ${openTickets.length} open` : ""}</span>
          <NewTicketButton target={{ leadId }} categories={s.ticket_categories} users={users} className="btn-ghost btn-sm" label="+ Ticket" />
        </div>
        {(tickets ?? []).length ? (
          <ul className="space-y-1 text-sm">
            {(tickets ?? []).map((t) => {
              const st = ticketStatus(t.status as string), pr = ticketPriority(t.priority as string);
              return (
                <li key={t.id as string} className="flex items-center justify-between gap-2">
                  <Link href={`/care/tickets/${t.id}`} className="min-w-0 truncate text-brand-700 hover:underline">TK-{t.ticket_no as number} · {t.subject as string}</Link>
                  <span className="flex shrink-0 gap-1">
                    {OPEN_TICKET.includes(t.status as string) && t.priority !== "normal" && t.priority !== "low" && <span className={`rounded px-1 text-[10px] font-bold uppercase ${pr.cls}`}>{pr.label}</span>}
                    <span className={`rounded px-1 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-slate-500">No tickets.</p>}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">AMC / renewals</span>
          {canEdit && <NewRenewalButton target={{ leadId }} users={users} products={products} className="btn-ghost btn-sm" label="+ Renewal" />}
        </div>
        {(renewals ?? []).length ? (
          <ul className="space-y-1 text-sm">
            {(renewals ?? []).map((r) => {
              const d = daysUntil(r.due_date as string, now);
              return (
                <li key={r.id as string} className="flex items-center justify-between gap-2">
                  <Link href={`/care/renewals?id=${r.id}`} className="min-w-0 truncate text-brand-700 hover:underline">{r.title as string}</Link>
                  <span className={`shrink-0 text-xs ${r.status === "lapsed" || d < 0 ? "font-semibold text-red-600" : d <= 7 ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                    {r.status === "lapsed" ? "Lapsed" : d < 0 ? `${-d}d overdue` : d === 0 ? "Due today" : `Due ${fmtYmd(r.due_date as string)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-slate-500">No AMC or subscription.</p>}
      </div>
    </section>
  );
}

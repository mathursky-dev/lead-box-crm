import Link from "next/link";
import { inr } from "@/lib/plans";
import { Icon } from "@/components/kit";

/** Admin-only strip at the top of the page: wallet balance and a shortcut to add balance by UPI. */
export function WalletStrip({ balance, pending }: { balance: number; pending: number }) {
  return (
    <section className="card mb-4 flex flex-wrap items-center gap-3 border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700"><Icon name="wallet" className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Wallet balance</div>
        <div className="text-xl font-bold text-navy-900">{inr(Math.round(balance * 100) / 100)}</div>
        {pending > 0 && <div className="text-xs text-amber-700">{inr(pending)} UPI payment waiting for verification</div>}
      </div>
      <Link href="/wallet" className="btn-ghost btn-sm">History</Link>
      <Link href="/wallet#add" className="btn-primary btn-sm">+ Add balance (UPI)</Link>
    </section>
  );
}

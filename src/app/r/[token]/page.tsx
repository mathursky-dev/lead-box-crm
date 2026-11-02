import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { careSettings } from "@/lib/care-server";
import { FeedbackForm } from "./feedback-form";
import { nowMs } from "@/lib/care";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rate your experience", robots: { index: false } };

// Public feedback / NPS form: /r/<64-char token> (sent after a lead is Won).
export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = createAdminClient();
  const { data: f } = await db.from("lb_feedback").select("company_id,customer_id,status,score,answered_at").eq("token", token).maybeSingle();
  if (!f) notFound();
  const [s, { data: co }, { data: c }] = await Promise.all([
    careSettings(db, f.company_id),
    db.from("lb_companies").select("name").eq("id", f.company_id).maybeSingle(),
    f.customer_id ? db.from("lb_customers").select("name").eq("id", f.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const locked = f.status === "answered" && f.answered_at && nowMs() - new Date(f.answered_at).getTime() > 86400000;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="bg-emerald-700 px-6 py-6 text-white">
          <p className="text-sm opacity-80">{co?.name}</p>
          <h1 className="mt-1 text-xl font-bold">Hi {(c?.name as string | undefined)?.split(" ")[0] || "there"}, how did we do?</h1>
        </div>
        <div className="p-6">
          {locked
            ? <p className="text-center text-sm text-slate-600">Thank you! Your feedback ({f.score}/10) is already recorded. 🙏</p>
            : <FeedbackForm token={token} question={s?.feedback_question ?? "How likely are you to recommend us to a friend or family member?"} initial={f.score ?? null} />}
        </div>
      </div>
    </main>
  );
}

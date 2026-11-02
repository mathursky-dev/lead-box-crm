import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { BookingForm, type Day } from "./booking-form";

export const dynamic = "force-dynamic";

type Page = { company: string; title: string; intro: string; location: string; minutes: number; thank_you: string; open: boolean; days: Day[] };

async function load(code: string) {
  if (!/^[A-Z0-9]{4,12}$/i.test(code)) return null;
  const { data, error } = await createAdminClient().rpc("lb_booking_page", { p_code: code.toUpperCase() });
  if (error || !data) return null;
  return data as Page;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const p = await load((await params).code);
  return { title: p ? `${p.title} · ${p.company}` : "Book an appointment", robots: { index: false } };
}

// Public booking page: /b/<code>. Customers pick a free slot; the booking lands on their lead as a follow-up.
export default async function BookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await load(code);
  if (!p) notFound();
  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-emerald-700 px-4 pb-14 pt-8 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-sm opacity-80">{p.company}</p>
          <h1 className="mt-1 text-2xl font-bold">{p.title}</h1>
          {p.intro && <p className="mt-1 whitespace-pre-line text-sm opacity-90">{p.intro}</p>}
          <p className="mt-2 text-xs opacity-80">⏱ {p.minutes} min{p.location ? ` · 📍 ${p.location}` : ""}</p>
        </div>
      </header>
      <div className="mx-auto -mt-10 max-w-xl px-4">
        <BookingForm code={code.toUpperCase()} open={p.open} days={p.days} thankYou={p.thank_you} location={p.location} />
      </div>
    </main>
  );
}

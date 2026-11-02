export const metadata = { title: "Payment" };

// Where a customer lands after paying a payment link. Public.
export default async function PaidPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ok = status === "paid";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ok ? "✓" : "…"}</div>
        <h1 className="text-lg font-semibold text-slate-900">{ok ? "Payment received" : "Payment is being confirmed"}</h1>
        <p className="mt-2 text-sm text-slate-600">{ok ? "Thank you! Your payment was successful. You can close this page." : "If money was debited, it will be confirmed shortly. You can close this page."}</p>
      </div>
    </main>
  );
}

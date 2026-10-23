export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-navy-900 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl bg-white p-6 shadow-xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <div className="mb-6 flex justify-center"><span className="lb-logo w-44"><img src="/leadbox-logo.svg" alt="leadbox — Simplify Sales, Accelerate Growth" width={849} height={245} className="block h-auto w-full" /></span></div>
          {children}
        </div>
      </div>
    </main>
  );
}

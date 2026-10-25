import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-navy-900 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <div className="mb-6 flex justify-center"><Logo variant="full" className="h-14" /></div>
          {children}
        </div>
      </div>
    </main>
  );
}

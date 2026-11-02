import Link from "next/link";
import { Logo } from "@/components/logo";

// Public legal pages (privacy policy, account deletion). Linked from the Play Store listing.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/login" className="mb-8 inline-block"><Logo variant="full" className="h-12" /></Link>
        <article className="space-y-4 text-sm leading-relaxed text-slate-700 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-navy-900 [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-navy-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline">
          {children}
        </article>
        <p className="mt-10 border-t border-slate-100 pt-4 text-xs text-slate-400">
          <Link href="/privacy">Privacy policy</Link> · <Link href="/delete-account">Delete account</Link> · <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

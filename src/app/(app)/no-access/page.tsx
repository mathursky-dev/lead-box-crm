import Link from "next/link";
import { requireProfile, ROLE_LABEL } from "@/lib/auth";

export const metadata = { title: "No access" };

export default async function NoAccessPage() {
  const { profile } = await requireProfile();
  return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold text-navy-900">No access to this page</h1>
      <p className="mt-2 text-sm text-slate-500">Your role ({ROLE_LABEL[profile.role]}) is not allowed to open that page. Ask your company admin if you need it.</p>
      <Link href="/dashboard" className="btn-primary mt-4 inline-flex">Go to dashboard</Link>
    </div>
  );
}

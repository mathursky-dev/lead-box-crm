import { Logo } from "@/components/logo";
import { brandLogo, getHostBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getHostBrand();
  return (
    <main className="flex min-h-full items-center justify-center bg-navy-900 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <div className="mb-6 flex justify-center"><Logo variant="full" className="h-14" brand={brandLogo(brand)} /></div>
          {children}
        </div>
        {brand && (brand.support_email || brand.support_phone) && (
          <p className="mt-4 text-center text-xs text-slate-300">
            Help: {[brand.support_phone, brand.support_email].filter(Boolean).join(" · ")}
          </p>
        )}
        {brand && !brand.hide_powered_by && <p className="mt-2 text-center text-[11px] text-slate-400">Powered by Lead Box</p>}
      </div>
    </main>
  );
}

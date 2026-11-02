/* eslint-disable @next/next/no-img-element -- static brand assets */

// leadbox logo with the paper plane flying in once on load (like the brand video). Purely decorative.
const SRC = {
  mark: { src: "/leadbox-logo-mark.png", w: 367, h: 72, alt: "leadbox" },
  full: { src: "/leadbox-logo-full.png", w: 480, h: 124, alt: "leadbox — Simplify Sales, Accelerate Growth" },
} as const;

/** White-label partner look (logo + name). When set, it replaces the Lead Box logo. */
export type BrandLogo = { name: string; logo_url: string | null; tagline?: string | null } | null;

export function Logo({ variant = "mark", className = "", brand = null }: { variant?: keyof typeof SRC; className?: string; brand?: BrandLogo }) {
  if (brand) {
    return brand.logo_url ? (
      <span className={`inline-flex items-center ${className}`}>
        <img src={brand.logo_url} alt={brand.name} className="block h-full w-auto max-w-[11rem] object-contain" />
      </span>
    ) : (
      <span className={`inline-flex flex-col justify-center leading-tight ${className}`}>
        <span className={`font-bold text-navy-900 ${variant === "full" ? "text-2xl" : "text-lg"}`}>{brand.name}</span>
        {variant === "full" && brand.tagline && <span className="text-xs text-slate-500">{brand.tagline}</span>}
      </span>
    );
  }
  const s = SRC[variant];
  return (
    <span className={`lb-logo-anim relative inline-block ${className}`}>
      <img src={s.src} alt={s.alt} width={s.w} height={s.h} className="block h-full w-auto" />
      <img src="/leadbox-plane.png" alt="" aria-hidden width={91} height={70} className="lb-plane absolute"
        style={{ left: "82.3%", top: 0, width: "12.75%", height: "auto" }} />
    </span>
  );
}

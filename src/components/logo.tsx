/* eslint-disable @next/next/no-img-element -- static brand assets */

// leadbox logo with the paper plane flying in once on load (like the brand video). Purely decorative.
const SRC = {
  mark: { src: "/leadbox-logo-mark.png", w: 367, h: 72, alt: "leadbox" },
  full: { src: "/leadbox-logo-full.png", w: 480, h: 124, alt: "leadbox — Simplify Sales, Accelerate Growth" },
} as const;

export function Logo({ variant = "mark", className = "" }: { variant?: keyof typeof SRC; className?: string }) {
  const s = SRC[variant];
  return (
    <span className={`lb-logo-anim relative inline-block ${className}`}>
      <img src={s.src} alt={s.alt} width={s.w} height={s.h} className="block h-full w-auto" />
      <img src="/leadbox-plane.png" alt="" aria-hidden width={91} height={70} className="lb-plane absolute"
        style={{ left: "82.3%", top: 0, width: "12.75%", height: "auto" }} />
    </span>
  );
}

"use client";
import { usePathname } from "next/navigation";
import { PillTabs } from "./kit";

/** Route-driven pill tabs for section layouts (Admin, Nurture). The most specific matching tab is active. */
export function SectionTabs({ tabs, label }: { tabs: { href: string; label: string; icon?: string }[]; label: string }) {
  const path = usePathname();
  const active = tabs.filter((t) => path === t.href || path.startsWith(t.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return <PillTabs label={label} tabs={tabs.map((t) => ({ ...t, active: t.href === active }))} />;
}

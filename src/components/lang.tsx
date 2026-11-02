"use client";
import { createContext, useContext, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tr, type Lang } from "@/lib/i18n";
import { setLanguage } from "@/lib/actions/prefs";

const LangCtx = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
export function useT() {
  const lang = useContext(LangCtx);
  return (s: string) => tr(lang, s);
}

/** Translates fixed interface text; anything that is not a plain string passes through. */
export function Tx({ children }: { children?: React.ReactNode }) {
  const lang = useContext(LangCtx);
  return <>{typeof children === "string" ? tr(lang, children) : children}</>;
}

/** हिं / EN switch for the top bar. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useContext(LangCtx);
  const router = useRouter();
  const [pending, start] = useTransition();
  const next: Lang = lang === "hi" ? "en" : "hi";
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await setLanguage(next); router.refresh(); })}
      title={lang === "hi" ? "Switch to English" : "हिंदी में देखें"} aria-label={lang === "hi" ? "Switch to English" : "Switch to Hindi"}
      className={`inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-60 ${className}`}>
      {lang === "hi" ? "EN" : "हिंदी"}
    </button>
  );
}

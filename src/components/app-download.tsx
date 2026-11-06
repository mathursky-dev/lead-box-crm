"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./kit";
import { useT } from "./lang";
import { ANDROID_APK, IOS_APP_URL, PLAY_STORE_URL } from "@/lib/app-download";

type Os = "ios" | "android" | "other";
type Device = { os: Os; safari: boolean; installed: boolean; ready: boolean };

const PROMO_KEY = "lb_app_promo_until";
const DAY = 86_400_000;

/** Which phone this is, and whether the CRM is already running as an app (Android app or iPhone home-screen icon). */
export function useDevice(): Device {
  const [d, setD] = useState<Device>({ os: "other", safari: false, installed: false, ready: false });
  useEffect(() => {
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; a touch screen gives it away.
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    const nativeApp = Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setD({
      os: ios ? "ios" : android ? "android" : "other",
      safari: ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua),
      installed: nativeApp || standalone,
      ready: true,
    });
  }, []);
  return d;
}

const AndroidLogo = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52M7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5m10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5" />
  </svg>
);
const AppleLogo = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M16.37 12.6c-.03-2.6 2.13-3.86 2.22-3.92a4.78 4.78 0 0 0-3.76-2.03c-1.6-.16-3.12.94-3.93.94-.82 0-2.06-.92-3.39-.9a5.02 5.02 0 0 0-4.25 2.58c-1.82 3.15-.47 7.8 1.3 10.36.87 1.25 1.9 2.65 3.24 2.6 1.3-.05 1.8-.84 3.37-.84 1.57 0 2.02.84 3.4.81 1.4-.02 2.29-1.27 3.14-2.53a11 11 0 0 0 1.43-2.92 4.5 4.5 0 0 1-2.77-4.15M13.8 4.95A4.53 4.53 0 0 0 14.86 1.7a4.6 4.6 0 0 0-3 1.55 4.3 4.3 0 0 0-1.08 3.13 3.8 3.8 0 0 0 3.02-1.43" />
  </svg>
);

/** Top bar: "Get app" chip. Hidden inside the app itself and on the iPhone home-screen app. */
export function GetAppButton() {
  const t = useT();
  const d = useDevice();
  if (!d.ready || d.installed) return null;
  return (
    <Link href="/download-app" title={t("Download the mobile app")} aria-label={t("Download the mobile app")}
      className="flex h-9 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 text-sm font-semibold text-brand-700 hover:bg-brand-100 max-md:w-9 max-md:justify-center md:px-3">
      <Icon name="smartphone" className="h-4 w-4" /><span className="max-md:hidden">{t("Get app")}</span>
    </Link>
  );
}

/** After login, on a phone browser: a small bottom card offering the app. Closing it hides it for 14 days. */
export function AppPromo({ hideApk = false }: { hideApk?: boolean }) {
  const t = useT();
  const d = useDevice();
  const path = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!d.ready || d.installed || d.os === "other" || path.startsWith("/download-app") || path.startsWith("/inbox")) { setShow(false); return; }
    let until = 0;
    try { until = Number(localStorage.getItem(PROMO_KEY) ?? 0); } catch {}
    // Let the login day-brief popup come first.
    const id = window.setTimeout(() => setShow(Date.now() > until), 2500);
    return () => window.clearTimeout(id);
  }, [d, path]);
  const hide = (days: number) => { try { localStorage.setItem(PROMO_KEY, String(Date.now() + days * DAY)); } catch {} setShow(false); };
  if (!show) return null;
  const apk = d.os === "android" && !hideApk;
  return (
    <div role="dialog" aria-label={t("Get the Lead Box app")} className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl shadow-sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-navy-900">{t("Get the Lead Box app")}</div>
          <p className="mt-0.5 text-xs text-slate-500">{d.os === "ios" ? t("Add Lead Box to your iPhone home screen. Opens full screen, like an app.") : t("Leads, chats and follow-ups in one tap. Free.")}</p>
        </div>
        <button onClick={() => hide(14)} aria-label={t("Close")} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><Icon name="x" className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 flex gap-2">
        {apk
          ? <a href={ANDROID_APK.url} download onClick={() => hide(60)} className="btn-primary flex-1 justify-center"><AndroidLogo className="h-4 w-4" />{t("Download app")}</a>
          : <Link href="/download-app" onClick={() => hide(30)} className="btn-primary flex-1 justify-center">{d.os === "ios" ? <AppleLogo className="h-4 w-4" /> : <Icon name="download" className="h-4 w-4" />}{d.os === "ios" ? t("Install on iPhone") : t("How to install")}</Link>}
        <button onClick={() => hide(14)} className="btn-ghost">{t("Later")}</button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-navy-900">{n}</span>
      <span className="min-w-0 pt-0.5 text-sm text-slate-700">{children}</span>
    </li>
  );
}

/** Body of /download-app: Android (APK) and iPhone cards, the visitor's own phone first, plus a QR code for computers. */
export function DownloadApp({ qr, link, appName, hideApk = false }: { qr: string | null; link: string; appName: string; hideApk?: boolean }) {
  const t = useT();
  const d = useDevice();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };

  const android = (
    <section key="android" className={`rounded-2xl border bg-white p-5 shadow-sm ${d.os === "android" ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200"}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#3ddc84]/15 text-[#16a34a]"><AndroidLogo className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-navy-900">{t("Android phone")}</h2>
          <p className="text-xs text-slate-500">{hideApk ? t("Install from Chrome") : `${t("Version")} ${ANDROID_APK.version} · ${ANDROID_APK.size} · Android 7+`}</p>
        </div>
        {d.os === "android" && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{t("Your phone")}</span>}
      </div>
      {hideApk ? (
        <ol className="mt-4 space-y-3">
          <Step n={1}>{t("Open this page in Chrome on your Android phone.")}</Step>
          <Step n={2}>{t("Tap the ⋮ menu (top right).")}</Step>
          <Step n={3}>{t("Tap “Install app” or “Add to Home screen”, then Install.")}</Step>
        </ol>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={ANDROID_APK.url} download className="btn-primary h-11 flex-1 justify-center px-5 text-base"><Icon name="download" className="h-5 w-5" />{t("Download APK")}</a>
            {PLAY_STORE_URL && <a href={PLAY_STORE_URL} target="_blank" rel="noopener" className="btn-ghost h-11 justify-center px-4">Google Play</a>}
          </div>
          <ol className="mt-4 space-y-3">
            <Step n={1}>{t("Tap Download APK. The file (leadbox.apk) saves to your phone.")}</Step>
            <Step n={2}>{t("Open it from the notification bar or the Downloads folder.")}</Step>
            <Step n={3}>{t("If the phone asks, allow “Install unknown apps” for Chrome / Files, then go back.")}</Step>
            <Step n={4}>{t("Tap Install, open Lead Box and log in with the same ID and password.")}</Step>
          </ol>
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("If Google Play Protect shows a warning, tap “More details” → “Install anyway”. It shows for every app that is not from the Play Store.")}</p>
        </>
      )}
    </section>
  );

  const iphone = (
    <section key="ios" className={`rounded-2xl border bg-white p-5 shadow-sm ${d.os === "ios" ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200"}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-navy-900 text-white"><AppleLogo className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-navy-900">{t("iPhone / iPad")}</h2>
          <p className="text-xs text-slate-500">{IOS_APP_URL ? "App Store" : t("Add to Home Screen · no download needed")}</p>
        </div>
        {d.os === "ios" && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{t("Your phone")}</span>}
      </div>
      {IOS_APP_URL ? (
        <a href={IOS_APP_URL} target="_blank" rel="noopener" className="btn-primary mt-4 h-11 w-full justify-center text-base"><AppleLogo className="h-5 w-5" />{t("Open in App Store")}</a>
      ) : (
        <>
          {d.os === "ios" && !d.safari && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("Open this page in Safari first: copy the link below and paste it in Safari.")}</p>
          )}
          <ol className="mt-4 space-y-3">
            <Step n={1}>{t("Open")} <b>{link.replace(/^https?:\/\//, "").replace(/\/download-app$/, "")}</b> {t("in Safari and log in.")}</Step>
            <Step n={2}><span className="inline-flex flex-wrap items-center gap-1">{t("Tap the Share button")} <span className="inline-grid h-6 w-6 place-items-center rounded-md border border-slate-200 bg-slate-50 text-sky-600"><Icon name="share" className="h-3.5 w-3.5" /></span> {t("at the bottom of Safari.")}</span></Step>
            <Step n={3}><span className="inline-flex flex-wrap items-center gap-1">{t("Scroll down and tap")} <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-navy-900"><Icon name="plus-square" className="h-3.5 w-3.5" />{t("Add to Home Screen")}</span></span></Step>
            <Step n={4}>{t("Tap Add. The")} {appName} {t("icon comes on your home screen and opens full screen, like an app.")}</Step>
          </ol>
        </>
      )}
      <button onClick={copy} className="btn-ghost btn-sm mt-4"><Icon name="link" className="h-4 w-4" />{copied ? t("Link copied") : t("Copy link")}</button>
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 to-navy-800 p-5 text-white shadow-sm sm:p-6">
        <div className="flex items-center gap-4">
          <img src="/icons/icon-192.png" alt="" className="h-16 w-16 shrink-0 rounded-2xl shadow-lg ring-1 ring-white/10" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold sm:text-xl">{appName} {t("on your phone")}</h2>
            <p className="mt-0.5 text-sm text-slate-300">{t("Leads, WhatsApp chats, follow-ups and calls, always in your pocket. Free for your team.")}</p>
          </div>
        </div>
        {d.installed && <p className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm">{t("You are already using the app on this phone.")}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">{d.os === "ios" ? [iphone, android] : [android, iphone]}</div>
      {qr && d.ready && d.os === "other" && (
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={t("QR code to open this page on your phone")} className="h-36 w-36 shrink-0 rounded-lg border border-slate-100" />
          <div className="text-center sm:text-left">
            <h2 className="font-semibold text-navy-900">{t("On a computer? Scan with your phone")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("Open the phone camera and point it at this code. This page opens on the phone, with the right button for Android or iPhone.")}</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-400">{link}</p>
          </div>
        </section>
      )}
    </div>
  );
}

import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireProfile } from "@/lib/auth";
import { getUserBrand } from "@/lib/brand";
import { PageHeader } from "@/components/static";
import { DownloadApp } from "@/components/app-download";

export const metadata = { title: "Download app" };

export default async function DownloadAppPage() {
  await requireProfile({ allowUnpaid: true });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "wacrm.leadboxs.in";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const link = `${proto}://${host}/download-app`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 288, color: { dark: "#0b1f3a", light: "#ffffff" } }).catch(() => null);
  // White-label partners: the Android APK is Lead Box branded, so their users install from the browser instead.
  const brand = await getUserBrand();
  return (
    <>
      <PageHeader icon="smartphone" tone="green" title="Download app" sub="Install the CRM on Android or iPhone and open it with one tap." />
      <DownloadApp qr={qr} link={link} appName={brand?.name ?? "Lead Box"} hideApk={Boolean(brand)} />
    </>
  );
}

import { requireProfile, isAdmin } from "@/lib/auth";
import { WaHeader } from "./tabs";

export const metadata = { title: "WhatsApp Business" };

export default async function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  return (
    <div className="mx-auto max-w-7xl">
      <WaHeader admin={isAdmin(profile)} />
      {children}
    </div>
  );
}

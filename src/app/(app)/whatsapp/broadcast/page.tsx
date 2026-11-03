import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { loadRefs } from "@/lib/data";
import { Panel, EmptyState } from "../ui";
import { BroadcastBuilder } from "./builder";
import { isSmartKey } from "@/lib/segments";

export const metadata = { title: "Broadcast · WhatsApp" };

export default async function BroadcastPage({ searchParams }: { searchParams: Promise<{ smart?: string }> }) {
  const { profile } = await requireProfile();
  const smart = (await searchParams).smart?.split(",").filter(isSmartKey) ?? [];
  if (!can(profile, "campaigns.manage")) {
    return <Panel title="Broadcast" icon="megaphone"><EmptyState icon="megaphone" title="No access">Ask your admin for the “Create campaigns &amp; segments” permission to send broadcasts.</EmptyState></Panel>;
  }
  const refs = await loadRefs();
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        Pick a customer group (VIP, repeat buyers, inactive… see <Link className="text-brand-700 hover:underline" href="/whatsapp/segments">Segments</Link>) or leads by status, tag, source and more, choose an approved template and send. Track sent, delivered, read and replies in <Link className="text-brand-700 hover:underline" href="/whatsapp/campaigns">Campaigns</Link>.
        To message hand-picked leads, select them on <Link className="text-brand-700 hover:underline" href="/leads">Leads</Link> and use <b>WhatsApp</b> in the bulk bar.
      </p>
      <BroadcastBuilder
        statuses={refs.statuses.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        subStatuses={refs.subStatuses.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name, status_id: s.status_id }))}
        tags={refs.tags} sources={refs.sources.filter((s) => s.is_active !== false)} products={refs.products.filter((s) => s.is_active !== false)}
        owners={refs.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.full_name }))} smart={smart} />
    </>
  );
}

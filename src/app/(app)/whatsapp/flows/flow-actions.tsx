"use client";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui";
import { toggleFlow, deleteFlow, duplicateFlow } from "@/lib/actions/wa-flows";

export function FlowRowActions({ id, active, name }: { id: string; active: boolean; name: string }) {
  const router = useRouter();
  return (
    <>
      <ActionButton action={() => toggleFlow(id, !active)}>{active ? "Turn off" : "Turn on"}</ActionButton>
      <ActionButton action={async () => { const r = await duplicateFlow(id); if (r.id) router.push(`/whatsapp/flows/${r.id}`); return r; }}>Duplicate</ActionButton>
      <ActionButton action={() => deleteFlow(id)} confirm={`Delete flow “${name}”? Running chats stop at once.`}>Delete</ActionButton>
    </>
  );
}

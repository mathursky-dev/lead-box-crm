"use client";
import { ActionButton } from "@/components/ui";
import { completeFollowup } from "@/lib/actions/leads";

export function FollowupActions({ id }: { id: string }) {
  return (
    <span className="inline-flex gap-1">
      <ActionButton action={() => completeFollowup(id)}>Mark done</ActionButton>
      <ActionButton action={() => completeFollowup(id, true)} confirm="Cancel this follow-up?">Cancel</ActionButton>
    </span>
  );
}

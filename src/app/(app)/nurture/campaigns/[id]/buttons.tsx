"use client";
import { ActionButton } from "@/components/ui";
import { campaignAction } from "@/lib/actions/nurture";

export function CampaignButtons({ id, status, manage, approve }: { id: string; status: string; manage: boolean; approve: boolean }) {
  return (
    <>
      {manage && status === "draft" && <ActionButton className="btn-primary btn-sm" action={() => campaignAction(id, "submit")}>Submit for approval</ActionButton>}
      {approve && status === "pending_approval" && (
        <>
          <ActionButton className="btn-primary btn-sm" action={() => campaignAction(id, "approve")}
            confirm="Approve this campaign? It will start sending at its scheduled time (or now), subject to consent, quiet hours and frequency caps.">Approve & schedule</ActionButton>
          <ActionButton action={() => campaignAction(id, "reject")} confirm="Send back to draft?">Send back</ActionButton>
        </>
      )}
      {manage && !["completed", "cancelled"].includes(status) && (
        <ActionButton action={() => campaignAction(id, "cancel")} confirm="Cancel this campaign? Messages not yet queued will not be sent.">Cancel</ActionButton>
      )}
    </>
  );
}

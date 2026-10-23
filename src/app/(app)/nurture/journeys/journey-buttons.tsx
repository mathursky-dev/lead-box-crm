"use client";
import Link from "next/link";
import { ActionButton } from "@/components/ui";
import { journeyAction } from "@/lib/actions/nurture";

export function JourneyButtons({ id, status, published }: { id: string; status: string; published: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Link className="btn-primary btn-sm" href={`/nurture/journeys/${id}/preview`}>Preview & publish</Link>
      {status !== "active" && published && <ActionButton action={() => journeyAction(id, "activate")} confirm="Resume this journey on its published version?">Resume</ActionButton>}
      {status === "active" && <ActionButton action={() => journeyAction(id, "pause")} confirm="Pause this journey? Scheduled steps wait until it is resumed.">Pause</ActionButton>}
      {status !== "archived" && <ActionButton action={() => journeyAction(id, "archive")} confirm="Archive this journey? Every running enrolment is stopped.">Archive</ActionButton>}
    </span>
  );
}

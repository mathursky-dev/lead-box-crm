import { redirect } from "next/navigation";

// Statuses + sub-statuses now live in Settings → Manage Status.
export default function StatusesPage() {
  redirect("/settings/statuses");
}

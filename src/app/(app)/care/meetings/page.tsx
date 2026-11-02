import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { MeetingForms } from "./ui";

export const metadata = { title: "Meeting links" };

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  if (!hasServiceRole()) return <ErrorBox message="The server is not configured (service role key)." />;
  const db = createAdminClient();
  const [s, acc] = await Promise.all([
    db.from("lb_care_settings").select("meeting_mode,meeting_fixed_url").eq("company_id", profile.company_id).maybeSingle(),
    db.from("lb_meeting_accounts").select("zoom_account_id,zoom_client_id,google_email,google_refresh_enc,google_calendar_id").eq("company_id", profile.company_id).maybeSingle(),
  ]);
  if (s.error || acc.error) return <ErrorBox message="Meeting links are not set up yet: the database update has to be run once (Supabase SQL)." />;
  return (
    <div className="space-y-4">
      {sp.error && <ErrorBox message={sp.error} />}
      {sp.ok === "google" && <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">Google connected. Pick “Google Meet” below and save.</div>}
      <MeetingForms
        mode={(s.data?.meeting_mode as string) ?? "none"} fixedUrl={(s.data?.meeting_fixed_url as string) ?? ""}
        zoom={acc.data?.zoom_client_id ? { accountId: acc.data.zoom_account_id as string, clientId: acc.data.zoom_client_id as string } : null}
        google={acc.data?.google_refresh_enc ? { email: (acc.data.google_email as string) ?? "Google account", calendar: (acc.data.google_calendar_id as string) ?? "primary" } : null}
        googleReady={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
      />
    </div>
  );
}

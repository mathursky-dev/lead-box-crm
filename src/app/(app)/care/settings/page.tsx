import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { careSettings } from "@/lib/care-server";
import { newBookingCode } from "@/lib/actions/care";
import { CareSettingsForms } from "../ui";

export const metadata = { title: "Customer care settings" };

export default async function CareSettingsPage() {
  const { profile } = await requireAdmin();
  if (!hasServiceRole()) return <ErrorBox message="The server is not configured (service role key)." />;
  const [s, refs] = await Promise.all([careSettings(createAdminClient(), profile.company_id), loadRefs()]);
  if (!s) return <ErrorBox message="Customer care is not set up yet: the database update has to be run once (Supabase SQL)." />;
  return <CareSettingsForms s={s} sources={refs.sources.filter((x) => x.is_active !== false)} defaultCode={await newBookingCode()} />;
}

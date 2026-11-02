import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { RET_COLS, RET_DEFAULTS, type RetentionSettings } from "@/lib/retention";

type Db = ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Company settings (defaults when never saved). null = the loyalty / tickets / renewals SQL is not applied yet. */
export async function retentionSettings(db: Db, companyId: string): Promise<RetentionSettings | null> {
  const { data, error } = await db.from("lb_retention_settings").select(RET_COLS).eq("company_id", companyId).maybeSingle();
  if (error) return null;
  const row = (data ?? {}) as Partial<RetentionSettings>;
  return {
    ...RET_DEFAULTS, ...row,
    points_per_100: Number(row.points_per_100 ?? RET_DEFAULTS.points_per_100),
    point_value: Number(row.point_value ?? RET_DEFAULTS.point_value),
  };
}

export const RET_NOT_READY = "Loyalty, tickets and renewals are not set up yet: the database update has to be run once (Supabase SQL).";
export const retNotReady = (m: string) =>
  /lb_retention|lb_loyalty|lb_ticket|lb_renewal|lb_set_customer_dates|lb_upcoming_wishes|lb_portal_ticket|birthday|anniversary|schema cache/i.test(m);

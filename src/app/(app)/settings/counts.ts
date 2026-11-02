import "server-only";
import { createClient } from "@/lib/supabase/server";

type Counts = { status: Record<string, number>; source: Record<string, number>; department: Record<string, number>; tag: Record<string, number> };

/** Leads per master row (active company). Empty maps if the SQL is not applied yet. */
export async function leadCounts(): Promise<Counts> {
  const { data } = await (await createClient()).rpc("lb_master_lead_counts");
  const d = (data ?? {}) as Partial<Counts>;
  return { status: d.status ?? {}, source: d.source ?? {}, department: d.department ?? {}, tag: d.tag ?? {} };
}

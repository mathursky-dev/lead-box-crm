"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";

const n = (max: number) => z.union([z.coerce.number().int().min(0).max(max), z.literal("")]);
const Rows = z.array(z.object({
  user_id: z.uuid(),
  won_target: n(100000), value_target: z.union([z.coerce.number().min(0).max(1e11), z.literal("")]),
  calls_target: n(1000000), followups_target: n(1000000), visits_target: n(100000),
})).max(500);

/** Save all five monthly targets (admins: anyone; team leaders: their team; checked in lb_set_targets). */
export async function saveAgentTargets(month: string, rows: unknown): Promise<{ error?: string; ok?: string }> {
  await requireProfile();
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { error: "Invalid month" };
  const p = Rows.safeParse(rows);
  if (!p.success) return { error: "Targets must be whole numbers (0 or more)." };
  const { error } = await (await createClient()).rpc("lb_set_targets", {
    p_month: month,
    p_rows: p.data.map((r) => ({
      user_id: r.user_id, won_target: String(r.won_target), value_target: String(r.value_target),
      calls_target: String(r.calls_target), followups_target: String(r.followups_target), visits_target: String(r.visits_target),
    })),
  });
  if (error) return { error: errMsg(error) };
  revalidatePath("/targets");
  revalidatePath("/leaderboard");
  return { ok: "Targets saved." };
}

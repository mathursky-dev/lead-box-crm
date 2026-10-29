"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { TOPUP_MAX, TOPUP_MIN, UTR_RE } from "@/lib/upi";

type FormState = { error?: string; ok?: string } | undefined;

const topupSchema = z.object({
  amount: z.coerce.number().min(TOPUP_MIN, `Minimum ₹${TOPUP_MIN}.`).max(TOPUP_MAX, "Amount is too large."),
  utr: z.string().transform((v) => v.replace(/\s/g, "")).pipe(z.string().regex(UTR_RE, "Enter the 12-digit UTR / UPI reference number from your UPI app.")),
});

/** Company admin says "I paid ₹X over UPI, UTR Y". The wallet is credited once the Super Admin approves it. */
export async function requestTopup(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { profile } = await requireProfile();
    if (!isAdmin(profile)) return { error: "Only an admin can add balance." };
    const p = topupSchema.safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const sb = await createClient();
    const { error } = await sb.rpc("lb_wallet_request_topup", { p_amount: p.data.amount, p_utr: p.data.utr });
    if (error) return { error: error.message };
    revalidatePath("/wallet");
    return { ok: `Payment of ₹${p.data.amount.toLocaleString("en-IN")} submitted. Balance is added as soon as it is verified (usually within a few hours).` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

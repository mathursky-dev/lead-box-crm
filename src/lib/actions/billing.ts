"use server";
import { redirect } from "next/navigation";
import { requireProfile, isAdmin } from "@/lib/auth";
import { activeSeats, createPaymentLink, razorpayConfigured } from "@/lib/billing";
import { getPlan, priceFor } from "@/lib/plans";
import type { FormState } from "./auth";

/** Starts a Razorpay checkout for every active user in the company. */
export async function startCheckout(_?: FormState, form?: FormData): Promise<FormState> {
  const { profile, billing } = await requireProfile({ allowUnpaid: true });
  if (!isAdmin(profile)) return { error: "Only an admin can pay for the workspace." };
  if (!razorpayConfigured()) return { error: "Online payment is not set up yet. Contact us to activate your plan." };
  const seats = await activeSeats(profile.company_id);
  // The chosen plan must be one offered publicly, or the company's current plan.
  const wanted = String(form?.get("plan_id") ?? "") || billing?.plan_id || null;
  const plan = await getPlan(wanted);
  if (wanted && (!plan || !plan.is_active || (!plan.is_public && plan.id !== billing?.plan_id))) return { error: "That plan is not available." };
  if (plan && plan.price_inr === 0) return { error: "This plan is free. Contact us to activate it." };
  let url: string;
  try {
    const link = await createPaymentLink({
      companyId: profile.company_id, seats, name: profile.full_name, email: profile.email,
      phone: profile.phone, plan: plan ? { id: plan.id, name: plan.name, amountInr: priceFor(plan, seats), days: plan.period_days } : undefined,
      callbackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/billing/razorpay/callback`,
    });
    url = link.short_url;
  } catch (e) {
    console.error("razorpay link failed", e);
    return { error: "Could not start the payment. Try again in a minute." };
  }
  redirect(url);
}

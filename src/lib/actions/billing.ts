"use server";
import { redirect } from "next/navigation";
import { requireProfile, isAdmin } from "@/lib/auth";
import { activeSeats, createPaymentLink, razorpayConfigured } from "@/lib/billing";
import type { FormState } from "./auth";

/** Starts a Razorpay checkout for every active user in the company. */
export async function startCheckout(): Promise<FormState> {
  const { profile } = await requireProfile({ allowUnpaid: true });
  if (!isAdmin(profile)) return { error: "Only an admin can pay for the workspace." };
  if (!razorpayConfigured()) return { error: "Online payment is not set up yet. Contact us to activate your plan." };
  const seats = await activeSeats(profile.company_id);
  let url: string;
  try {
    const link = await createPaymentLink({
      companyId: profile.company_id, seats, name: profile.full_name, email: profile.email,
      phone: profile.phone, callbackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/billing/razorpay/callback`,
    });
    url = link.short_url;
  } catch (e) {
    console.error("razorpay link failed", e);
    return { error: "Could not start the payment. Try again in a minute." };
  }
  redirect(url);
}

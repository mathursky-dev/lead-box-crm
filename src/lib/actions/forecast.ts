"use server";
import { revalidatePath } from "next/cache";
import { requireProfile, can } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { aiConfigured, AiError, forecastSales } from "@/lib/ai";
import { aiInput } from "@/lib/forecast";
import { loadForecastData, parseTarget } from "@/lib/forecast-server";
import { rateLimit } from "./auth";
import { errMsg } from "@/lib/util";

/** Runs the AI forecast for this or next month and saves it for the whole management team. */
export async function runAiForecast(which: string): Promise<{ error?: string; ok?: boolean }> {
  try {
    const { profile, company, features } = await requireProfile();
    if (!features.includes("ai")) return { error: "AI is not included in your plan. Upgrade from the Billing page." };
    if (!can(profile, "reports.view") || !can(profile, "ai.use")) return { error: "You need the Reports and AI permissions to run the forecast." };
    const sb = await createClient();
    const { data: co } = await sb.from("lb_companies").select("ai_enabled,name").eq("id", company.id).single();
    if (!co?.ai_enabled) return { error: "AI is turned off for this company (Admin → Settings)." };
    if (!aiConfigured()) return { error: "AI is not configured on the server (ANTHROPIC_API_KEY)." };
    if (!hasServiceRole()) return { error: "Saving the forecast needs the server to be configured (service role key)." };
    if (!(await rateLimit(`ai-forecast:${company.id}`, 10, 3600))) return { error: "Forecast limit reached (10 per hour for the company). Try again later." };

    const target = parseTarget(which);
    const d = await loadForecastData(sb, target);
    if (d.error) return { error: d.error };
    if (!d.series.length) return { error: "No sales yet. Mark leads Won, record paid invoices or store orders first." };
    const input = aiInput(d.series, d.months, d.target, d.current);
    const r = await forecastSales(input, co.name || company.name || "the business");
    const { model, ...result } = r;
    const { error } = await createAdminClient().from("lb_sales_forecasts").insert({
      company_id: company.id, month: d.target, created_by: profile.id, model, input, result,
    });
    if (error) return { error: errMsg(error) };
    revalidatePath("/forecast");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof AiError ? e.message : (e as Error).message || "AI forecast failed." };
  }
}

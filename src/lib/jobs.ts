import "server-only";
import { createAdminClient, hasServiceRole } from "./supabase/server";
import { summarizeConversation, aiConfigured, AiError } from "./ai";

/** Runs queued lb_jobs (journey-requested AI summaries) with bounded retries; failures land in the failed-job queue. */
export async function runQueuedJobs(limit = 5) {
  if (!hasServiceRole()) return { done: 0, failed: 0 };
  const db = createAdminClient();
  const { data: jobs, error } = await db.rpc("lb_claim_jobs", { p_limit: limit });
  if (error || !jobs?.length) return { done: 0, failed: 0 };
  let done = 0, failed = 0;
  for (const job of jobs as { id: string; company_id: string; kind: string; payload: { customer_id?: string; lead_id?: string; notify_user?: string } }[]) {
    try {
      if (job.kind !== "ai_summary") throw new AiError(`Unknown job kind ${job.kind}`, false);
      const { data: co } = await db.from("lb_companies").select("ai_enabled").eq("id", job.company_id).single();
      if (!co?.ai_enabled) throw new AiError("AI is turned off for this company.", false);
      if (!aiConfigured()) throw new AiError("AI is not configured on the server (ANTHROPIC_API_KEY).", false);
      const { data: conv } = await db.from("lb_conversations").select("id, lead_id, customer:lb_customers(name, wa_profile_name)")
        .eq("company_id", job.company_id).eq("customer_id", job.payload.customer_id ?? "").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      if (!conv) throw new AiError("No WhatsApp conversation to summarise.", false);
      const { data: msgs } = await db.from("lb_messages").select("direction,body,type,created_at").eq("conversation_id", conv.id)
        .order("created_at", { ascending: false }).limit(40);
      if (!msgs?.length) throw new AiError("No messages to summarise.", false);
      const cu = conv.customer as unknown as { name: string | null; wa_profile_name: string | null };
      const r = await summarizeConversation(cu.name || cu.wa_profile_name || "Customer", msgs.reverse() as never[]);
      await db.from("lb_ai_outputs").insert({ company_id: job.company_id, conversation_id: conv.id, lead_id: conv.lead_id, kind: "summary", content: r.text, model: r.model });
      if (job.payload.notify_user) {
        await db.from("lb_notifications").insert({ company_id: job.company_id, user_id: job.payload.notify_user, type: "ai", title: "AI summary ready",
          body: r.text.slice(0, 140), link: `/inbox?c=${conv.id}`, dedupe_key: `aisum:${job.id}` });
      }
      await db.rpc("lb_finish_job", { p_id: job.id, p_ok: true, p_result: { conversation_id: conv.id }, p_error: null, p_retryable: false });
      done++;
    } catch (e) {
      const retryable = e instanceof AiError ? e.retryable : true;
      await db.rpc("lb_finish_job", { p_id: job.id, p_ok: false, p_result: null, p_error: (e as Error).message, p_retryable: retryable });
      failed++;
    }
  }
  return { done, failed };
}

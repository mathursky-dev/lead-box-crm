// AI FAQ bot settings shape + defaults (safe for server and client).
export type AiBotSettings = {
  enabled: boolean; bot_name: string; hours_rule: "always" | "outside" | "inside"; number_id: string | null;
  use_knowledge: boolean; use_products: boolean; handover_message: string; handover_assign_to: string | null;
  handover_pause_hours: number; max_replies_per_chat: number; daily_limit: number; instructions: string | null;
};

export const DEFAULT_AI_BOT: AiBotSettings = {
  enabled: false, bot_name: "Assistant", hours_rule: "always", number_id: null, use_knowledge: true, use_products: true,
  handover_message: "Thank you! Our team member will reply to you here shortly. 🙏", handover_assign_to: null,
  handover_pause_hours: 12, max_replies_per_chat: 15, daily_limit: 500, instructions: null,
};

export type AiFaqRow = {
  id: string; kind: "faq" | "price"; question: string; answer: string; price: number | null; unit: string | null;
  category: string | null; is_active: boolean; sort: number; hit_count: number;
};

/**
 * Bulk paste parser.
 *  FAQs:  "Q: ... / A: ..." blocks, or one per line "question | answer" (also tab or " - " separated).
 *  Price: one per line "Item | Price | Unit | Note" (comma also works when there is no | or tab).
 */
export function parseBulk(kind: "faq" | "price", text: string) {
  const out: { question: string; answer: string; price: number | null; unit: string | null }[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (kind === "faq" && lines.some((l) => /^q\s*[:.)-]/i.test(l))) {
    let q = "", a: string[] = [], inA = false;
    const flush = () => { if (q && a.join(" ").trim()) out.push({ question: q, answer: a.join("\n").trim(), price: null, unit: null }); q = ""; a = []; inA = false; };
    for (const l of lines) {
      if (/^q\s*[:.)-]/i.test(l)) { flush(); q = l.replace(/^q\s*[:.)-]\s*/i, ""); }
      else if (/^a\s*[:.)-]/i.test(l)) { inA = true; a.push(l.replace(/^a\s*[:.)-]\s*/i, "")); }
      else if (l && inA) a.push(l);
      else if (l && q && !inA) q += " " + l;
    }
    flush();
    return out;
  }
  for (const l of lines) {
    if (!l) continue;
    const sep = l.includes("|") ? "|" : l.includes("\t") ? "\t" : kind === "price" ? "," : " - ";
    // "Rs. 1,299" in a comma separated line: drop the thousands comma before splitting.
    const line = sep === "," ? l.replace(/(\d),(?=\d{2,3}\b)/g, "$1") : l;
    const parts = line.split(sep).map((x) => x.trim());
    if (kind === "faq") {
      if (parts.length < 2 || !parts[0] || !parts.slice(1).join(sep).trim()) continue;
      out.push({ question: parts[0], answer: parts.slice(1).join(sep === "|" ? " | " : sep).trim(), price: null, unit: null });
    } else {
      if (!parts[0]) continue;
      const n = parts[1] ? Number(parts[1].replace(/[₹,\s]|rs\.?|inr/gi, "")) : NaN;
      out.push({ question: parts[0], price: Number.isFinite(n) ? n : null, unit: parts[2] || null, answer: parts.slice(3).join(", ") || (Number.isFinite(n) ? "" : parts.slice(1).join(", ")) });
    }
  }
  return out;
}

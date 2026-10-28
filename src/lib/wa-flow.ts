// Visual WhatsApp chatbot flows: graph model, validation and the step engine.
// Pure and shared: the webhook engine (lib/wa-flows.ts) and the editor's simulator run the same code.
import { botMatches } from "./wa";

export type NodeType =
  | "start" | "message" | "media" | "template" | "location" | "contact" | "product"
  | "buttons" | "list" | "question"
  | "condition" | "tag" | "field" | "assign" | "webhook" | "end";

export type Choice = { id: string; title: string; description?: string };
export type NodeData = {
  text?: string; footer?: string; header?: string;
  media_type?: "image" | "video" | "audio" | "document" | "sticker"; url?: string; filename?: string;
  template_name?: string; template_language?: string; params?: string[];
  latitude?: string; longitude?: string; name?: string; address?: string;
  contact_name?: string; contact_phone?: string; contact_email?: string; contact_org?: string;
  catalog_id?: string; product_ids?: string;
  choices?: Choice[]; button?: string;
  variable?: string; validate?: "text" | "number" | "email" | "phone"; error_text?: string;
  op?: "contains" | "equals" | "not_empty" | "gt" | "lt" | "has_tag"; value?: string;
  tag?: string; tag_op?: "add" | "remove";
  field?: "name" | "email" | "location";
  user_id?: string; note?: string;
  webhook_url?: string;
};
export type FlowNode = { id: string; type: NodeType; x: number; y: number; data: NodeData };
export type FlowEdge = { id: string; from: string; port: string; to: string };
export type FlowSettings = { timeout_hours: number; invalid_text: string; max_retries: number; restart_keyword: string; stop_keyword: string };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[]; settings: FlowSettings };

export const DEFAULT_SETTINGS: FlowSettings = {
  timeout_hours: 24, invalid_text: "Please choose one of the options above 🙏", max_retries: 2, restart_keyword: "menu", stop_keyword: "stop bot",
};

type Def = { label: string; sub: string; group: "Send" | "Ask" | "Logic" | "Actions"; icon: string; color: string; data: () => NodeData };
export const BLOCKS: Record<Exclude<NodeType, "start">, Def> = {
  message: { label: "Message", sub: "Send a text message", group: "Send", icon: "chat", color: "#0d9488", data: () => ({ text: "Hello {{name}} 👋" }) },
  media: { label: "Media", sub: "Image, video, audio, document or sticker", group: "Send", icon: "upload", color: "#0891b2", data: () => ({ media_type: "image", url: "", text: "" }) },
  template: { label: "Template", sub: "Send an approved template", group: "Send", icon: "template", color: "#7c3aed", data: () => ({ template_name: "", template_language: "en", params: [] }) },
  location: { label: "Location", sub: "Share a map pin", group: "Send", icon: "target", color: "#2563eb", data: () => ({ latitude: "", longitude: "", name: "", address: "" }) },
  contact: { label: "Contact card", sub: "Share a vCard", group: "Send", icon: "user", color: "#0369a1", data: () => ({ contact_name: "", contact_phone: "" }) },
  product: { label: "Product", sub: "Catalog product(s)", group: "Send", icon: "cart", color: "#ea580c", data: () => ({ catalog_id: "", product_ids: "", text: "Have a look 👇" }) },
  buttons: { label: "Buttons", sub: "Up to 3 quick-reply buttons", group: "Ask", icon: "grid", color: "#2563eb",
    data: () => ({ text: "What would you like to do?", choices: [{ id: rid("b"), title: "Sales" }, { id: rid("b"), title: "Support" }] }) },
  list: { label: "List menu", sub: "Up to 10 list rows", group: "Ask", icon: "list", color: "#4f46e5",
    data: () => ({ text: "Please pick an option", button: "View options", choices: [{ id: rid("r"), title: "Option 1" }, { id: rid("r"), title: "Option 2" }] }) },
  question: { label: "Question", sub: "Ask and save the answer", group: "Ask", icon: "help", color: "#9333ea", data: () => ({ text: "What is your name?", variable: "name", validate: "text" }) },
  condition: { label: "Condition", sub: "Branch on an answer or tag", group: "Logic", icon: "filter", color: "#d97706", data: () => ({ variable: "last_reply", op: "contains", value: "" }) },
  tag: { label: "Tag chat", sub: "Add or remove a chat tag", group: "Actions", icon: "tag", color: "#db2777", data: () => ({ tag: "", tag_op: "add" }) },
  field: { label: "Update contact", sub: "Save a variable to the contact", group: "Actions", icon: "contacts", color: "#0f766e", data: () => ({ field: "name", variable: "name" }) },
  assign: { label: "Hand off to agent", sub: "Assign the chat and stop the bot", group: "Actions", icon: "agent", color: "#475569", data: () => ({ user_id: "", text: "Connecting you to our team 🙏" }) },
  webhook: { label: "Webhook", sub: "POST the answers to a URL", group: "Actions", icon: "link", color: "#334155", data: () => ({ webhook_url: "" }) },
  end: { label: "End", sub: "Finish the flow", group: "Actions", icon: "check", color: "#dc2626", data: () => ({}) },
};
export const GROUPS = ["Send", "Ask", "Logic", "Actions"] as const;

export function rid(prefix = "n") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

/** Output ports of a node, in display order. "other" catches replies that match no choice. */
export function portsOf(n: FlowNode): { id: string; label: string }[] {
  switch (n.type) {
    case "end": case "assign": return [];
    case "buttons": case "list": return [...(n.data.choices ?? []).map((c) => ({ id: c.id, label: c.title || "…" })), { id: "other", label: "other reply" }];
    case "condition": return [{ id: "yes", label: "yes" }, { id: "no", label: "no" }];
    default: return [{ id: "next", label: "" }];
  }
}

export const isAsk = (t: NodeType) => t === "buttons" || t === "list" || t === "question";

export function newGraph(): FlowGraph {
  const start: FlowNode = { id: "start", type: "start", x: 80, y: 160, data: {} };
  const ask: FlowNode = { id: rid(), type: "buttons", x: 460, y: 120, data: BLOCKS.buttons.data() };
  return { nodes: [start, ask], edges: [{ id: rid("e"), from: "start", port: "next", to: ask.id }], settings: { ...DEFAULT_SETTINGS } };
}

/** Repairs anything imported or loaded so the editor and engine can trust the shape. */
export function normalizeGraph(raw: unknown): FlowGraph {
  const g = (raw ?? {}) as Partial<FlowGraph>;
  const nodes = (Array.isArray(g.nodes) ? g.nodes : []).filter((n) => n && typeof n.id === "string" && (n.type === "start" || n.type in BLOCKS))
    .map((n) => ({ id: n.id, type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, data: { ...(n.data ?? {}) } }) as FlowNode);
  if (!nodes.some((n) => n.type === "start")) nodes.unshift({ id: "start", type: "start", x: 80, y: 160, data: {} });
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges = (Array.isArray(g.edges) ? g.edges : []).filter((e) => {
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) return false;
    const k = `${e.from}:${e.port}`;
    if (seen.has(k)) return false; // one wire per output port
    seen.add(k);
    return true;
  }).map((e) => ({ id: e.id || rid("e"), from: e.from, port: String(e.port ?? "next"), to: e.to }));
  return { nodes, edges, settings: { ...DEFAULT_SETTINGS, ...(g.settings ?? {}) } };
}

export type Issue = { node?: string; level: "error" | "warn"; text: string };

/** Meta limits + wiring checks. Errors block activating the flow; warnings do not. */
export function validateGraph(g: FlowGraph): Issue[] {
  const out: Issue[] = [];
  const start = g.nodes.find((n) => n.type === "start");
  const next = (id: string, port: string) => g.edges.find((e) => e.from === id && e.port === port)?.to;
  if (!start || !next(start.id, "next")) out.push({ node: start?.id, level: "error", text: "Start is not connected to any block." });
  const reach = new Set<string>();
  const walk = (id?: string) => { if (!id || reach.has(id)) return; reach.add(id); g.edges.filter((e) => e.from === id).forEach((e) => walk(e.to)); };
  walk(start?.id);
  for (const n of g.nodes) {
    if (n.type === "start") continue;
    const d = n.data, name = BLOCKS[n.type].label;
    const err = (text: string) => out.push({ node: n.id, level: "error", text: `${name}: ${text}` });
    const warn = (text: string) => out.push({ node: n.id, level: "warn", text: `${name}: ${text}` });
    if (!reach.has(n.id)) warn("not reachable from Start.");
    if (["message", "buttons", "list", "question"].includes(n.type) && !d.text?.trim()) err("text is empty.");
    if ((d.text?.length ?? 0) > (n.type === "message" ? 4096 : 1024)) err("text is too long.");
    if (n.type === "media" && !/^https:\/\//.test(d.url ?? "")) err("add a public https:// link to the file.");
    if (n.type === "template" && !d.template_name) err("choose a template.");
    if (n.type === "location" && (isNaN(parseFloat(d.latitude ?? "")) || isNaN(parseFloat(d.longitude ?? "")))) err("latitude and longitude are required.");
    if (n.type === "contact" && (!d.contact_name?.trim() || !d.contact_phone?.trim())) err("name and phone are required.");
    if (n.type === "product" && (!d.catalog_id?.trim() || !d.product_ids?.trim())) err("catalog id and product id are required.");
    if (n.type === "buttons") {
      const c = d.choices ?? [];
      if (!c.length || c.length > 3) err("needs 1 to 3 buttons.");
      c.forEach((x) => { if (!x.title.trim() || x.title.length > 20) err(`button “${x.title || "…"}” must be 1–20 characters.`); });
    }
    if (n.type === "list") {
      const c = d.choices ?? [];
      if (!c.length || c.length > 10) err("needs 1 to 10 rows.");
      if (!d.button?.trim() || (d.button?.length ?? 0) > 20) err("menu button text must be 1–20 characters.");
      c.forEach((x) => { if (!x.title.trim() || x.title.length > 24) err(`row “${x.title || "…"}” must be 1–24 characters.`); });
    }
    if (n.type === "question" && !/^[a-z_][a-z0-9_]{0,30}$/.test(d.variable ?? "")) err("save the answer to a variable like city or budget.");
    if (n.type === "tag" && !d.tag?.trim()) err("choose a tag.");
    if (n.type === "webhook" && !/^https:\/\//.test(d.webhook_url ?? "")) err("webhook URL must start with https://.");
    if (n.type === "condition" && d.op !== "has_tag" && !d.variable) err("choose a variable.");
    for (const p of portsOf(n)) if (p.id !== "other" && !next(n.id, p.id) && n.type !== "end") {
      if (isAsk(n.type) || n.type === "condition") warn(`${p.label ? `“${p.label}”` : "output"} is not connected (flow ends there).`);
    }
  }
  return out;
}

/** Arrange nodes left-to-right by depth from Start. */
export function tidy(g: FlowGraph): FlowGraph {
  const start = g.nodes.find((n) => n.type === "start");
  const depth = new Map<string, number>();
  const q: string[] = start ? [start.id] : [];
  if (start) depth.set(start.id, 0);
  while (q.length) {
    const id = q.shift()!;
    for (const e of g.edges.filter((x) => x.from === id)) if (!depth.has(e.to)) { depth.set(e.to, depth.get(id)! + 1); q.push(e.to); }
  }
  let max = Math.max(0, ...depth.values());
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, ++max);
  const cols = new Map<number, FlowNode[]>();
  for (const n of g.nodes) { const d = depth.get(n.id)!; cols.set(d, [...(cols.get(d) ?? []), n]); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, list] of cols) {
    let y = 80;
    for (const n of list) { pos.set(n.id, { x: 80 + d * 320, y }); y += nodeHeight(n) + 40; }
  }
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) };
}

export const NODE_W = 260;
const HEAD = 36, BODY = 46, ROW = 28;
/** Multi-output blocks list their ports under the body; single-output blocks wire from the header. */
const rowPorts = (n: FlowNode) => n.type === "buttons" || n.type === "list" || n.type === "condition";
export function nodeHeight(n: FlowNode) {
  if (n.type === "start") return 44;
  return HEAD + BODY + (rowPorts(n) ? portsOf(n).length * ROW + 6 : 0);
}
export function portY(n: FlowNode, port: string) {
  if (n.type === "start") return 22;
  if (!rowPorts(n)) return HEAD / 2;
  const i = Math.max(0, portsOf(n).findIndex((p) => p.id === port));
  return HEAD + BODY + i * ROW + ROW / 2;
}
export const inY = (n: FlowNode) => (n.type === "start" ? 22 : HEAD / 2);
export const LAYOUT = { HEAD, BODY, ROW };

// ------------------------------------------------------------------ engine

export type Ctx = { vars: Record<string, string>; tags: string[] };
export type Effect =
  | { kind: "send"; node: string; type: "text"; body: string }
  | { kind: "send"; node: string; type: "image" | "video" | "audio" | "document" | "sticker" | "interactive" | "location" | "contacts"; body: string; payload: Record<string, unknown> }
  | { kind: "send"; node: string; type: "template"; body: string; template_name: string; template_language: string; params: string[] }
  | { kind: "tag"; node: string; tag: string; op: "add" | "remove" }
  | { kind: "field"; node: string; field: "name" | "email" | "location"; value: string }
  | { kind: "assign"; node: string; user_id: string | null; note?: string }
  | { kind: "webhook"; node: string; url: string; vars: Record<string, string> };
export type Step = { effects: Effect[]; node: string | null; vars: Record<string, string>; retries: number; status: "waiting" | "done"; path: string[]; invalid?: boolean };
export type Input = { text: string; replyId?: string | null };

export const fill = (s: string | undefined, vars: Record<string, string>) => (s ?? "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => vars[k.toLowerCase()] ?? "");

/** Reply ids carry the node so a tap on an old menu never routes through a different block. */
export const choiceReplyId = (nodeId: string, choiceId: string) => `${nodeId}:${choiceId}`;

function sendOf(n: FlowNode, v: Record<string, string>): Effect | null {
  const d = n.data, t = (s?: string) => fill(s, v).trim();
  switch (n.type) {
    case "message": return { kind: "send", node: n.id, type: "text", body: t(d.text) };
    case "media": {
      const mt = d.media_type ?? "image";
      const media: Record<string, string> = { link: d.url ?? "" };
      if (t(d.text) && mt !== "audio" && mt !== "sticker") media.caption = t(d.text);
      if (mt === "document" && d.filename) media.filename = d.filename;
      return { kind: "send", node: n.id, type: mt, body: t(d.text) || `[${mt}]`, payload: media };
    }
    case "template": return { kind: "send", node: n.id, type: "template", body: `Template: ${d.template_name}`, template_name: d.template_name ?? "", template_language: d.template_language || "en", params: (d.params ?? []).map((p) => t(p)) };
    case "location": return { kind: "send", node: n.id, type: "location", body: `📍 ${[d.name, d.address].filter(Boolean).join(", ") || `${d.latitude}, ${d.longitude}`}`,
      payload: { latitude: parseFloat(d.latitude ?? "0"), longitude: parseFloat(d.longitude ?? "0"), ...(d.name ? { name: d.name } : {}), ...(d.address ? { address: d.address } : {}) } };
    case "contact": return { kind: "send", node: n.id, type: "contacts", body: `Contact: ${d.contact_name} ${d.contact_phone}`,
      payload: { contacts: [{ name: { formatted_name: d.contact_name, first_name: d.contact_name }, phones: [{ phone: d.contact_phone, type: "WORK" }],
        ...(d.contact_email ? { emails: [{ email: d.contact_email, type: "WORK" }] } : {}), ...(d.contact_org ? { org: { company: d.contact_org } } : {}) }] } };
    case "product": {
      const ids = (d.product_ids ?? "").split(/[,\s]+/).filter(Boolean).slice(0, 30);
      const payload = ids.length === 1
        ? { type: "product", ...(t(d.text) ? { body: { text: t(d.text) } } : {}), action: { catalog_id: d.catalog_id, product_retailer_id: ids[0] } }
        : { type: "product_list", header: { type: "text", text: (t(d.header) || "Our products").slice(0, 60) }, body: { text: t(d.text) || "Have a look 👇" },
            action: { catalog_id: d.catalog_id, sections: [{ title: "Products", product_items: ids.map((product_retailer_id) => ({ product_retailer_id })) }] } };
      return { kind: "send", node: n.id, type: "interactive", body: t(d.text) || "Products", payload };
    }
    case "buttons": return { kind: "send", node: n.id, type: "interactive", body: `${t(d.text)}\n${(d.choices ?? []).map((c) => `[${c.title}]`).join(" ")}`,
      payload: { type: "button", body: { text: t(d.text) }, ...(d.footer ? { footer: { text: d.footer.slice(0, 60) } } : {}),
        action: { buttons: (d.choices ?? []).slice(0, 3).map((c) => ({ type: "reply", reply: { id: choiceReplyId(n.id, c.id), title: c.title.slice(0, 20) } })) } } };
    case "list": return { kind: "send", node: n.id, type: "interactive", body: `${t(d.text)}\n${(d.choices ?? []).map((c) => `• ${c.title}`).join("\n")}`,
      payload: { type: "list", body: { text: t(d.text) }, ...(d.header ? { header: { type: "text", text: d.header.slice(0, 60) } } : {}), ...(d.footer ? { footer: { text: d.footer.slice(0, 60) } } : {}),
        action: { button: (d.button || "Options").slice(0, 20), sections: [{ title: (d.header || "Options").slice(0, 24),
          rows: (d.choices ?? []).slice(0, 10).map((c) => ({ id: choiceReplyId(n.id, c.id), title: c.title.slice(0, 24), ...(c.description ? { description: c.description.slice(0, 72) } : {}) })) }] } } };
    case "question": return { kind: "send", node: n.id, type: "text", body: t(d.text) };
    default: return null;
  }
}

function check(d: NodeData, ctx: Ctx, vars: Record<string, string>) {
  if (d.op === "has_tag") return ctx.tags.map((x) => x.toLowerCase()).includes((d.value ?? "").toLowerCase());
  const a = (vars[d.variable ?? ""] ?? "").trim(), b = fill(d.value, vars).trim();
  switch (d.op) {
    case "equals": return a.toLowerCase() === b.toLowerCase();
    case "not_empty": return a !== "";
    case "gt": return parseFloat(a) > parseFloat(b);
    case "lt": return parseFloat(a) < parseFloat(b);
    default: return b.split(",").map((x) => x.trim()).filter(Boolean).some((k) => botMatches({ keywords: [k], match_type: "contains" }, a) !== null);
  }
}

function validAnswer(kind: NodeData["validate"], s: string) {
  if (kind === "number") return /^-?\d+(?:[.,]\d+)?$/.test(s.replace(/[\s,₹]/g, ""));
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  if (kind === "phone") return s.replace(/\D/g, "").length >= 8;
  return s.trim().length > 0;
}

/**
 * Advance a session. Without input: run from `from` (a fresh start). With input: the session is
 * waiting at `from` (an Ask block) and the customer just replied.
 */
export function advance(g: FlowGraph, from: string, ctx: Ctx, input?: Input, retries = 0): Step {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const next = (id: string, port: string) => g.edges.find((e) => e.from === id && e.port === port)?.to ?? null;
  const vars = { ...ctx.vars };
  const effects: Effect[] = [];
  const path: string[] = [];
  let cur: string | null = from;

  if (input) {
    const n = byId.get(from);
    if (!n || !isAsk(n.type)) return { effects, node: null, vars, retries: 0, status: "done", path };
    vars.last_reply = input.text;
    if (n.type === "question") {
      if (!validAnswer(n.data.validate, input.text)) {
        if (retries >= g.settings.max_retries) return { effects, node: null, vars, retries, status: "done", path, invalid: true };
        effects.push({ kind: "send", node: n.id, type: "text", body: fill(n.data.error_text, vars) || "Sorry, that doesn't look right. Please try again." });
        return { effects, node: n.id, vars, retries: retries + 1, status: "waiting", path, invalid: true };
      }
      vars[n.data.variable || "answer"] = input.text.trim();
      cur = next(n.id, "next");
    } else {
      const norm = (s: string) => s.trim().toLowerCase();
      const hit = (n.data.choices ?? []).find((c, i) => input.replyId === choiceReplyId(n.id, c.id) || norm(c.title) === norm(input.text) || norm(input.text) === String(i + 1));
      if (hit) {
        vars[n.data.variable || "choice"] = hit.title;
        cur = next(n.id, hit.id);
      } else if (next(n.id, "other")) {
        cur = next(n.id, "other");
      } else {
        if (retries >= g.settings.max_retries) return { effects, node: null, vars, retries, status: "done", path, invalid: true };
        effects.push({ kind: "send", node: n.id, type: "text", body: fill(g.settings.invalid_text, vars) });
        const again = sendOf(n, vars);
        if (again) effects.push(again);
        return { effects, node: n.id, vars, retries: retries + 1, status: "waiting", path, invalid: true };
      }
    }
  } else {
    const s = byId.get(from);
    if (s?.type === "start") cur = next(s.id, "next");
  }

  for (let guard = 0; cur && guard < 40; guard++) {
    const n = byId.get(cur);
    if (!n) break;
    path.push(n.id);
    const d = n.data;
    if (n.type === "end") return { effects, node: null, vars, retries: 0, status: "done", path };
    if (n.type === "assign") {
      if (d.text?.trim()) effects.push({ kind: "send", node: n.id, type: "text", body: fill(d.text, vars) });
      effects.push({ kind: "assign", node: n.id, user_id: d.user_id || null, note: d.note });
      return { effects, node: null, vars, retries: 0, status: "done", path };
    }
    if (n.type === "condition") { cur = next(n.id, check(d, ctx, vars) ? "yes" : "no"); continue; }
    if (n.type === "tag") { if (d.tag) effects.push({ kind: "tag", node: n.id, tag: d.tag, op: d.tag_op ?? "add" }); cur = next(n.id, "next"); continue; }
    if (n.type === "field") { const v = vars[d.variable ?? ""]; if (v && d.field) effects.push({ kind: "field", node: n.id, field: d.field, value: v }); cur = next(n.id, "next"); continue; }
    if (n.type === "webhook") { if (d.webhook_url) effects.push({ kind: "webhook", node: n.id, url: d.webhook_url, vars: { ...vars } }); cur = next(n.id, "next"); continue; }
    const send = sendOf(n, vars);
    if (send) effects.push(send);
    if (isAsk(n.type)) return { effects, node: n.id, vars, retries: 0, status: "waiting", path };
    cur = next(n.id, "next");
  }
  return { effects, node: null, vars, retries: 0, status: "done", path };
}

export type FlowTrigger = { trigger_type: "keywords" | "any" | "new_contact" | "manual"; keywords: string[]; match_type: "exact" | "contains" | "starts"; number_id: string | null; tag_names: string[] };

/** Does this inbound message start the flow? */
export function triggerHit(f: FlowTrigger, text: string, opts: { numberId: string | null; tags: string[]; firstMessage: boolean }) {
  if (f.number_id && opts.numberId && f.number_id !== opts.numberId) return false;
  if (f.tag_names.length && !f.tag_names.some((t) => opts.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()))) return false;
  if (f.trigger_type === "any") return true;
  if (f.trigger_type === "new_contact") return opts.firstMessage;
  if (f.trigger_type === "keywords") return botMatches({ keywords: f.keywords, match_type: f.match_type }, text) !== null;
  return false;
}

/** Ready-made flows for the Library button. */
export function libraryFlows(): { name: string; description: string; keywords: string; build: () => FlowGraph }[] {
  const mk = (spec: [NodeType, NodeData][], wires: [number, string | number, number][]): FlowGraph => {
    const nodes: FlowNode[] = [{ id: "start", type: "start", x: 0, y: 0, data: {} }, ...spec.map(([type, data]) => ({ id: rid(), type, x: 0, y: 0, data }))];
    const portId = (i: number, p: string | number) => (typeof p === "number" ? nodes[i].data.choices![p].id : p);
    const edges = wires.map(([a, p, b]) => ({ id: rid("e"), from: nodes[a].id, port: portId(a, p), to: nodes[b].id }));
    return tidy({ nodes, edges, settings: { ...DEFAULT_SETTINGS } });
  };
  const ch = (...t: string[]) => t.map((title) => ({ id: rid("c"), title }));
  return [
    { name: "Welcome menu", description: "Greets the customer and routes Sales, Support or an agent.", keywords: "hi, hello, hey, menu, namaste",
      build: () => mk([
        ["buttons", { text: "Hi {{name}} 👋 Welcome! What would you like to do?", choices: ch("Sales", "Support", "Talk to agent") }],
        ["message", { text: "Great! Here is our latest price list: <add link>" }],
        ["question", { text: "Please describe your issue in one message.", variable: "issue", validate: "text" }],
        ["assign", { text: "Connecting you to our team 🙏" }],
        ["tag", { tag: "support", tag_op: "add" }],
        ["message", { text: "Thanks! Our support team will reply here shortly." }],
      ], [[0, "next", 1], [1, 0, 2], [1, 1, 3], [1, 2, 4], [3, "next", 5], [5, "next", 6]]) },
    { name: "Lead capture", description: "Asks name, city and budget, saves them and tags the chat as a hot lead.", keywords: "price, quote, interested, details",
      build: () => mk([
        ["question", { text: "Sure! May I know your name?", variable: "name", validate: "text" }],
        ["field", { field: "name", variable: "name" }],
        ["question", { text: "Thanks {{name}}. Which city are you in?", variable: "city", validate: "text" }],
        ["list", { text: "What is your budget?", button: "Choose budget", variable: "budget", choices: ch("Under ₹10 lakh", "₹10–25 lakh", "₹25–50 lakh", "Above ₹50 lakh") }],
        ["tag", { tag: "hot lead", tag_op: "add" }],
        ["assign", { text: "Thank you {{name}}! Our expert will call you shortly 📞" }],
      ], [[0, "next", 1], [1, "next", 2], [2, "next", 3], [3, "next", 4], [4, 0, 5], [4, 1, 5], [4, 2, 5], [4, 3, 5], [5, "next", 6]]) },
    { name: "Site visit booking", description: "Offers visit slots and shares the location pin.", keywords: "visit, site visit, appointment, book",
      build: () => mk([
        ["buttons", { text: "When would you like to visit?", choices: ch("Today", "Tomorrow", "This weekend"), variable: "visit_day" }],
        ["location", { latitude: "28.6139", longitude: "77.2090", name: "Our office", address: "<add address>" }],
        ["message", { text: "Booked for {{visit_day}} ✅ See you soon!" }],
        ["tag", { tag: "site visit", tag_op: "add" }],
      ], [[0, "next", 1], [1, 0, 2], [1, 1, 2], [1, 2, 2], [2, "next", 3], [3, "next", 4]]) },
  ];
}

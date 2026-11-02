import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "@/lib/actions/auth";
import { decryptSecret } from "@/lib/util";
import {
  companyCountry, connectorByToken, ingest, parseGeneric, parseGoogle, parseIndiamart, parseJustdial,
  type ConnectorKind, type InLead,
} from "@/lib/lead-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS: ConnectorKind[] = ["google", "indiamart", "justdial", "widget", "webhook"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (body: unknown, status = 200, cors = false) => NextResponse.json(body, { status, headers: cors ? CORS : undefined });
const same = (a: string, b: string) => a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Body as a flat object: JSON, form-encoded or multipart; plus query string values. */
async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const q = Object.fromEntries(req.nextUrl.searchParams);
  if (req.method === "GET") return q;
  const ct = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (raw.length > 200_000) throw new Error("Body too large");
  if (ct.includes("application/x-www-form-urlencoded")) return { ...q, ...Object.fromEntries(new URLSearchParams(raw)) };
  if (ct.includes("multipart/form-data")) {
    const fd = await new Request("http://x", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
    return { ...q, ...Object.fromEntries([...fd].filter(([, v]) => typeof v === "string")) };
  }
  if (!raw.trim()) return q;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? { ...q, ...(Array.isArray(parsed) ? { items: parsed } : parsed) } : q;
  } catch {
    return { ...q, ...Object.fromEntries(new URLSearchParams(raw)) };
  }
}

async function handle(req: NextRequest, { params }: { params: Promise<{ kind: string; token: string }> }) {
  const { kind, token } = await params;
  const cors = kind === "widget";
  if (!KINDS.includes(kind as ConnectorKind)) return json({ error: "Not found" }, 404, cors);
  const c = await connectorByToken(kind as ConnectorKind, token);
  if (!c) return json({ error: "Not found" }, 404, cors);
  // Simple health check for "test URL" buttons in the source's own panel.
  if (req.method === "GET" && kind !== "justdial" && req.nextUrl.searchParams.size === 0) return json({ ok: true, connector: c.name, active: c.is_active }, 200, cors);
  if (!c.is_active) return json({ error: "This connection is paused" }, 409, cors);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`hook:${c.id}`, 600, 3600)) || (cors && !(await rateLimit(`hookip:${c.id}:${ip}`, 10, 600)))) {
    return json({ error: "Too many requests" }, 429, cors);
  }

  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch { return json({ error: "Bad request" }, 400, cors); }
  const country = await companyCountry(c.company_id);
  const leads: InLead[] = [];

  if (kind === "google") {
    let key = "";
    try { key = c.secret_enc ? decryptSecret(c.secret_enc) : ""; } catch { /* unreadable */ }
    if (!same(String(body.google_key ?? ""), key)) return json({ error: "Invalid google_key" }, 401);
    leads.push(parseGoogle(body));
  } else if (kind === "indiamart") {
    // Push API: { CODE, STATUS, RESPONSE: {...} }; also accept a bare lead or a list.
    const r = (body.RESPONSE ?? body.items ?? body) as Record<string, unknown> | Record<string, unknown>[];
    for (const x of Array.isArray(r) ? r : [r]) leads.push(parseIndiamart(x));
  } else if (kind === "justdial") {
    leads.push(parseJustdial(body));
  } else if (kind === "widget") {
    if (String(body.website ?? "")) return json({ ok: true }, 200, true); // honeypot
    const l = parseGeneric(body);
    const page = String(body.page ?? "").slice(0, 300);
    leads.push({ ...l, ext_id: undefined, notes: [l.notes, page && `Page: ${page}`].filter(Boolean).join("\n"), fields: { page, message: body.message } });
  } else {
    const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [body];
    for (const x of items.slice(0, 100)) leads.push(parseGeneric(x));
  }

  const results = [];
  for (const l of leads.slice(0, 100)) results.push(await ingest(c, l, country));
  const bad = results.filter((r) => r.status === "invalid");
  // JustDial expects the plain word RECEIVED on success.
  if (kind === "justdial") return new NextResponse(bad.length ? "FAILED" : "RECEIVED", { status: bad.length ? 400 : 200, headers: { "Content-Type": "text/plain" } });
  if (results.length === 1) {
    const r = results[0];
    return json(r.status === "invalid" ? { ok: false, error: r.error } : { ok: true, status: r.status, lead_no: r.lead_no ? `LB-${r.lead_no}` : undefined }, r.status === "invalid" ? 422 : 200, cors);
  }
  return json({ ok: bad.length === 0, results: results.map((r) => ({ status: r.status, error: r.error })) }, 200, cors);
}

export const GET = handle;
export const POST = handle;
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

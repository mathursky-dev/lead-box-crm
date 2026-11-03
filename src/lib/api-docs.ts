// Public API reference: one source for the /developers page and /api/v1/openapi.json.

export type Param = { name: string; in: "query" | "path"; type: string; desc: string; required?: boolean };
export type Field = { name: string; type: string; desc: string; required?: boolean };
export type Endpoint = {
  id: string; method: "GET" | "POST" | "PATCH"; path: string; title: string; scope: string | null; desc: string;
  params?: Param[]; body?: Field[]; example?: Record<string, unknown>; response: Record<string, unknown>; errors?: [number, string][];
};

export const SAMPLE_LEAD = {
  id: "5b1c0c0e-6f1a-4a39-9c55-2f0a3f0f7a11", lead_no: "LB-1234", name: "Rahul Sharma", phone: "+919876543210", email: "rahul@example.com",
  location: "Jaipur", source: "Website", product: "Modular kitchen", status: "Interested", status_category: "interested",
  owner: "Amit Verma", owner_email: "amit@yourcompany.com", priority: "normal", expected_value: 150000, notes: "Wants a demo",
  custom: { budget: "1-2 lakh" }, created_at: "2026-11-02T10:15:00Z", updated_at: "2026-11-02T12:40:00Z",
};

export const SCOPE_INFO: [string, string][] = [
  ["leads.write", "Create leads (POST /leads)"],
  ["leads.read", "Read leads and names (GET /leads, /leads/{id}, /meta)"],
  ["leads.update", "Change a lead: status, owner, priority, value, notes, follow-ups (PATCH /leads/{id})"],
];

export const ENDPOINTS: Endpoint[] = [
  {
    id: "me", method: "GET", path: "/me", title: "Check a key", scope: null,
    desc: "Tells you which company the key belongs to and what it may do. Good first call to test your setup.",
    response: { ok: true, company: "Your Company", key: "Website", scopes: ["leads.write", "leads.read"] },
  },
  {
    id: "create-lead", method: "POST", path: "/leads", title: "Create a lead", scope: "leads.write",
    desc: "Adds a lead and runs your normal lead rules (auto-assign, WhatsApp welcome, journeys). If the same number already has an open lead, no new lead is made: the details are logged on that lead and status is \"duplicate\".",
    body: [
      { name: "phone", type: "string", desc: "Mobile number. Indian numbers may skip +91.", required: true },
      { name: "name", type: "string", desc: "Customer name" },
      { name: "email", type: "string", desc: "Email" },
      { name: "city", type: "string", desc: "City or location (same as location)" },
      { name: "notes", type: "string", desc: "Any note, up to 5000 characters" },
      { name: "source", type: "string", desc: "Source name. Made if new. Default \"API\"." },
      { name: "product", type: "string", desc: "Product name, matched to your product list" },
      { name: "tags", type: "string[]", desc: "Tag names, matched to your tags" },
      { name: "custom", type: "object", desc: "Your custom fields by key (see GET /meta)" },
    ],
    example: { name: "Rahul Sharma", phone: "9876543210", email: "rahul@example.com", city: "Jaipur", source: "Website", product: "Modular kitchen", tags: ["Hot"], notes: "Wants a demo" },
    response: { ok: true, status: "created", lead_id: SAMPLE_LEAD.id, lead_no: "LB-1234" },
    errors: [[422, "A field is missing or wrong, e.g. \"phone: not a valid mobile number\""]],
  },
  {
    id: "list-leads", method: "GET", path: "/leads", title: "List leads", scope: "leads.read",
    desc: "Newest first. Use since to pull only leads changed after your last sync.",
    params: [
      { name: "since", in: "query", type: "ISO time", desc: "Only leads updated after this time, e.g. 2026-11-01T00:00:00Z" },
      { name: "phone", in: "query", type: "string", desc: "Leads of one mobile number" },
      { name: "status", in: "query", type: "string", desc: "Status category: new, assigned, contacted, interested, follow_up, won, lost, invalid…" },
      { name: "limit", in: "query", type: "number", desc: "1 to 200, default 50" },
      { name: "offset", in: "query", type: "number", desc: "Skip this many (for paging)" },
    ],
    response: { total: 1, limit: 50, offset: 0, leads: [SAMPLE_LEAD] },
  },
  {
    id: "get-lead", method: "GET", path: "/leads/{id}", title: "Get one lead", scope: "leads.read",
    desc: "id is the lead UUID or the lead number (LB-1234 or 1234).",
    params: [{ name: "id", in: "path", type: "string", desc: "Lead UUID or lead number", required: true }],
    response: { lead: SAMPLE_LEAD },
    errors: [[404, "Lead not found (or belongs to another company)"]],
  },
  {
    id: "update-lead", method: "PATCH", path: "/leads/{id}", title: "Update a lead", scope: "leads.update",
    desc: "Send only what you want to change. Status, owner and notes show in the lead's timeline as done by the API key. Use this when your ERP / billing software marks a sale, or to hand a lead to a person.",
    params: [{ name: "id", in: "path", type: "string", desc: "Lead UUID or lead number", required: true }],
    body: [
      { name: "status", type: "string", desc: "Status name exactly as in your CRM (see GET /meta)" },
      { name: "reason", type: "string", desc: "Needed when the new status is Lost or Invalid" },
      { name: "won_value", type: "number", desc: "Sale amount when the new status is Won" },
      { name: "owner_email", type: "string | null", desc: "Assign to the user with this login email. null or \"\" = unassign." },
      { name: "priority", type: "string", desc: "low, normal, high or urgent" },
      { name: "expected_value", type: "number | null", desc: "Deal value" },
      { name: "note", type: "string", desc: "Adds a note to the lead" },
      { name: "followup_at", type: "ISO time", desc: "Adds a follow-up for the lead owner at this time, e.g. 2026-11-05T10:30:00+05:30" },
      { name: "followup_note", type: "string", desc: "What the follow-up is about" },
    ],
    example: { status: "Converted/Won", won_value: 145000, note: "Invoice INV-0091 paid", owner_email: "amit@yourcompany.com" },
    response: { ok: true, lead: { ...SAMPLE_LEAD, status: "Converted/Won", status_category: "won" } },
    errors: [[404, "Lead not found"], [422, "e.g. \"status: unknown status name\", \"A reason is required for Lost/Invalid\""]],
  },
  {
    id: "meta", method: "GET", path: "/meta", title: "Names and lists", scope: "leads.read",
    desc: "Your statuses, sources, products, tags, users and custom fields, so your software uses the same names.",
    response: {
      statuses: [{ name: "New", category: "new" }, { name: "Interested", category: "interested" }, { name: "Converted/Won", category: "won" }],
      sources: ["Facebook Ads", "Website"], products: ["Modular kitchen"], tags: ["Hot"],
      users: [{ name: "Amit Verma", email: "amit@yourcompany.com", role: "agent" }],
      custom_fields: [{ key: "budget", label: "Budget", field_type: "text", options: null, is_required: false }],
    },
  },
];

export const WEBHOOK_EVENTS_DOC: [string, string][] = [
  ["lead.created", "A new lead is added (any source: WhatsApp, Facebook, form, API…)"],
  ["lead.status_changed", "A lead's status changes"],
  ["lead.assigned", "A lead gets a new owner"],
];

export const ERRORS_DOC: [number, string][] = [
  [400, "Body is not JSON, or another bad request"],
  [401, "Missing, wrong, revoked or expired API key"],
  [402, "Your company plan is not active"],
  [403, "The key does not have the permission this call needs"],
  [404, "Not found"],
  [422, "A field is missing or not valid (the message says which)"],
  [429, "More than 120 requests in a minute with one key"],
];

/** OpenAPI 3.1 document for Postman / Swagger / code generators. */
export function openApi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const p = e.path;
    const props = Object.fromEntries((e.body ?? []).map((f) => [f.name, { description: f.desc, ...(f.type.endsWith("[]") ? { type: "array", items: { type: "string" } } : f.type === "object" ? { type: "object" } : { type: f.type.startsWith("number") ? "number" : "string" }) }]));
    (paths[p] ??= {})[e.method.toLowerCase()] = {
      operationId: e.id, summary: e.title, description: `${e.desc}${e.scope ? `\n\nPermission: ${e.scope}` : ""}`,
      parameters: (e.params ?? []).map((x) => ({ name: x.name, in: x.in, required: !!x.required || x.in === "path", description: x.desc, schema: { type: x.type === "number" ? "integer" : "string" } })),
      ...(e.body ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: props, required: e.body.filter((f) => f.required).map((f) => f.name) }, example: e.example } } } } : {}),
      responses: {
        [e.method === "POST" ? "201" : "200"]: { description: "OK", content: { "application/json": { example: e.response } } },
        ...Object.fromEntries([...(e.errors ?? []), [401, "Invalid key"], [429, "Rate limit"]].map(([c, d]) => [String(c), { description: d }])),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Lead Box CRM API", version: "1.0", description: "Create, read and update leads. Each company creates its own API keys in Settings → API & webhooks." },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key, starts with lbk_" } } },
    paths,
  };
}

import { headers } from "next/headers";
import { getHostBrand } from "@/lib/brand";
import { ENDPOINTS, ERRORS_DOC, SAMPLE_LEAD, SCOPE_INFO, WEBHOOK_EVENTS_DOC, type Endpoint } from "@/lib/api-docs";
import { CopyCode } from "./copy";

export const metadata = { title: "API docs", description: "REST API and webhooks for developers and partners." };

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-sky-100 text-sky-800", POST: "bg-emerald-100 text-emerald-800", PATCH: "bg-amber-100 text-amber-800",
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

function curl(origin: string, e: Endpoint) {
  const path = e.path.replace("{id}", "LB-1234");
  const qs = e.method === "GET" && e.params?.some((p) => p.in === "query") ? "?since=2026-11-01T00:00:00Z&limit=50" : "";
  const url = `${origin}/api/v1${path}${qs}`;
  const lines = [`curl ${e.method === "GET" ? "" : `-X ${e.method} `}"${url}"`, `  -H "Authorization: Bearer lbk_YOUR_KEY"`];
  if (e.example) lines.push(`  -H "Content-Type: application/json"`, `  -d '${JSON.stringify(e.example)}'`);
  return lines.join(" \\\n");
}

function node(origin: string, e: Endpoint) {
  const path = e.path.replace("{id}", "LB-1234");
  return `const res = await fetch("${origin}/api/v1${path}", {
  method: "${e.method}",
  headers: { Authorization: "Bearer " + process.env.LEADBOX_KEY${e.example ? `, "Content-Type": "application/json"` : ""} },${e.example ? `\n  body: JSON.stringify(${JSON.stringify(e.example)}),` : ""}
});
const data = await res.json();`;
}

const Code = ({ code, label }: { code: string; label?: string }) => (
  <div className="min-w-0">
    <div className="flex items-center justify-between rounded-t-lg bg-[#0d2240] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
      <span>{label}</span><CopyCode text={code} />
    </div>
    <pre className="overflow-x-auto rounded-b-lg bg-[#0b1f3a] p-3 text-xs leading-relaxed text-slate-100"><code>{code}</code></pre>
  </div>
);

const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2 id={id} className="scroll-mt-20 text-xl font-bold text-[#0b1f3a]">{children}</h2>
);

export default async function DevelopersPage() {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "wacrm.leadboxs.in"}`;
  const brand = (await getHostBrand())?.name ?? "Lead Box";
  const nav: [string, string][] = [["start", "Getting started"], ["auth", "Keys & permissions"], ...ENDPOINTS.map((e) => [e.id, e.title] as [string, string]), ["webhooks", "Webhooks"], ["errors", "Errors & limits"]];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b1f3a] text-xs font-bold text-white">API</span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-[#0b1f3a]">{brand} API</div>
            <div className="text-xs text-slate-500">REST · JSON · v1</div>
          </div>
          <a href="/api/v1/openapi.json" className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">OpenAPI JSON</a>
          <a href="/admin/api" className="hidden rounded-lg bg-[#0b1f3a] px-3 py-1.5 text-xs font-medium text-white sm:inline-block">Get an API key</a>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {nav.map(([id, label]) => <li key={id}><a href={`#${id}`} className="block rounded px-2 py-1 text-slate-600 hover:bg-white hover:text-[#0b1f3a]">{label}</a></li>)}
          </ul>
        </nav>

        <main className="min-w-0 space-y-10">
          <section className="space-y-3">
            <H2 id="start">Getting started</H2>
            <p>Connect your website, app, ERP, billing software or Zapier / Pabbly to {brand}. Send leads in, read them out, update them when a sale happens, and get a webhook call when something changes.</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>An admin of your company opens <b>Settings → API &amp; webhooks</b> and clicks <b>New API key</b>. Pick the permissions and (optional) an expiry date. The key is shown once: copy it.</li>
              <li>Send it on every call as <code className="rounded bg-slate-200 px-1">Authorization: Bearer lbk_…</code> (or the header <code className="rounded bg-slate-200 px-1">X-Api-Key</code>).</li>
              <li>Test with <code className="rounded bg-slate-200 px-1">GET /me</code>. Every key works only on its own company&apos;s data.</li>
            </ol>
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div><span className="text-slate-500">Base URL</span> <code className="ml-1 break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono">{origin}/api/v1</code></div>
              <div className="mt-1 text-slate-500">JSON in and out · times in ISO 8601 (UTC unless you add an offset) · phone numbers come back in +91… format</div>
            </div>
          </section>

          <section className="space-y-3">
            <H2 id="auth">Keys &amp; permissions</H2>
            <p className="text-sm">Give each app its own key with only the permissions it needs. A key can be revoked any time, and can be set to expire after 30 days to 1 year.</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Permission</th><th className="px-3 py-2">Allows</th></tr></thead>
                <tbody className="divide-y">{SCOPE_INFO.map(([s, d]) => <tr key={s}><td className="px-3 py-2 font-mono text-xs">{s}</td><td className="px-3 py-2">{d}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          {ENDPOINTS.map((e) => (
            <section key={e.id} className="space-y-3">
              <H2 id={e.id}>{e.title}</H2>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${METHOD_STYLE[e.method]}`}>{e.method}</span>
                <code className="break-all font-mono text-sm">/api/v1{e.path}</code>
                {e.scope && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700">needs {e.scope}</span>}
              </div>
              <p className="text-sm">{e.desc}</p>
              {(e.params?.length || e.body?.length) ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">{e.body ? "Field" : "Parameter"}</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Description</th></tr></thead>
                    <tbody className="divide-y">
                      {[...(e.params ?? []).map((p) => ({ ...p, where: p.in })), ...(e.body ?? []).map((f) => ({ ...f, where: "body" }))].map((f) => (
                        <tr key={`${f.where}:${f.name}`}>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.name}{f.required && <span className="ml-1 text-red-600">*</span>}{f.where !== "body" && <span className="ml-1 text-[10px] text-slate-400">{f.where}</span>}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{f.type}</td>
                          <td className="px-3 py-2">{f.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="grid gap-3 xl:grid-cols-2">
                <Code label="curl" code={curl(origin, e)} />
                <Code label="Node.js" code={node(origin, e)} />
              </div>
              <Code label="Response" code={json(e.response)} />
              {e.errors?.length ? <p className="text-xs text-slate-500">Errors: {e.errors.map(([c, d]) => `${c} ${d}`).join(" · ")}</p> : null}
            </section>
          ))}

          <section className="space-y-3">
            <H2 id="webhooks">Webhooks</H2>
            <p className="text-sm">Add your URL in <b>Settings → API &amp; webhooks → Add webhook</b> and pick the events. We send a POST with JSON to your URL (https only).</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Event</th><th className="px-3 py-2">When</th></tr></thead>
                <tbody className="divide-y">{WEBHOOK_EVENTS_DOC.map(([ev, d]) => <tr key={ev}><td className="px-3 py-2 font-mono text-xs">{ev}</td><td className="px-3 py-2">{d}</td></tr>)}</tbody>
              </table>
            </div>
            <Code label="What we send" code={`POST https://your-server.com/leadbox-hook
Content-Type: application/json
X-LeadBox-Event: lead.created
X-LeadBox-Timestamp: 1767225600
X-LeadBox-Signature: sha256=…

${json({ event: "lead.created", sent_at: "2026-11-02T10:15:02Z", lead: { ...SAMPLE_LEAD, lead_no: 1234 } })}`} />
            <p className="text-sm">Reply with any 2xx within 10 seconds. If your server fails we try again 5 more times (after 1, 5, 15, 60 and 180 minutes).</p>
            <p className="text-sm">Check the signature with the webhook&apos;s signing secret (shown in Settings) so you know the call came from us:</p>
            <Code label="Node.js (Express)" code={`import crypto from "node:crypto";

app.post("/leadbox-hook", express.raw({ type: "application/json" }), (req, res) => {
  const ts = req.headers["x-leadbox-timestamp"];
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.LEADBOX_WEBHOOK_SECRET)
    .update(ts + "." + req.body).digest("hex");
  if (expected !== req.headers["x-leadbox-signature"]) return res.status(401).end();
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(401).end(); // too old
  const { event, lead } = JSON.parse(req.body);
  // … save the lead
  res.sendStatus(200);
});`} />
            <Code label="PHP" code={`$raw = file_get_contents("php://input");
$ts  = $_SERVER["HTTP_X_LEADBOX_TIMESTAMP"];
$sig = "sha256=" . hash_hmac("sha256", $ts . "." . $raw, getenv("LEADBOX_WEBHOOK_SECRET"));
if (!hash_equals($sig, $_SERVER["HTTP_X_LEADBOX_SIGNATURE"])) { http_response_code(401); exit; }
$data = json_decode($raw, true);`} />
          </section>

          <section className="space-y-3">
            <H2 id="errors">Errors &amp; limits</H2>
            <p className="text-sm">Errors come back as <code className="rounded bg-slate-200 px-1">{`{"error": "message"}`}</code> with one of these codes. Limit: <b>120 requests per minute per key</b>.</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <tbody className="divide-y">{ERRORS_DOC.map(([c, d]) => <tr key={c}><td className="w-16 px-3 py-2 font-mono text-xs font-bold">{c}</td><td className="px-3 py-2">{d}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500">Import <a className="text-sky-700 underline" href="/api/v1/openapi.json">openapi.json</a> into Postman, Insomnia or Swagger to try every call.</p>
          </section>
        </main>
      </div>
    </div>
  );
}

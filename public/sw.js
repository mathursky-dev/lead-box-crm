// Lead Box service worker: shows push notifications (follow-up alerts, tasks, assignments)
// and opens the right page when one is tapped. It also keeps the Field app (/field) and its
// scripts on the phone, so field staff can check in, log visits, expenses, leads and notes
// without network (entries wait in IndexedDB and sync later, see src/lib/offline/queue.ts).
// Only /field and the hashed /_next/static files are cached; no other page or API reply is.
const PAGES = "lb-pages-v1";
const STATIC = "lb-static-v1";
const FIELD = "/field";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("lb-") && k !== PAGES && k !== STATIC) await caches.delete(k);
  await self.clients.claim();
})()));

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Lead Box</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f294e;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.c{max-width:340px}a{display:inline-block;margin-top:16px;background:#14a3ad;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
<body><div class="c"><h2>You are offline</h2><p>This page needs internet. Open the Field app once while online so it works offline next time.</p><a href="/field">Try again</a></div></body></html>`;

async function trimStatic() {
  const c = await caches.open(STATIC);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 400; i++) await c.delete(keys[i]);
}

/** Save the Field app page and every script/style it loads, so it opens without network. */
async function warmField() {
  const res = await fetch(FIELD, { credentials: "include", cache: "no-store" });
  if (!res.ok || res.redirected || new URL(res.url).pathname !== FIELD) return; // signed out: keep nothing
  const html = await res.clone().text();
  await (await caches.open(PAGES)).put(FIELD, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
  const st = await caches.open(STATIC);
  for (const a of assets) {
    if (await st.match(a)) continue;
    try { const r = await fetch(a); if (r.ok) await st.put(a, r); } catch { /* next time */ }
  }
  await trimStatic();
}

self.addEventListener("message", (event) => {
  const t = event.data && event.data.type;
  if (t === "warm") event.waitUntil(warmField().catch(() => {}));
  if (t === "clear") event.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith("lb-")) await caches.delete(k); })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const hit = await caches.match(req, { cacheName: STATIC });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(STATIC); c.put(req, res.clone()).catch(() => {}); }
      return res;
    })());
    return;
  }

  if (req.mode !== "navigate") return; // API calls, RSC requests, images: straight to the network.

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (url.pathname === FIELD && res.ok && !res.redirected) {
        const c = await caches.open(PAGES);
        c.put(FIELD, res.clone()).catch(() => {});
      }
      return res;
    } catch {
      const field = await caches.match(FIELD, { cacheName: PAGES });
      if (field) return url.pathname === FIELD ? field : Response.redirect("/field?offline=1", 302);
      return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  })());
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "Lead Box", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "Lead Box", {
    body: d.body || "",
    tag: d.tag,
    icon: "/leadbox-logo-mark.png",
    badge: "/leadbox-logo-mark.png",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        await c.focus();
        if ("navigate" in c) await c.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

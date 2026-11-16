// LivoraRent agent training video: mobile (Pixel 7), Hinglish captions burned into the page.
// Logs in as the training user (password from the LIVORA_VIDEO_PW secret) and records the walk-through.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const crypto = require("crypto");
const BASE = "https://wacrm.leadboxs.in";
const USER = "livora-user4";
const LEAD = "de000000-0000-4000-8000-00000000d002", CONV = "de000000-0000-4000-8000-00000000d003";
const log = (...a) => { console.log(...a); fs.appendFileSync("out/log.txt", a.join(" ") + "\n"); };
const phone = { ...devices["Pixel 7"], locale: "en-IN", timezoneId: "Asia/Kolkata" };

const CAPTION_JS = () => {
  const mk = () => {
    if (document.getElementById("__cap")) return;
    const s = document.createElement("style");
    s.textContent = `#__cap{position:fixed;left:8px;right:8px;bottom:18px;z-index:2147483647;pointer-events:none;
      background:rgba(0,0,0,.82);color:#fff;font:600 17px/1.35 system-ui,sans-serif;padding:10px 12px;border-radius:12px;text-align:center;white-space:pre-line}
      #__cap b{color:#ffd54a}#__cap:empty{display:none}
      #__step{position:fixed;left:8px;top:8px;z-index:2147483647;pointer-events:none;background:#25d366;color:#06321b;font:700 13px system-ui;padding:4px 10px;border-radius:999px}
      #__step:empty{display:none}
      .__tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,213,74,.55);border:3px solid #ffb300;pointer-events:none;animation:__t .7s ease-out forwards}
      @keyframes __t{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`;
    document.documentElement.appendChild(s);
    const c = document.createElement("div"); c.id = "__cap"; c.innerHTML = sessionStorage.getItem("__cap") || "";
    const t = document.createElement("div"); t.id = "__step"; t.textContent = sessionStorage.getItem("__step") || "";
    document.documentElement.appendChild(c); document.documentElement.appendChild(t);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mk); else mk();
  window.__setCap = (html, step) => {
    mk(); sessionStorage.setItem("__cap", html); document.getElementById("__cap").innerHTML = html;
    if (step !== undefined) { sessionStorage.setItem("__step", step); document.getElementById("__step").textContent = step; }
  };
  window.__tap = (x, y) => { const d = document.createElement("div"); d.className = "__tap"; d.style.left = x + "px"; d.style.top = y + "px"; document.documentElement.appendChild(d); setTimeout(() => d.remove(), 800); };
};

(async () => {
  fs.mkdirSync("out/shots", { recursive: true });
  const b = await chromium.launch();

  const pass = (process.env.LB_PW || "").trim(); if (!pass) { log("NO SECRET LIVORA_VIDEO_PW"); process.exit(1); }
  // Record the walk-through.
  const ctx = await b.newContext({ ...phone, recordVideo: { dir: "out/raw", size: { width: 720, height: 1600 } } });
  await ctx.addInitScript(CAPTION_JS);
  const p = await ctx.newPage();
  let n = 0;
  const cap = async (html, step, ms = 4500) => { await p.evaluate(([h, s]) => window.__setCap && window.__setCap(h, s), [html, step]).catch(() => {}); await p.waitForTimeout(ms); };
  const shot = async (name) => { n++; await p.screenshot({ path: `out/shots/${String(n).padStart(2, "0")}-${name}.png` }).catch(() => {}); };
  const tap = async (loc, label) => {
    try {
      await loc.waitFor({ state: "visible", timeout: 8000 }); await loc.scrollIntoViewIfNeeded();
      const bx = await loc.boundingBox();
      if (bx) await p.evaluate(([x, y]) => window.__tap && window.__tap(x, y), [bx.x + bx.width / 2, bx.y + bx.height / 2]);
      await p.waitForTimeout(600); await loc.click(); log("tap ok", label); return true;
    } catch (e) { log("tap FAIL", label, String(e).slice(0, 120)); return false; }
  };
  const go = async (path) => { await p.goto(BASE + path).catch(() => {}); await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800); };
  const closeBrief = async () => { const c = p.locator('[aria-label="Close"]').first(); if (await c.isVisible().catch(() => false)) await tap(c, "close brief"); };
  const slowScroll = async (px, steps = 6) => { for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, px / steps); await p.waitForTimeout(350); } };

  await go("/login");
  await cap("<b>Step 1: Login</b>\nMobile ke Chrome me <b>wacrm.leadboxs.in</b> kholiye", "1 / 9 · Login", 5000);
  await shot("login");
  await cap("<b>Email or User ID</b> me apni User ID likhiye\n(jaise <b>livora-user1</b>)", undefined, 1500);
  await tap(p.locator('input[name="email"]'), "email");
  await p.locator('input[name="email"]').pressSequentially(USER, { delay: 110 });
  await cap("Phir apna <b>Password</b> likhiye", undefined, 1200);
  await tap(p.locator('input[name="password"]'), "password");
  await p.locator('input[name="password"]').pressSequentially(pass, { delay: 70 });
  await cap("Ab <b>Sign in</b> dabaiye", undefined, 1500);
  await tap(p.locator('button:has-text("Sign in")'), "sign in");
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  log("after login", p.url());
  await p.waitForTimeout(2500);
  await cap("<b>Step 2: Aaj ka kaam</b>\nLogin hote hi ye box aata hai: aaj ke naye leads, follow-ups aur unread chats", "2 / 9 · Dashboard", 6000);
  await shot("brief");
  await cap("Padh liya? <b>✕</b> se band kariye", undefined, 1500);
  await closeBrief();
  await p.waitForTimeout(1500);
  const later = p.getByRole("button", { name: "Later" }).first();
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {});
  await cap("Ye aapka <b>Dashboard</b> hai. Yahan aapke leads aur kaam ka hisaab dikhta hai", undefined, 5000);
  await shot("dashboard");
  await slowScroll(900); await p.waitForTimeout(1200); await slowScroll(-900);

  // Bell
  await cap("<b>Step 3: Naya lead kab aata hai?</b>\nClient WhatsApp pe <b>form bharta hai</b>, to uske zone ke agent ko lead <b>apne aap assign</b> ho jaata hai", "3 / 9 · Notification", 7000);
  await cap("Upar <b>🔔 Bell</b> pe dabaiye: <b>\"Lead assigned to you\"</b> dikhega", undefined, 2000);
  await tap(p.locator('button[aria-label^="Notifications"]').first(), "bell");
  await p.waitForTimeout(1500);
  await cap("Notification pe dabate hi wo lead khul jaata hai", undefined, 4500);
  await shot("bell");
  await p.keyboard.press("Escape").catch(() => {});
  await p.locator('button[aria-label^="Notifications"]').first().click().catch(() => {});
  await p.waitForTimeout(800);

  // Menu
  await cap("<b>Step 4: Menu</b>\nUpar left me <b>☰</b> dabaiye: Leads, Inbox, Follow-ups sab yahin hain", "4 / 9 · Menu", 2500);
  await tap(p.locator('button[aria-label="Toggle menu"]').first(), "menu");
  await p.waitForTimeout(1500);
  await cap("<b>Sales</b> pe dabaiye, phir <b>Leads</b>", undefined, 3000);
  await shot("menu");
  await tap(p.locator('nav[aria-label="Main"]').getByText("Sales", { exact: true }).first(), "menu sales");
  await p.waitForTimeout(1200);
  const leadsLink = p.locator('nav[aria-label="Main"] a[href="/leads"]').first();
  if (!(await tap(leadsLink, "menu leads"))) await go("/leads");
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // Leads list
  await cap("<b>Step 5: Leads</b>\nYahan aapko mile <b>saare clients</b> ki list hai. Sabse naya upar", "5 / 9 · Leads", 6000);
  await shot("leads");
  await cap("Upar status ke hisaab se ginti hai. Neeche list me <b>client ka naam</b> hai", undefined, 1500);
  await slowScroll(1200, 8);
  await p.waitForTimeout(1500);
  await shot("leads-list");
  await cap("Client ke naam pe dabaiye", undefined, 2000);
  if (!(await tap(p.getByText("Test Client (Demo)").first(), "lead row"))) await go(`/leads/${LEAD}`);
  await p.waitForURL((u) => u.pathname.includes("/leads/"), { timeout: 15000 }).catch(() => go(`/leads/${LEAD}`));
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // Lead detail
  await cap("<b>Step 6: Lead ki details</b>\nClient ka naam, number, <b>Call</b> button aur lead kab assign hua", "6 / 9 · Lead details", 6000);
  await shot("lead-top");
  await slowScroll(350);
  await cap("<b>Sales status</b>: client se baat ke baad <b>Status</b> badliye (jaise Details Shared, Site Visit) aur <b>Next action</b> lagaiye", undefined, 7000);
  await shot("lead-mid");
  await slowScroll(800);
  await cap("<b>Log activity</b> me likhiye kya baat hui. <b>History</b> me sab record rehta hai", undefined, 6000);
  await shot("lead-low");
  await slowScroll(-1500, 5);

  // Chat
  await cap("<b>Step 7: Client se WhatsApp chat</b>\nMenu me <b>Inbox</b> kholiye", "7 / 9 · Chat", 3000);
  await go("/inbox");
  await p.waitForTimeout(1500);
  await cap("Inbox me aapke clients ki <b>WhatsApp chats</b> hain. Client pe dabaiye", undefined, 4500);
  await shot("inbox");
  if (!(await tap(p.getByText("Test Client", { exact: false }).first(), "inbox row"))) await go(`/inbox?c=${CONV}`);
  await p.waitForTimeout(2500);
  await cap("Bot ne client se jo baat ki (form, ₹200 fee) <b>sab yahan dikhta hai</b>", undefined, 4500);
  await p.mouse.move(200, 500);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -250); await p.waitForTimeout(350); }
  await cap("<b>Peela box</b> = client ka bhara hua <b>Requirement Form</b> aur Zone. Ye sirf team ko dikhta hai", undefined, 6000);
  await shot("chat-form");
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(250); }
  await shot("chat");
  await cap("Neeche <b>message box</b> me reply likhiye...", undefined, 1500);
  const box = p.locator("textarea").first();
  if (await tap(box, "textarea")) await box.pressSequentially("Namaste ji, main LivoraRent se. Aapke liye Bodakdev me 2BHK options bhej raha hoon 🙏", { delay: 45 });
  await cap("...aur <b>Send ➤</b> dabaiye. Message client ke WhatsApp pe chala jaata hai", undefined, 6000);
  await shot("chat-typed");
  await box.fill("").catch(() => {});

  // Follow-ups
  await cap("<b>Step 8: Follow-ups</b>\nMenu me <b>Follow-ups</b>: kis client ko kab call karna hai", "8 / 9 · Follow-ups", 3000);
  await go("/followups");
  await p.waitForTimeout(1500);
  await tap(p.getByText("Upcoming", { exact: true }).first(), "upcoming");
  await p.waitForTimeout(1500);
  await cap("<b>Upcoming</b> me aage ke follow-ups. Yahan kal 11 baje client ko call karna hai", undefined, 5000);
  await cap("Time aane pe reminder aata hai. Kaam hone ke baad usko <b>Done</b> mark kariye", undefined, 6500);
  await shot("followups");

  // App
  await cap("<b>Step 9: Mobile App</b>\nMenu me <b>Download app</b> se CRM ko phone pe app ki tarah install kariye", "9 / 9 · App", 3000);
  await go("/download-app");
  await p.waitForTimeout(1500);
  await slowScroll(500);
  await cap("Android: APK download kariye.  iPhone: Share ➜ <b>Add to Home Screen</b>", undefined, 6500);
  await shot("app");

  await go("/dashboard"); await closeBrief();
  await cap("<b>Yaad rakhiye</b>\n1. 🔔 Naya lead = turant chat kholiye\n2. Client ko jaldi reply/call kariye\n3. Status aur follow-up update kariye\n\nHelp: <b>9558832824</b>", "LivoraRent", 9000);
  await shot("end");

  await ctx.close(); await b.close();
  const vid = fs.readdirSync("out/raw").find((f) => f.endsWith(".webm"));
  fs.renameSync(`out/raw/${vid}`, "out/raw/video.webm");
  log("done");
})().catch((e) => { log("ERROR", String(e)); process.exit(1); });

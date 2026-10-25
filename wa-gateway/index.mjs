// LEAD BOX WhatsApp gateway: links normal WhatsApp numbers by QR scan (WhatsApp Web protocol, Baileys)
// and exposes them to the CRM with the same shapes the Cloud API uses:
//   POST /v1/:session/messages      Cloud API send payload  -> { messages: [{ id }] }
//   GET  /v1/media/:session/:msgId  -> { url, mime_type };  GET .../raw -> bytes
//   POST /v1/sessions {id} | GET /v1/sessions/:id | DELETE /v1/sessions/:id
// Inbound messages and receipts are POSTed to CRM_WEBHOOK_URL in webhook shape, signed like Meta's
// X-Hub-Signature-256 (header x-lb-signature, HMAC-SHA256 with WA_GATEWAY_KEY).
// Unofficial: WhatsApp may ban numbers that are automated. Needs a long-running host with a disk.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as B from "baileys";
import QRCode from "qrcode";
import pino from "pino";

const PORT = Number(process.env.PORT || 8080);
const KEY = process.env.WA_GATEWAY_KEY || "";
const WEBHOOK = process.env.CRM_WEBHOOK_URL || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const DATA = process.env.DATA_DIR || path.resolve("data");
if (KEY.length < 24) { console.error("WA_GATEWAY_KEY must be set (24+ random characters)."); process.exit(1); }
if (!WEBHOOK) console.warn("CRM_WEBHOOK_URL is not set: inbound messages will be dropped.");
fs.mkdirSync(DATA, { recursive: true });

const log = pino({ level: process.env.LOG_LEVEL || "info" });
const quiet = log.child({ module: "baileys" }, { level: "warn" });
const makeWASocket = B.makeWASocket ?? B.default;
const ID = /^qr_[a-f0-9]{8,64}$/;

/** id -> { sock, status, qr, phone, name, lastPoll, stopped } */
const sessions = new Map();
/** Inbound media kept briefly so the CRM can fetch it right after the webhook. */
const media = new Map();
const MEDIA_KEEP = 500;

// ---- CRM webhook -------------------------------------------------------------------------
async function emit(payload) {
  if (!WEBHOOK) return;
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", KEY).update(body, "utf8").digest("hex");
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json", "x-lb-signature": sig }, body, signal: AbortSignal.timeout(15000) });
      if (r.ok) return;
      if (r.status < 500 && r.status !== 429) { log.warn({ status: r.status }, "CRM rejected event"); return; }
    } catch (e) { log.warn({ err: e.message }, "CRM webhook failed"); }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
}

const change = (id, value) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "lb_gateway", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: id }, ...value } }] }],
});
const connection = (id, s) => emit({ object: "lb_gateway", session: id, connection: { status: s.status, phone: s.phone ?? null, name: s.name ?? null } });

// ---- Baileys -> Cloud API message shape ---------------------------------------------------
const digits = (jid) => (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

function toCloud(id, m) {
  const k = m.key;
  const jid = k.remoteJid || "";
  if (k.fromMe || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return null;
  const pn = jid.endsWith("@lid") ? k.senderPn || k.participantPn : jid;
  if (!pn) return null;
  const c = B.normalizeMessageContent(m.message);
  if (!c || c.protocolMessage || c.senderKeyDistributionMessage && Object.keys(c).length === 1) return null;
  const out = { id: k.id, from: digits(pn), timestamp: String(Number(m.messageTimestamp || Date.now() / 1000)), type: "text" };
  const ctx = (c.extendedTextMessage || c.imageMessage || c.videoMessage || c.documentMessage || c.audioMessage)?.contextInfo?.stanzaId;
  if (ctx) out.context = { id: ctx };
  const mediaOf = (type, x, extra = {}) => {
    media.set(k.id, { session: id, msg: m, mime: x.mimetype || "application/octet-stream" });
    if (media.size > MEDIA_KEEP) media.delete(media.keys().next().value);
    out.type = type;
    out[type] = { id: `${PUBLIC_URL}/v1/media/${id}/${encodeURIComponent(k.id)}`, mime_type: x.mimetype, caption: x.caption || undefined, ...extra };
  };
  if (c.conversation || c.extendedTextMessage) out.text = { body: c.conversation || c.extendedTextMessage.text || "" };
  else if (c.imageMessage) mediaOf("image", c.imageMessage);
  else if (c.videoMessage) mediaOf("video", c.videoMessage);
  else if (c.audioMessage) mediaOf("audio", c.audioMessage);
  else if (c.stickerMessage) mediaOf("sticker", c.stickerMessage);
  else if (c.documentMessage) mediaOf("document", c.documentMessage, { filename: c.documentMessage.fileName || undefined });
  else if (c.locationMessage) {
    const l = c.locationMessage;
    out.type = "location";
    out.location = { latitude: l.degreesLatitude, longitude: l.degreesLongitude, name: l.name || undefined, address: l.address || undefined };
  } else if (c.contactMessage || c.contactsArrayMessage) {
    out.type = "contacts";
    const list = c.contactMessage ? [c.contactMessage] : c.contactsArrayMessage.contacts || [];
    out.contacts = list.map((x) => ({ name: { formatted_name: x.displayName } }));
  } else if (c.reactionMessage) {
    out.type = "reaction";
    out.reaction = { message_id: c.reactionMessage.key?.id, emoji: c.reactionMessage.text || "" };
  } else if (c.buttonsResponseMessage || c.listResponseMessage || c.templateButtonReplyMessage) {
    out.text = { body: c.buttonsResponseMessage?.selectedDisplayText || c.listResponseMessage?.title || c.templateButtonReplyMessage?.selectedDisplayText || "" };
  } else out.type = "unsupported";
  return { message: out, contact: { wa_id: out.from, profile: { name: m.pushName || undefined } } };
}

const RECEIPT = { 2: "sent", 3: "delivered", 4: "read", 5: "read" };

// ---- Sessions -----------------------------------------------------------------------------
async function start(id) {
  const prev = sessions.get(id);
  const s = prev ?? { status: "starting", qr: null, phone: null, name: null, lastPoll: Date.now(), stopped: false };
  s.stopped = false;
  sessions.set(id, s);
  const dir = path.join(DATA, id);
  const { state, saveCreds } = await B.useMultiFileAuthState(dir);
  const { version } = await B.fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({
    auth: state, version, logger: quiet, browser: B.Browsers.macOS("Chrome"),
    markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
  });
  s.sock = sock;
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) { s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }); s.status = "qr"; }
    if (u.connection === "open") {
      s.status = "connected"; s.qr = null;
      s.phone = digits(sock.user?.id); s.name = sock.user?.name || sock.user?.verifiedName || null;
      log.info({ id, phone: s.phone }, "connected");
      connection(id, s);
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const paired = Boolean(state.creds.me);
      if (s.stopped) return;
      if (code === B.DisconnectReason.loggedOut || code === B.DisconnectReason.forbidden) {
        s.status = "logged_out"; s.qr = null;
        fs.rmSync(dir, { recursive: true, force: true });
        log.info({ id, code }, "logged out");
        if (paired) connection(id, s);
        return;
      }
      // Keep showing fresh QR codes only while someone has the dialog open.
      if (!paired && Date.now() - s.lastPoll > 60_000) {
        s.status = "expired"; s.qr = null;
        fs.rmSync(dir, { recursive: true, force: true });
        return;
      }
      const wasConnected = s.status === "connected";
      s.status = "connecting";
      if (wasConnected) connection(id, s);
      setTimeout(() => start(id).catch((e) => log.error({ id, err: e.message }, "restart failed")), code === B.DisconnectReason.restartRequired ? 0 : 3000);
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    const items = messages.map((m) => toCloud(id, m)).filter(Boolean);
    if (!items.length) return;
    emit(change(id, { contacts: items.map((x) => x.contact), messages: items.map((x) => x.message) }));
  });

  sock.ev.on("messages.update", (updates) => {
    const statuses = updates
      .filter((u) => u.key.fromMe && RECEIPT[u.update?.status])
      .map((u) => ({ id: u.key.id, status: RECEIPT[u.update.status], timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: digits(u.key.remoteJid) }));
    if (statuses.length) emit(change(id, { statuses }));
  });
  return s;
}

async function stop(id, logout) {
  const s = sessions.get(id);
  if (s) {
    s.stopped = true;
    try { if (logout && s.status === "connected") await s.sock?.logout(); else s.sock?.end(undefined); } catch { /* already closed */ }
    sessions.delete(id);
  }
  fs.rmSync(path.join(DATA, id), { recursive: true, force: true });
}

// ---- Sending ------------------------------------------------------------------------------
const EXT = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain", zip: "application/zip", mp3: "audio/mpeg", ogg: "audio/ogg; codecs=opus", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr" };
const mimeOf = (name, fallback) => EXT[(name || "").split("?")[0].split(".").pop()?.toLowerCase()] || fallback;

function toBaileys(p) {
  switch (p.type) {
    case "text": return { text: p.text?.body || "" };
    case "image": return { image: { url: p.image.link }, caption: p.image.caption };
    case "video": return { video: { url: p.video.link }, caption: p.video.caption };
    case "audio": return { audio: { url: p.audio.link }, mimetype: mimeOf(p.audio.link, "audio/mp4") };
    case "document": return { document: { url: p.document.link }, fileName: p.document.filename || "file", mimetype: mimeOf(p.document.filename || p.document.link, "application/octet-stream"), caption: p.document.caption };
    case "sticker": return { sticker: { url: p.sticker.link } };
    case "reaction": return null; // handled separately (needs the target key)
    default: throw Object.assign(new Error(p.type === "template"
      ? "Templates need the official WhatsApp API. QR-scan numbers can only send normal messages."
      : `Message type "${p.type}" is not supported on QR-scan numbers.`), { code: 100 });
  }
}

async function send(id, p) {
  const s = sessions.get(id);
  if (!s || s.status !== "connected") throw Object.assign(new Error("This WhatsApp number is not connected. Open WhatsApp on the phone, or scan the QR again."), { http: 503, code: 131000 });
  const to = String(p.to || "").replace(/\D/g, "");
  if (!to) throw Object.assign(new Error("Missing recipient"), { code: 100 });
  const jid = `${to}@s.whatsapp.net`;
  if (p.type === "reaction") {
    const r = await s.sock.sendMessage(jid, { react: { text: p.reaction?.emoji || "", key: { remoteJid: jid, id: p.reaction?.message_id, fromMe: false } } });
    return r?.key?.id;
  }
  const r = await s.sock.sendMessage(jid, toBaileys(p));
  return r?.key?.id;
}

// ---- HTTP ---------------------------------------------------------------------------------
const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
const fail = (res, status, message, code) => json(res, status, { error: { message, code } });
function authed(req) {
  const got = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
  const want = Buffer.from(KEY);
  return got.length === want.length && timingSafeEqual(got, want);
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw new Error("Body too large"); }
  return raw ? JSON.parse(raw) : {};
}
const view = (s) => ({ status: s.status, qr: s.qr, phone: s.phone, name: s.name });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/health") return json(res, 200, { ok: true, sessions: sessions.size });
  if (parts[0] !== "v1") return fail(res, 404, "Not found");
  if (!authed(req)) return fail(res, 401, "Unauthorized", 190);
  try {
    // Sessions
    if (parts[1] === "sessions") {
      const id = parts[2];
      if (req.method === "POST" && !id) {
        const { id: nid } = await body(req);
        if (!ID.test(nid || "")) return fail(res, 400, "Invalid session id", 100);
        await stop(nid, false);
        const s = await start(nid);
        return json(res, 200, view(s));
      }
      if (!ID.test(id || "")) return fail(res, 400, "Invalid session id", 100);
      const s = sessions.get(id);
      if (req.method === "GET") {
        if (!s) return fail(res, 404, "Session not found", 100);
        s.lastPoll = Date.now();
        return json(res, 200, view(s));
      }
      if (req.method === "DELETE") { await stop(id, true); return json(res, 200, { ok: true }); }
    }
    // Media
    if (parts[1] === "media" && req.method === "GET") {
      const item = media.get(decodeURIComponent(parts[3] || ""));
      if (!item || item.session !== parts[2]) return fail(res, 404, "Media expired", 100);
      if (parts[4] === "raw") {
        const s = sessions.get(item.session);
        const buf = await B.downloadMediaMessage(item.msg, "buffer", {}, { logger: quiet, reuploadRequest: s?.sock?.updateMediaMessage });
        res.writeHead(200, { "content-type": item.mime, "content-length": buf.length });
        return res.end(buf);
      }
      return json(res, 200, { url: `${PUBLIC_URL}${url.pathname}/raw`, mime_type: item.mime });
    }
    // Send
    if (parts.length === 3 && parts[2] === "messages" && req.method === "POST") {
      if (!ID.test(parts[1])) return fail(res, 400, "Invalid session id", 100);
      const wamid = await send(parts[1], await body(req));
      return json(res, 200, { messaging_product: "whatsapp", messages: [{ id: wamid }] });
    }
    return fail(res, 404, "Not found");
  } catch (e) {
    log.warn({ path: url.pathname, err: e.message }, "request failed");
    return fail(res, e.http || (e.code === 100 ? 400 : 500), e.message, e.code);
  }
});

// Reconnect every paired number after a restart.
for (const id of fs.readdirSync(DATA)) {
  if (ID.test(id) && fs.existsSync(path.join(DATA, id, "creds.json"))) start(id).catch((e) => log.error({ id, err: e.message }, "resume failed"));
}
server.listen(PORT, () => log.info({ port: PORT }, "wa-gateway listening"));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const s of sessions.values()) { s.stopped = true; s.sock?.end(undefined); } process.exit(0); });

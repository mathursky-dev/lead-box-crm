import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

/** Normalize to E.164. Returns null if not a valid number. */
export function normalizePhone(input: string, country: string = "IN"): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.startsWith("00") ? "+" + raw.slice(2) : raw;
  const p = parsePhoneNumberFromString(cleaned, country as CountryCode);
  return p && p.isValid() ? p.number : null;
}

function key() {
  const k = process.env.LB_SECRETS_KEY;
  if (!k) throw new Error("LB_SECRETS_KEY is not configured");
  const buf = Buffer.from(k, "base64");
  if (buf.length < 32) throw new Error("LB_SECRETS_KEY must be at least 32 bytes (base64)");
  return buf.subarray(0, 32);
}

/** AES-256-GCM; output is iv.tag.ciphertext (base64). */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(blob: string) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function verifyMetaSignature(rawBody: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Map Postgres/PostgREST errors to a safe user message. */
export function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Not authorized|42501|permission denied/i.test(m)) return m.replace(/^.*?: /, "") || "Not permitted";
  return m.length > 300 ? m.slice(0, 300) : m;
}

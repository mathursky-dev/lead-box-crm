import "server-only";
import { createAdminClient } from "./supabase/server";
import { companyHasFeature } from "./ai-gate";

/**
 * Voice note → text. Claude does not take audio, so this uses a speech-to-text API:
 *   GROQ_API_KEY   → Groq Whisper large v3 (fast, cheap, good Hindi/English)   [preferred]
 *   OPENAI_API_KEY → OpenAI gpt-4o-mini-transcribe
 * Optional TRANSCRIBE_PROMPT biases spelling (e.g. product names).
 */
type Provider = { name: "groq" | "openai"; url: string; key: string; model: string; verbose: boolean };

function provider(): Provider | null {
  if (process.env.GROQ_API_KEY) return { name: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", key: process.env.GROQ_API_KEY, model: process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3", verbose: true };
  if (process.env.OPENAI_API_KEY) return { name: "openai", url: "https://api.openai.com/v1/audio/transcriptions", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe", verbose: false };
  return null;
}

export const transcribeConfigured = () => provider() !== null;

const MAX_BYTES = 24 * 1024 * 1024;
const LANG: Record<string, string> = { hindi: "hi", english: "en", marathi: "mr", gujarati: "gu", punjabi: "pa", bengali: "bn", tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml", urdu: "ur" };

export async function transcribeAudio(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<{ text: string; lang: string | null }> {
  const p = provider();
  if (!p) throw new Error("Voice to text is not set up on the server (GROQ_API_KEY or OPENAI_API_KEY).");
  const size = bytes.byteLength;
  if (size > MAX_BYTES) throw new Error("Voice note is too long to transcribe (over 24 MB).");
  const type = (mime || "audio/ogg").split(";")[0].trim();
  const ext = type.includes("ogg") || type.includes("opus") ? "ogg" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("amr") ? "amr" : type.includes("wav") ? "wav" : type.includes("webm") ? "webm" : "ogg";
  const fd = new FormData();
  fd.set("file", new Blob([bytes as BlobPart], { type }), `voice.${ext}`);
  fd.set("model", p.model);
  fd.set("response_format", p.verbose ? "verbose_json" : "json");
  fd.set("temperature", "0");
  if (process.env.TRANSCRIBE_PROMPT) fd.set("prompt", process.env.TRANSCRIBE_PROMPT.slice(0, 800));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: fd, signal: ctrl.signal });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("Voice to text key is invalid.");
      if (res.status === 429) throw new Error("Voice to text is busy (rate limited). Try again shortly.");
      if (res.status === 400 && /format|decode|audio/i.test(msg)) throw new Error("This audio format could not be read.");
      throw new Error(`Voice to text failed (${res.status}).`);
    }
    const j = (await res.json()) as { text?: string; language?: string };
    const lang = j.language ? (LANG[j.language.toLowerCase()] ?? j.language.toLowerCase().slice(0, 8)) : /[ऀ-ॿ]/.test(j.text ?? "") ? "hi" : null;
    return { text: (j.text ?? "").trim().slice(0, 8000), lang };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Voice to text timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type Db = ReturnType<typeof createAdminClient>;

/** Company switched voice-to-text on (default on) and its plan includes AI. */
export async function companyTranscribes(db: Db, companyId: string) {
  if (!transcribeConfigured()) return false;
  const { data } = await db.from("lb_companies").select("voice_transcribe").eq("id", companyId).maybeSingle();
  if (!data || data.voice_transcribe === false) return false; // also false while the SQL is not applied (column missing → null data)
  return companyHasFeature(db, companyId, "ai");
}

/** Transcribe one stored message and save the result on it. Returns the text ('' when silent). */
export async function transcribeMessage(db: Db, messageId: string, bytes: ArrayBuffer | Uint8Array, mime: string) {
  try {
    const r = await transcribeAudio(bytes, mime);
    await db.from("lb_messages").update({ transcript: r.text || null, transcript_status: r.text ? "done" : "empty", transcript_lang: r.lang, transcribed_at: new Date().toISOString() }).eq("id", messageId);
    return { text: r.text };
  } catch (e) {
    await db.from("lb_messages").update({ transcript_status: "failed", transcribed_at: new Date().toISOString() }).eq("id", messageId);
    return { error: (e as Error).message };
  }
}

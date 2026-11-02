/** Lead languages used by routing rules. Codes match lb__lang_code() in the database. */
export const LANGUAGES = [
  { code: "hi", name: "Hindi / Hinglish" },
  { code: "en", name: "English" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "pa", name: "Punjabi" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "or", name: "Odia" },
  { code: "ur", name: "Urdu" },
] as const;

export const LANG_CODES: string[] = LANGUAGES.map((l) => l.code);
export const langName = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code)?.name ?? code ?? "";

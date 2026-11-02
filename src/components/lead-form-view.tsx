"use client";
import { onColor } from "@/lib/settings-shared";

/** One rendered field on a public lead form. */
export type ViewField = { key: string; label: string; required: boolean; type: string; options?: string[] };
export type FormLook = { name: string; description: string; bg_color: string; font: string; title_size: number; label_size: number };

const FONT_STACK: Record<string, string> = {
  Nunito: "Nunito, ui-sans-serif, system-ui, sans-serif", Inter: "Inter, ui-sans-serif, system-ui, sans-serif",
  Poppins: "Poppins, ui-sans-serif, system-ui, sans-serif", Roboto: "Roboto, ui-sans-serif, system-ui, sans-serif",
  "Open Sans": "'Open Sans', ui-sans-serif, system-ui, sans-serif", Lato: "Lato, ui-sans-serif, system-ui, sans-serif",
  Montserrat: "Montserrat, ui-sans-serif, system-ui, sans-serif",
};
export const fontHref = (font: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;600;700&display=swap`;

/** Lead capture form layout, used by the live preview and by /f/<code>. */
export function LeadFormView({ look, fields, preview = false, pending = false, error }: {
  look: FormLook; fields: ViewField[]; preview?: boolean; pending?: boolean; error?: string;
}) {
  const fg = onColor(look.bg_color);
  const labelStyle = { fontSize: look.label_size };
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-white shadow-xl" style={{ fontFamily: FONT_STACK[look.font] ?? FONT_STACK.Nunito }}>
      <div className="px-6 py-7 text-center" style={{ background: look.bg_color, color: fg }}>
        <h1 className="font-bold leading-tight break-words" style={{ fontSize: Math.min(look.title_size, preview ? 30 : 72) }}>{look.name || "Form name"}</h1>
        {look.description && <p className="mt-2 whitespace-pre-line text-sm opacity-90">{look.description}</p>}
      </div>
      <div className="space-y-4 px-6 py-6">
        {fields.map((f) => {
          const id = `f_${f.key.replace(/[^a-z0-9_]/gi, "_")}`;
          const common = { id, name: f.key, required: f.required, disabled: preview, className: "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" };
          return (
            <div key={f.key}>
              {f.type !== "checkbox" && <label htmlFor={id} className="mb-1 block font-semibold text-slate-700" style={labelStyle}>{f.label}{f.required && <span className="text-red-500"> *</span>}</label>}
              {f.type === "textarea" ? <textarea rows={3} maxLength={2000} {...common} />
                : f.type === "dropdown" ? <select {...common} defaultValue=""><option value="" disabled={f.required}>Select…</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                : f.type === "checkbox" ? <label className="flex items-center gap-2 font-semibold text-slate-700" style={labelStyle}><input type="checkbox" id={id} name={f.key} disabled={preview} /> {f.label}</label>
                : <input maxLength={300} {...common}
                    type={f.type === "phone" ? "tel" : f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "url" ? "url" : "text"}
                    inputMode={f.type === "phone" ? "tel" : undefined} placeholder={f.type === "phone" ? "+91 98765 43210" : undefined} />}
            </div>
          );
        })}
        {/* honeypot: real people never see or fill this */}
        {!preview && <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />}
        {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button type={preview ? "button" : "submit"} disabled={pending}
          className="w-full rounded-lg px-4 py-2.5 text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-60" style={{ background: look.bg_color, color: fg }}>
          {pending ? "Sending…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

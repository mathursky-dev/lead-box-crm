// Shared (client + server) definitions for the Settings masters.

export const FIELD_TYPES = [
  ["text", "Text"], ["textarea", "Long text"], ["number", "Number"], ["date", "Date"], ["dropdown", "Dropdown"],
  ["checkbox", "Yes / No"], ["email", "Email"], ["phone", "Phone"], ["url", "Link"],
] as const;
export type FieldType = (typeof FIELD_TYPES)[number][0];
export const FIELD_TYPE_LABEL: Record<string, string> = Object.fromEntries(FIELD_TYPES);

export type CustomField = {
  id: string; key: string; label: string; field_type: FieldType; options: string[];
  is_required: boolean; sort_order: number; is_active: boolean;
};

export const FORM_FONTS = ["Nunito", "Inter", "Poppins", "Roboto", "Open Sans", "Lato", "Montserrat"] as const;

/** A field on a lead capture form. key = a standard field or "cf:<custom field key>". */
export type FormFieldDef = { key: string; label: string; required: boolean };

export const STD_FORM_FIELDS: { key: string; label: string; type: string }[] = [
  { key: "name", label: "Full name", type: "text" },
  { key: "phone", label: "Mobile number", type: "phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "location", label: "City / Location", type: "text" },
  { key: "notes", label: "Message", type: "textarea" },
];

export const SWATCHES = ["#E53935", "#8E24AA", "#3949AB", "#1E88E5", "#00ACC1", "#F4511E", "#FDD835", "#43A047", "#546E7A", "#616161",
  "#FFFACD", "#AEC6CF", "#B0E57C", "#CBAACB", "#FFDAB9", "#FFD1DC", "#EEDC82", "#FFB3B3", "#B2FFFF", "#F5FFFA"];

/** Readable text colour on a hex background. */
export function onColor(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#0f172a";
  const n = parseInt(m[1], 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#0f172a" : "#ffffff";
}

/** Field definitions (type + options) for a list of form fields. */
export function viewFields(fields: FormFieldDef[], custom: CustomField[]): { key: string; label: string; required: boolean; type: string; options?: string[] }[] {
  const cf = new Map(custom.map((c) => [`cf:${c.key}`, c]));
  return fields.flatMap((f) => {
    const std = STD_FORM_FIELDS.find((s) => s.key === f.key);
    if (std) return [{ ...f, type: std.type }];
    const c = cf.get(f.key);
    return c ? [{ ...f, type: c.field_type, options: c.options }] : [];
  });
}


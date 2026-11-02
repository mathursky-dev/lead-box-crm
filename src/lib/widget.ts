/** Website chat widget settings (lb_lead_connectors.config for kind = 'widget'); shared by server and admin UI. */
export type WidgetConfig = {
  wa_number: string; title: string; subtitle: string; greeting: string; button_text: string; message: string;
  thank_you: string; color: string; position: "right" | "left"; ask_details: boolean;
};

export const WIDGET_DEFAULTS: WidgetConfig = {
  wa_number: "", title: "Chat with us", subtitle: "We usually reply in a few minutes", greeting: "Hi! 👋 How can we help you?",
  button_text: "Chat with us", message: "Hi, I want to know more.", thank_you: "Thanks! WhatsApp is opening — send us your message there.",
  color: "#25D366", position: "right", ask_details: true,
};

const str = (v: unknown, d: string, max: number) => (typeof v === "string" ? v.slice(0, max) : d);

export function widgetConfig(raw: Record<string, unknown> | null | undefined): WidgetConfig {
  const r = raw ?? {};
  const d = WIDGET_DEFAULTS;
  return {
    wa_number: str(r.wa_number, d.wa_number, 20).replace(/\D/g, ""),
    title: str(r.title, d.title, 60), subtitle: str(r.subtitle, d.subtitle, 100), greeting: str(r.greeting, d.greeting, 300),
    button_text: str(r.button_text, d.button_text, 40), message: str(r.message, d.message, 300), thank_you: str(r.thank_you, d.thank_you, 200),
    color: /^#[0-9a-fA-F]{6}$/.test(String(r.color ?? "")) ? String(r.color) : d.color,
    position: r.position === "left" ? "left" : "right",
    ask_details: r.ask_details === undefined ? d.ask_details : Boolean(r.ask_details),
  };
}

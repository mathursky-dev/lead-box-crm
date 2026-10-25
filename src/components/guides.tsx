import Link from "next/link";

// Single source for the setup/how-to text that pages already show, so the Help & Guides drawer
// reuses it instead of keeping its own copy.

export const WA_API_SETUP = [
  <>In Meta for Developers, create (or open) a <b>Business</b> app and add the <b>WhatsApp</b> product.</>,
  <>Copy the <b>App ID</b> and <b>App Secret</b> (App → Settings → Basic) into “Meta app credentials” above.</>,
  <>In WhatsApp → Configuration, paste the <b>Callback URL</b> and <b>Verify token</b> above, click Verify and save, and subscribe <b>messages</b>.</>,
  <>In Business Settings → System users, create a system user, assign the app and your WhatsApp account, and generate a permanent token with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>.</>,
  <>In <Link className="text-brand-700 hover:underline" href="/admin/numbers">WhatsApp numbers</Link>, add each number (Phone number ID, WABA ID, token), then click <b>Subscribe webhook</b> and <b>Sync templates</b>.</>,
  <>Send a WhatsApp message to the number: it should appear in the Inbox, and “Webhook receiving events” turns green.</>,
];

export const WA_NUMBER_CHECKLIST = [
  <>Create a System User in Business Settings, give it the WhatsApp account, generate a permanent token.</>,
  <>Connect the number here (token is tested live).</>,
  <>Press <b>Subscribe webhook</b> so Meta sends messages to this CRM.</>,
  <>Press <b>Sync templates</b>, then send a test from <Link className="text-brand-700 hover:underline" href="/whatsapp/send">Send</Link>.</>,
];

/** WhatsApp overview "Getting started": title, description, page. */
export const WA_GETTING_STARTED: [string, string, string][] = [
  ["Connect a number", "Phone number ID, WABA ID and a permanent access token.", "/whatsapp/connections"],
  ["Approved template", "Sync from Meta or create one — needed outside the 24-hour window.", "/whatsapp/templates"],
  ["Add contacts", "Single add, CSV import, or let inbound messages create them.", "/whatsapp/contacts"],
  ["Send a message", "Single send first, then campaigns, chatbots and flows.", "/whatsapp/send"],
  ["Turn on a chatbot", "Answer “price”, “hi”, “timing” instantly, 24×7.", "/whatsapp/chatbots"],
];

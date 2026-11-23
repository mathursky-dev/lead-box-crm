// Rental desk: a fixed WhatsApp enquiry flow for rental brokerages (built for LivoraRent Ahmedabad).
// Pure and shared: the webhook runner (lib/rental-desk-server.ts), the admin page and the tests use it.
//
// Flow (cody's blueprint, 2026-11-23): who are you (tenant / landlord / broker / buyer / owner-sell) →
// non-tenants get their details form → thanks + WhatsApp alert to the admin number.
// Tenant: requirement form (missing answers asked again until complete) → brokerage note (+ poster) →
//   budget ≥ ₹25k: lead to the admin + the zone agents → "kitne din me?" timeline
//   single person ₹14k–25k: sharing flat? yes → admin alert → timeline · no → sorry
//   anything else: sorry + Instagram, nothing forwarded
// timeline 7 days → URGENT alert → registration pitch; 15 days / 1 month → "within 5 days?" → pitch
// pitch → QR + terms → payment screenshot → admin alert → an admin confirms on the Rental desk page →
// daily "flat mila?" follow-ups → who gave the flat + final rent + happy? → personal alert.

/** "owner" = an old enquiry (before 2026-11-23 it meant a landlord). "seller" shows as "Owner" (sells a property). */
export type Role = "tenant" | "landlord" | "broker" | "buyer" | "seller" | "owner";
export type Stage =
  | "role" | "form" | "sharing" | "timeline" | "fast_ask" | "pitch" | "declined"
  | "fee_offer" | "awaiting_payment" | "payment_review" | "registered" | "not_registered"
  | "fu_ask" | "fu_broker" | "fu_rent" | "fu_happy" | "details" | "done" | "closed";

/** A zone: its agents are the active users of department_id (user_id = fallback when the department is empty). */
export type Zone = { no: number; name: string; areas: string[]; user_id: string | null; department_id?: string | null };
export type DeskConfig = {
  enabled: boolean; fee: number; upi_id: string; upi_name: string; qr_url: string;
  /** ₹500 urgent plan: flat within 3 days, adjusted in the final brokerage. */
  urgent_fee: number;
  /** A single person below the tenant minimum is offered a sharing flat from this budget (₹14k). */
  single_min_budget: number;
  /** Independent flats: the lead goes to the admin + zone agents from this budget (₹25k). */
  tenant_min_budget: number;
  /** The poster image goes out with the brokerage note when the budget is at least this (₹15k). */
  poster_url: string; poster_min_budget: number;
  /** Admin / support WhatsApp shown to customers ("9558642824 (Ravi Shankar)"). */
  support_phone: string; support_name: string;
  channel_url: string; instagram_url: string;
  /** Call number in the "fill the form first" reply (reel link / screenshot) and the benefits message. */
  help_phone: string;
  min_followup_budget: number; followup_hours: number; max_followups: number; max_followups_unreg: number;
  zones: Zone[];
};

export type Field = { key: string; label: string; ask: string; aliases: string[]; number?: boolean };

/** The RENTAL REQUIREMENT FORM (cody's 11 points of 2026-11-14 + name and contact, 2026-11-23), in the order the customer sees it. */
export const FIELDS: Field[] = [
  { key: "name", label: "Name", ask: "Aapka pura naam?", aliases: ["name", "naam"] },
  { key: "contact", label: "Contact Number", ask: "Aapka contact number?", aliases: ["contact", "mobile", "phone"] },
  { key: "bhk", label: "BHK", ask: "Kitne BHK chahiye? (1 / 2 / 3 BHK)", aliases: ["bhk"] },
  { key: "budget", label: "Monthly Budget (Rent + Maint)", ask: "Monthly budget kitna hai? (Rent + Maintenance, jaise 25000)", aliases: ["budget", "monthly budget", "rent + maint"], number: true },
  { key: "area", label: "Preferred Area / Landmark", ask: "Preferred area / landmark kaunsa hai?", aliases: ["preferred area", "area", "landmark", "location"] },
  { key: "furnishing", label: "Furnishing (Full / Semi / Raw)", ask: "Furnishing kaisi chahiye? (Full / Semi / Raw)", aliases: ["furnishing", "furnished"] },
  { key: "move_in", label: "Move-in Date", ask: "Move-in date kab ki hai?", aliases: ["move-in", "move in", "shifting"] },
  { key: "tenant_type", label: "Tenant Type (Single / Family / Bachelors)", ask: "Kaun rahega? (Single / Family / Bachelors)", aliases: ["tenant type", "tenant"] },
  { key: "occupants", label: "Total Occupants", ask: "Kul kitne log rahenge? (Total occupants)", aliases: ["occupants", "total members", "members"] },
  { key: "profession", label: "Profession & Office Location", ask: "Aapka profession aur office location kya hai?", aliases: ["profession", "office"] },
  { key: "food", label: "Food Preference (Veg / Non-Veg)", ask: "Food preference? (Veg / Non-Veg)", aliases: ["food"] },
  { key: "parking", label: "Parking Needed (Car / 2-Wheeler)", ask: "Parking chahiye? (Car / 2-Wheeler / No)", aliases: ["parking"] },
  { key: "tenure", label: "Kitne Mahine tak Rent par Rahna h", ask: "Kitne mahine tak rent par rehna hai?", aliases: ["kitne mahine", "mahine", "stay duration", "tenure", "duration"] },
];

/** Buyer questions (cody 2026-11-11), grouped like the client's list. */
export const BUYER_FIELDS: Field[] = [
  { key: "b_budget", label: "Total Budget (Registry & tax included?)", ask: "Aapka total budget kitna hai? (Registry aur tax alag se hain ya included?)", aliases: ["total budget", "budget"] },
  { key: "b_payment", label: "Payment (Home loan / Own funds)", ask: "Payment kaise karoge? (Home loan se ya apne funds se?)", aliases: ["payment", "home loan", "funds"] },
  { key: "b_preapproved", label: "Loan Pre-approved (Yes/No)", ask: "Kya loan pehle se pre-approved hai? (Yes / No / Loan nahi chahiye)", aliases: ["pre-approved", "pre approved", "preapproved"] },
  { key: "b_area", label: "Preferred Area / Landmark", ask: "Kis area ya landmark ke aas-paas property chahiye?", aliases: ["preferred area", "area", "landmark", "location"] },
  { key: "b_distance", label: "Office / School / Hospital Distance Priority", ask: "Office, school ya hospital ki distance ko lekar koi priority hai kya?", aliases: ["distance", "school", "hospital"] },
  { key: "b_bhk", label: "BHK (Flat / House)", ask: "Kitne BHK ka flat ya makan chahiye?", aliases: ["bhk"] },
  { key: "b_ready", label: "Ready-to-move / Under-construction", ask: "Ready-to-move chahiye ya under-construction chalega?", aliases: ["ready", "under-construction", "under construction"] },
  { key: "b_floor", label: "Floor / Facing Preference", ask: "Koi specific floor ya facing (jaise east-facing) pasand hai?", aliases: ["facing", "floor"] },
  { key: "b_purpose", label: "Self-use / Investment", ask: "Khud rehne ke liye lena hai ya investment ke liye?", aliases: ["investment", "self", "purpose"] },
  { key: "b_possession", label: "Possession Needed By", ask: "Kab tak possession chahiye?", aliases: ["possession"] },
  { key: "b_amenities", label: "Must-have Amenities (Parking, Lift, Security)", ask: "Kaun-kaun si amenities zaroori hain? (Jaise parking, lift, security)", aliases: ["amenities", "amenity"] },
  { key: "b_members", label: "Total Family Members", ask: "Ghar mein total kitne log rahenge?", aliases: ["members", "kitne log", "family members"] },
  { key: "b_decision", label: "Final Decision Maker", ask: "Family mein final decision lene wala kaun hai?", aliases: ["decision"] },
  { key: "b_contact", label: "Contact Number", ask: "Aapka contact number?", aliases: ["contact", "mobile", "phone"] },
];

/** Old buyer enquiries (before 2026-11-23) still finish their one-by-one form. */
export const fieldsFor = (role: Role | null) => (role === "buyer" ? BUYER_FIELDS : FIELDS);
const formTitle = (role: Role | null) => (role === "buyer" ? "PROPERTY BUYING REQUIREMENT FORM" : "🏡 RENTAL REQUIREMENT FORM");
export const formText = (role: Role | null) => `*${formTitle(role)}*\n${fieldsFor(role).map((f, i) => `${i + 1}. ${f.label}: `).join("\n")}`;
export const FORM_TEXT = formText("tenant");

export type Answers = Record<string, string>;
const TENANT = FIELDS;

const EMPTY_RE = /^[\s\-_.:*?·•]*$/;
const clean = (s: string) => s.replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();

/** Strips the label the customer copied ("Pets (Yes/No): no" → "no"). */
function valueAfterLabel(rest: string, f: Field) {
  const r = clean(rest);
  const colon = r.indexOf(":");
  if (colon >= 0) return r.slice(colon + 1).trim();
  const low = r.toLowerCase();
  for (const lab of [f.label.toLowerCase(), ...f.aliases]) if (low.startsWith(lab)) return r.slice(lab.length).replace(/^[\s\-=–>]+/, "").trim();
  return r;
}

const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Labels of the old 20-point form (a customer may still send an old copy): the field they fill now, or null = dropped. */
const OLD_LABELS = new Map<string, string | null>([
  ["Deposit Capacity", null], ["Pets (Yes/No)", null], ["Max Commute Distance", null], ["Metro / Public Transport Needed", null],
  ["Floor Preference & Lift Needed", null], ["Balcony Compulsory (Yes/No)", null], ["24/7 Water & Power Backup Needed", null],
  ["Planned Stay Duration (Tenure)", "tenure"], ["Tenant Type (Family / Bachelors / Working)", "tenant_type"], ["Comfortable with Society Rules (Yes/No)", null], ["Agree to Lock-in & 1-Month Notice (Yes/No)", null],
].map(([k, v]) => [labelKey(k as string), v]));

/** True when the text looks like the filled form (at least 2 numbered or labelled lines). */
export function looksLikeForm(text: string) {
  const lines = text.split(/\r?\n/);
  const numbered = lines.filter((l) => /^\s*\*?\s*(?:[1-9]|1\d|2\d)\s*[.)\-:]/.test(l)).length;
  return numbered >= 2 || /rental requirement form/i.test(text);
}

/** Reads a filled form: "3. Move-in Date: 1 Dec" by number, or "Deposit: 50k" by label. */
export function parseForm(text: string, FIELDS: Field[] = TENANT): Answers {
  const out: Answers = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;
    const m = line.match(/^(\d{1,2})\s*[.)\-:]\s*(.*)$/);
    let f: Field | undefined, v = "";
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 25) {
      // The label the customer copied wins over the number (an old 20-point copy still reads right).
      const colon = m[2].indexOf(":");
      const lab = colon > 0 ? labelKey(m[2].slice(0, colon)) : "";
      const old = lab ? OLD_LABELS.get(lab) : undefined;
      const byLabel = lab ? FIELDS.find((x) => labelKey(x.label) === lab || (old && x.key === old)) : undefined;
      if (byLabel) { f = byLabel; v = m[2].slice(colon + 1).trim(); }
      else if (old === null) continue; // a point the form no longer has
      else if (Number(m[1]) <= FIELDS.length) { f = FIELDS[Number(m[1]) - 1]; v = valueAfterLabel(m[2], f); }
      else continue;
    } else {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const lab = line.slice(0, colon).toLowerCase();
      f = FIELDS.find((x) => x.label.toLowerCase() === lab) ?? FIELDS.find((x) => x.aliases.some((a) => lab.includes(a)));
      v = line.slice(colon + 1).trim();
    }
    if (!f || EMPTY_RE.test(v)) continue;
    out[f.key] = v.slice(0, 300);
  }
  return out;
}

/** An answer counts only when it says something (and the budget has a number in it). */
export function validAnswer(f: Field, v: string | undefined) {
  if (!v || EMPTY_RE.test(v)) return false;
  if (f.number) return parseBudget(v) !== null;
  return clean(v).length >= 1;
}

export const missingFields = (a: Answers, fields: Field[] = TENANT) => fields.filter((f) => !validAnswer(f, a[f.key]));

/** "25k", "25,000", "₹ 25000", "20-25k", "1.2 lakh", "25" (thousands) → rupees per month; the highest number counts. */
export function parseBudget(s: string): number | null {
  const t = s.toLowerCase().replace(/,/g, "").replace(/₹|rs\.?|inr/g, " ");
  const re = /(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hajar|l|lac|lakh|lakhs)?\b/g;
  let best: number | null = null;
  const nums: { n: number; unit?: string }[] = [];
  for (const m of t.matchAll(re)) nums.push({ n: parseFloat(m[1]), unit: m[2] });
  // "20-25k": the unit of the last number applies to a bare number right before it.
  const lastUnit = nums.findLast((x) => x.unit)?.unit;
  for (const x of nums) {
    const unit = x.unit ?? (nums.length > 1 ? lastUnit : undefined);
    let v = x.n;
    if (unit && /^l/.test(unit)) v *= 100000;
    else if (unit) v *= 1000;
    else if (v < 1000) v *= 1000;
    if (v >= 1000 && v <= 10000000 && (best === null || v > best)) best = Math.round(v);
  }
  return best;
}

// ------------------------------------------------------------------ zones

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Every zone named in the area text, in the order they are written ("Bodakdev ya Gota" → zones 2 and 3).
 * A name inside a longer one does not count on its own ("Thaltej-Sola Road" is zone 3 only, not 2 + 3).
 */
export function zonesFor(area: string, zones: Zone[]): Zone[] {
  if (!area?.trim()) return [];
  const t = norm(area);
  // The text without spaces, with each letter's position in t (for "prahladnagar" vs "Prahlad Nagar").
  let tq = ""; const at: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] !== " ") { tq += t[i]; at.push(i); }
  const hits: { z: Zone; from: number; to: number }[] = [];
  for (const z of zones) {
    for (const a of z.areas) {
      const k = norm(a).trim(), kq = squash(a);
      if (!kq) continue;
      for (let p = t.indexOf(` ${k} `); p >= 0; p = t.indexOf(` ${k} `, p + 1)) hits.push({ z, from: p + 1, to: p + 1 + k.length });
      if (kq.length >= 6) for (let p = tq.indexOf(kq); p >= 0; p = tq.indexOf(kq, p + 1)) hits.push({ z, from: at[p], to: at[p + kq.length - 1] + 1 });
    }
  }
  const inside = (h: (typeof hits)[number]) => hits.some((o) => o !== h && o.to - o.from > h.to - h.from && o.from <= h.from && o.to >= h.to);
  const out: Zone[] = [];
  for (const h of hits.filter((h) => !inside(h)).sort((x, y) => x.from - y.from)) if (!out.includes(h.z)) out.push(h.z);
  return out;
}

/** The first zone named in the area text. */
export const zoneFor = (area: string, zones: Zone[]): Zone | null => zonesFor(area, zones)[0] ?? null;

/** LivoraRent – Ahmedabad West, 5 main broker zones (from their zone poster). Spelling variants included. */
export const LIVORA_ZONES: Omit<Zone, "user_id">[] = [
  { no: 1, name: "Satellite-Prahladnagar Hub", areas: [
    "Satellite", "Jodhpur", "Jodhpur Gam", "Jodhpur Gaam", "Shivranjani", "Anandnagar", "Anand Nagar", "Ramdevnagar", "Ramdev Nagar", "Nehrunagar", "Nehru Nagar",
    "Shyamal", "Prahladnagar", "Prahlad Nagar", "Makarba", "Vejalpur", "Juhapura", "Sarkhej", "Vasna", "Fatehwadi", "Corporate Road",
    "South Satellite", "100 Feet Road", "100 Ft Road", "Shreyas Crossing", "Shreyas"] },
  { no: 2, name: "Bodakdev-Thaltej-Bopal Hub", areas: [
    "Bodakdev", "Thaltej", "Sindhu Bhavan", "Sindhubhavan", "Hebatpur", "Shilaj", "Ambli", "Bopal", "South Bopal", "Shela",
    "Ghuma", "Sanathal", "Godhavi", "Telav", "Science City", "Drive In", "Drive-In Road", "Judges Bungalow", "Palladium",
    "Iscon", "Iscon Ambli Road", "Ambli Road", "SP Ring Road", "S P Ring Road", "Ring Road Bopal", "Vastrapur Lake"] },
  { no: 3, name: "Sola-Gota-Ghatlodia Hub", areas: [
    "Sola", "Gota", "Jagatpur", "Chandlodia", "Chandlodiya", "Ghatlodia", "Ghatlodiya", "Bhadaj", "Tragad", "Ognaj", "Sola Road", "New Sola",
    "Thaltej Sola Road", "Ranna Park", "Akhbarnagar", "Akhbar Nagar", "Nirnaynagar", "Nirnay Nagar", "Chandlodia Railway", "Chandlodia Rly", "Vaishnodevi",
    "Vaishno Devi", "Zundal S", "Bhuyangdev", "Sattadhar", "KK Nagar", "K K Nagar", "RC Technical", "R C Technical"] },
  { no: 4, name: "Chandkheda-Sabarmati Hub", areas: [
    "Chandkheda", "Motera", "Motera Stadium", "Sabarmati", "New CG Road", "Zundal", "Koteshwar", "Tapovan", "Visat", "Ranip", "New Ranip", "ONGC",
    "IOC Road", "Tragad Extension", "Adalaj", "Adalaj Road", "Chandkheda Railway", "Chandkheda Rly", "Sabarmati Railway", "Sabarmati Rly", "Acher", "Ramnagar", "Ram Nagar", "D Cabin",
    "D-Cabin", "Pashravnagar", "Narmada Canal", "Bhat"] },
  { no: 5, name: "Navrangpura-Naranpura Hub", areas: [
    "Navrangpura", "Naranpura", "Vastrapur", "University Area", "Memnagar", "Gurukul", "Vijay Cross", "Vijay Char Rasta", "Stadium",
    "Ambawadi", "Paldi", "Ellisbridge", "Ellis Bridge", "Law Garden", "CG Road", "C G Road", "Mithakhali", "Usmanpura", "Ashram Road",
    "Commerce Six Road", "Commerce 6 Road", "Panjrapole", "IIM Road", "IIM", "HL College", "H L College", "Gujarat University"] },
];

// ------------------------------------------------------------------ messages

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/** "9558642824 (Ravi Shankar)" */
const supportOf = (cfg: Pick<DeskConfig, "support_phone" | "support_name">) =>
  cfg.support_phone ? `${cfg.support_phone}${cfg.support_name ? ` (${cfg.support_name})` : ""}` : "";

/** Forms of the other roles (sent as one message, answered in one reply). */
export const ROLE_FORMS: Record<"landlord" | "broker" | "buyer" | "seller", { title: string; intro: string; points: string[] }> = {
  landlord: {
    title: "RENTAL PROPERTY DETAILS FORM",
    intro: "Namaste! 🙏 Apni property rent par dene ke liye kripya yeh *RENTAL PROPERTY DETAILS FORM* fill karein:",
    points: [
      "Property Type (Flat / Tenement / Villa)?", "BHK & Floor count?", "Main Area & Nearby Landmark?", "Monthly Rent & Maintenance (Included/Extra)?",
      "Last Negotiable Rent?", "Security Deposit amount?", "Lock-in Period (Months)?", "Tenants Preferred (Family / Bachelors / Both)?",
      "Bachelor Rules (Male / Female / Max count)?", "Food Restriction (Veg only / Non-veg allowed)?", "Pets Allowed (Yes / No)?",
      "Furnishing Status (Unfurnished / Semi / Fully)?", "House Items (Bed, Wardrobe, Sofa, etc.)?", "Appliances (AC, Fridge, Washing Machine, TV, Geyser)?",
      "Gas Line Available (Piped / Cylinder)?", "Water Supply (24/7 Boring / Municipal)?", "Building Lift Available (Yes / No)?",
      "Parking Space (2-Wheeler / 4-Wheeler / Covered)?", "Society Amenities (Security, Gym, Pool, etc.)?", "Possession Date & Key Availability?",
    ],
  },
  broker: {
    title: "BROKER DETAILS",
    intro: "Namaste! 🙏 Kripya yeh details share karein:",
    points: ["Aapka Pura Naam:", "Aap mainly kis area mein kaam karte hain?"],
  },
  buyer: {
    title: "PROPERTY BUYING DETAILS",
    intro: "Namaste! 🙏 Sahi property suggest karne ke liye kripya yeh details share karein:",
    points: [
      "Aapka Pura Naam:", "Aapka Contact Number:", "Property Type: (2BHK / 3BHK / Villa / Plot)", "Preferred Area / Landmark:", "Maximum Budget:",
      "Payment Mode: (Self-funded / Home Loan)", "Possession Status: (Ready-to-Move / Under-Construction)", "Purpose: (Khud rehne ke liye / Investment)",
      "Kab tak final karna hai: (Urgent / 1-3 months)", "Koi khas zaroorat: (Parking, Floor preference, Vastu, etc.)",
    ],
  },
  seller: {
    title: "PROPERTY SELLING DETAILS",
    intro: "Namaste! 🙏 Aapki property sell karne ke liye sahi buyers laane ke liye kripya yeh details share karein:",
    points: [
      "Aapka Pura Naam:", "Aapka Contact Number:", "Property Type & Size: (2BHK / 3BHK / Villa / Tenament & Area)", "Location / Landmark:",
      "Expected Price: (Negotiable hai ya nahi?)", "Property Age & Furnishing: (Unfurnished / Semi / Fully)",
      "Ownership & Papers: (Single / Joint & Index-2 clear hai?)", "Active Loan: (Haan / Nahi)", "Abhi kaun reh raha hai: (Owner / Tenant / Khali hai)",
      "Visit Timing & Keys:",
    ],
  },
};
export const roleFormText = (role: keyof typeof ROLE_FORMS) => {
  const f = ROLE_FORMS[role];
  return `${f.intro}\n\n${f.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n_Form copy karke har line bhar kar ek hi message me bhejiye._`;
};
const ROLE_LABEL: Record<Role, string> = { tenant: "Tenant", landlord: "Landlord", broker: "Broker", buyer: "Buyer", seller: "Owner (sell)", owner: "Landlord" };

export const MSG = {
  welcome: (min: number) =>
    "Welcome to *LivoraRent!* 🏠\nGet your rental flat within 7 days.\n\n" +
    `*Note:* We work only for Registered Enquiries & have independent rental properties above ${inr(min)}/- rent.\n\n` +
    "Kripya select karein ki aap kaun hain:\n1️⃣ Tenant (Makaan kiraye par chahiye)\n2️⃣ Landlord (Apna makaan rent par dena hai)\n" +
    "3️⃣ Broker (Property partner/agent)\n4️⃣ Buyer (Makaan kharidna chahte hain)\n5️⃣ Owner (Apna makaan bechna chahte hain)",
  roleRows: [
    { id: "tenant", title: "Tenant", description: "Makaan kiraye par chahiye" },
    { id: "landlord", title: "Landlord", description: "Apna makaan rent par dena hai" },
    { id: "broker", title: "Broker", description: "Property partner / agent" },
    { id: "buyer", title: "Buyer", description: "Makaan kharidna chahte hain" },
    { id: "seller", title: "Owner", description: "Apna makaan bechna chahte hain" },
  ],
  /** First message was a reel link / screenshot / property code. */
  refNote: "Aapne jo property link/screenshot bheja hai, uske alawa bhi hum aapko best options bhejenge. Pehle niche di gayi details complete karein. 🙏",
  tenantIntro: "Hello Sir/Ma'am! 🙏 Please complete your details. Uske baad hi humari team aapki requirement ke hisab se best options bhej payegi.\n\n👇 Neeche wala form *copy karke har line bhar kar* bhejiye.",
  thanks: (role: Role, support: string) => {
    const contact = support ? ` Direct contact ke liye WhatsApp karein: ${support}.` : "";
    if (role === "buyer") return `Dhanyavaad! 🙏 Details milte hi hum aapko best options share karte hain. Humari team jaldi aapse sampark karegi.${contact}`;
    if (role === "seller") return `Dhanyavaad! 🙏 Details milte hi hum aage ka process shuru karte hain. Humari team jaldi aapse sampark karegi.${contact}`;
    if (role === "broker") return `Dhanyavaad! 🙏 Humari team jaldi aapse contact karegi.${contact}`;
    return `Dhanyavaad! 🙏 Humari team jaldi aapse sampark karegi.${contact}`;
  },
  detailsAgain: "🙏 Kripya upar wale form ki details ek message me bhejiye, tabhi humari team aage badh payegi.",
  missing: (miss: Field[], next: Field) =>
    `Kripya apni adhooree details poori karein (Missing: *${miss.map((f) => f.label.replace(/\s*\(.*\)$/, "")).join(", ")}*), tabhi hum aage badh payenge.\n\n👉 ${next.ask}`,
  invalidAnswer: (f: Field) => f.number ? `Kripya budget number me bataiye (jaise 25000) 🙏\n\n👉 ${f.ask}` : `👉 ${f.ask}`,
  // Old buyer enquiries (one-by-one form, before 2026-11-23).
  buyerThanks: "Dhanyavaad 🙏 Aapki poori requirement mil gayi hai. Humari team jaldi aapse contact karegi aur aapke budget aur location ke hisaab se best options share karegi 🏡",
  missingFirst: (n: number, f: Field) => `Dhanyavaad 🙏 Form me *${n} detail${n === 1 ? "" : "s"}* baaki hai. Poori details ke bina enquiry submit nahi hogi.\n\n👉 ${f.ask}`,
  missingNext: (n: number, f: Field) => `👍 Noted. ${n} aur baaki.\n\n👉 ${f.ask}`,
  brokerage: (summary: string) => `✅ Dhanyavaad details share karne ke liye! 🙏\n\n${summary}\n\n📌 *Note:* Hum 1 month rent brokerage charge karte hain.`,
  sharingAsk:
    "Iss budget mein humare paas independent property available nahi hai, lekin *fully furnished sharing flat* options available hain (Male ke liye male ke saath, Female ke liye female ke saath).\n\nKya aap sharing flat ke liye interested hain?",
  sharingNo: "Sorry 🙏 humare paas iss budget mein koi independent property available nahi hai.",
  sharingYes: (phone: string) => `Great! 👍 Sharing flat options ke liye aap directly humare WhatsApp number ${phone} par connect kar sakte hain.`,
  lowBudget: (min: number, insta: string) =>
    `Sorry 🙏 abhi humare paas ${inr(min)} se kam budget ki koi rental property available nahi hai — jo options the woh rent out ho chuke hain.\n\n` +
    "Jaise hi is budget mein koi nayi property aayegi, hum apne Instagram page par update kar denge." +
    (insta ? ` Regular updates ke liye aap humein yahan follow kar sakte hain:\n👉 ${insta}` : ""),
  timelineAsk: "Aapko kitne din mein flat final karna hai? 👇\n1️⃣ Within 7 Days\n2️⃣ Within 15 Days\n3️⃣ Within 1 Month",
  timelineRows: [{ id: "rd:tl_7", title: "Within 7 Days" }, { id: "rd:tl_15", title: "Within 15 Days" }, { id: "rd:tl_30", title: "Within 1 Month" }],
  fastAsk: "Aap chahte hain ki aapko jaldi options mil jayein taaki aapko multiple calls na karne padein aur *within 5 days* aap apni best property select karke final kar sakein?",
  fastNo: (phone: string) => `Koi baat nahi! 🙏 Jab bhi aapko jaldi property chahiye ho aur registration karke process start karna ho, humein message kar dijiyega.${phone ? ` Support: ${phone}` : ""}`,
  pitch: (fee: number, phone: string) =>
    "Hum sirf *registered enquiries* par hi kaam karte hain taaki bina time waste kiye aapko best options bhijwa sakein.\n\n" +
    `👉 *Registration Fee: ${inr(fee)}* (Yeh amount brokerage ke time par adjust ho jata hai)\n` +
    "📌 Registration ke baad hum dedicatedly aapko aapke budget & location ke hisab se fast multiple options bhejenge.\n\n" +
    `*Can I Share QR For Payment?*${phone ? `\n\n📞 Doubts ya Support ke liye: ${phone}` : ""}`,
  pitchNo: (phone: string) => `Koi baat nahi! 🙏 Jab bhi aapko registration karke jaldi property chahiye ho, humein bata dena.${phone ? ` Support: ${phone}` : ""}`,
  payQrCaption: (fee: number, upi: string) => `${inr(fee)} is QR par pay kariye${upi ? `\nUPI ID: ${upi}` : ""}`,
  payTerms: (fee: number, upi: string) =>
    `💳 ${inr(fee)} registration${upi ? `\nUPI ID: *${upi}*` : ""}\n\nKripya payment karke *screenshot yahan share karein* 📸\n\n` +
    "⚠️ *Important Terms:*\n" +
    `• ${inr(fee)} pay karne ke baad aapko sirf visit ke liye options select karne hain.\n` +
    "• Koi bhi visit karne se pehle humse confirm zaroor karein ki executive humari team se hai ya nahi, aur visit se pehle property ki poori detail lein.\n" +
    "• Registration / Token / koi bhi pay kiya hua amount non-refundable hai.\n" +
    "• Jab tak aapko flat nahi mil jata, humari team aapke budget ke according best flat search karti rahegi.",
  faq: (phone: string) =>
    "Humari team aapke budget, BHK aur location ke hisab se hi property options bhejegi (Jaise agar budget ₹25k hai toh ₹30k jaisi property ki expectation poori nahi ho sakti).\n\n" +
    "Agar aap apne budget ke hisab se aane wale options mein se final karna chahte hain toh registration kar sakte hain, team turant options bhejna chalu kar degi.\n\n" +
    `Agar registration ke 24 hours baad bhi best options na aayein, toh directly WhatsApp karein: ${phone || "-"} (Customer Care Support).`,
  yes: "Yes", no: "No",
  sendScreenshot: "Payment ka *screenshot* (photo) yahin bhejiye 📸 Koi sawaal ho to likhiye, team jawab degi.",
  screenshotThanks: "Screenshot mil gaya ✅ Hum payment check karke jaldi confirm karte hain. Confirm hote hi aapki enquiry zone team ko submit ho jayegi.",
  // Old offer (enquiries that got the ₹ offer before 2026-11-23) and the not-registered follow-ups.
  feeNo: "Abhi nahi",
  notNow: "Koi baat nahi 🙏 Jab tak aapko best option nahi milta, humare touch me rahiye. We will help you as soon as possible.\n\nKabhi bhi register karna ho to *REGISTER* likh kar bhejiye.",
  links: (channel: string, insta: string) => [
    channel && `📢 Regular rental property updates aur sharing flat options ke liye humara WhatsApp channel follow kariye:\n${channel}`,
    insta && `📸 Premium rental property updates ke liye Instagram:\n${insta}`,
  ].filter(Boolean).join("\n\n"),
  registered: (zone: string, urgent = false, urgentFee = 500) =>
    `🎉 Payment confirm ho gaya! Aapki enquiry register ho gayi hai.\n\nAapke zone${zone ? ` (${zone})` : ""} ki dedicated team jaldi aapse contact karegi aur ` +
    (urgent ? `*urgent basis par* options bhejegi, taaki *3 din me* flat final ho sake. ${inr(urgentFee)} aapke final brokerage me adjust ho jayega.\n\n` : "*100 ghante ke andar* final options bhejegi.\n\n") +
    "⚠️ *Safety ke liye:* bina 100% surety ke koi bada token amount ya brokerage pay na karein, taaki baad me cancel hone par refund ki problem na ho.\n\nLog humare fast & hassle-free kaam ki wajah se humse judte hain 🙏",
  paymentRejected: (reason: string) => `⚠️ Aapka payment abhi confirm nahi ho paya${reason ? `: ${reason}` : ""}.\n\nKripya sahi payment ka screenshot dobara bhejiye 📸`,
  followup: "Namaste 🙏 LivoraRent se follow-up: kya aapko flat mil gaya?",
  fuYes: "Haan, mil gaya",
  fuNo: "Abhi nahi",
  askBroker: "Bahut badhai ho! 🎉 Aapko flat kisne dilaya? Broker / team member ka naam bataiye.",
  askRent: "Final rent kitna hua? (₹ me)",
  askHappy: "Kya aap humari service se happy hain?",
  happyYes: "Haan 😊",
  happyNo: "Nahi",
  closedThanks: "Thank you 🙏 Aapki details note kar li hain. Naye ghar ki bahut badhai! 🏠\n\n⚠️ Bina 100% surety ke koi bada token amount ya brokerage pay na karein.",
  keepTouch: "Koi baat nahi 🙏 Jab tak aapko best option nahi milta, humare touch me rahiye. Team options bhej rahi hai, we will help you as soon as possible.",
  /** "₹150 kis baat ka?": sent once per enquiry (cody 2026-11-14). */
  benefits: (fee: number, phone: string) =>
    "👋 Hello! Looking for your dream home without the hassle?\n" +
    `Register with Livorarent for just *${inr(fee)}/-* and let us do the hard work for you.\n\n` +
    "✨ *Why register with us?*\n" +
    "• *Save Time:* Get multiple property options within 24–48 hours tailored to your exact budget and location.\n" +
    "• *Extensive Options:* Access multiple verified options both online and offline.\n" +
    "• *Zero Hassle:* No need to search endlessly or call multiple brokers/agents.\n" +
    "• *Quick Closure:* Finalize your flat within 3 to 7 days.\n\n" +
    "📌 *Please Note Before Registering:*\n" +
    "• Please proceed only if your budget, BHK requirement, preferred location, and family members are finalized.\n" +
    "• Once you receive multiple options, choose the best one without confusion.\n" +
    "• We stay with you until you successfully find your ideal home.\n" +
    "• *Special Offer:* Your registration amount is fully adjusted against the brokerage if you finalize a flat through our team member!\n\n" +
    `📍 Livorarent${phone ? `\n📞 ${phone}` : ""}`,
  keepTouchUnreg: (fee: number) => `Hum help kar sakte hain 🙌 Dedicated team se jaldi options ke liye ${inr(fee)} registration kariye: *REGISTER* likh kar bhejiye.`,
};

export function summaryOf(a: Answers) {
  const b = parseBudget(a.budget ?? "");
  return [
    a.bhk && `🏠 ${a.bhk}`, b && `💰 ${inr(b)}/month`, a.area && `📍 ${a.area}`, a.move_in && `📅 Move-in: ${a.move_in}`,
    a.tenant_type && `👥 ${a.tenant_type}${a.occupants ? ` (${a.occupants})` : ""}`, a.furnishing && `🛋️ ${a.furnishing}`,
  ].filter(Boolean).join("\n");
}

/** Full form as a note on the lead / message to the admin and zone agents. */
export const formNote = (a: Answers, role: Role | null = "tenant") => `${formTitle(role)}\n${fieldsFor(role).map((f, i) => `${i + 1}. ${f.label}: ${a[f.key] ?? "-"}`).join("\n")}`;

// ------------------------------------------------------------------ the state machine

export type State = {
  stage: Stage; role: Role | null; answers: Answers; asking: string | null; zone: number | null; budget: number | null;
  base_stage: "registered" | "not_registered" | null; found_broker: string | null; found_rent: string | null; happy: string | null;
  plan: "standard" | "urgent" | null;
  /** Every zone named in the area (the lead goes to the agents of all of them). */
  zones: number[];
  /** The ₹ benefits message went out already (once per enquiry). */
  benefits: boolean;
};

export type Out =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { kind: "list"; body: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: "image"; url: string; caption: string };

export type Act =
  | { kind: "tag"; tag: string }
  | { kind: "status"; status: string }
  | { kind: "note"; body: string }
  | { kind: "notify_admins"; title: string; body: string }
  | { kind: "screenshot" }
  | { kind: "final_alert" }
  /** Give the lead to the agents of the enquiry's zones (form complete). */
  | { kind: "zone_assign"; note: string }
  /** WhatsApp to the admin number (lb_rental_desk.alert_phone) + bell for the admins. */
  | { kind: "wa_admin"; title: string; body: string }
  /** WhatsApp to every agent the enquiry's lead went to (their own mobile number). */
  | { kind: "wa_zone"; title: string; body: string };

export type In = { text: string; replyId?: string | null; media: boolean };
export type Result = { state: State; out: Out[]; acts: Act[]; handled: boolean };

export const freshState = (): State => ({
  stage: "role", role: null, answers: {}, asking: null, zone: null, budget: null, base_stage: null, found_broker: null, found_rent: null, happy: null, plan: null, zones: [], benefits: false,
});

const lc = (s: string) => s.trim().toLowerCase();
const NO_RE = /\b(nahi|nahin|nai|na|no|not|nope|abhi nahi|not yet)\b/;
const YES_RE = /\b(haan|han|ha|haa|yes|yeah|yep|ok|okay|mil gaya|mila|mil gya|done|ho gaya|final)\b/;

/** yes / no / null from a button id or a typed reply (follow-up questions). */
function yesNo(inp: In, yesId: string, noId: string): boolean | null {
  if (inp.replyId?.endsWith(yesId)) return true;
  if (inp.replyId?.endsWith(noId)) return false;
  const t = lc(inp.text);
  if (NO_RE.test(t)) return false;
  if (YES_RE.test(t)) return true;
  return null;
}

/** Yes / No questions of the new flow. A trailing "na" ("bhejo na") is not a no; a clear yes word wins. */
const YES2 = /\b(haan|han|ha|haa|haanji|hanji|ji|yes|yeah|yep|ok|okay|sure|interested|chalega|bhejo|bhej do|send|share|qr|pay|kar do|karo|register)\b/;
const NO2 = /\b(no|nahi|nahin|nhi|nai|not|nope|mat|later|baad me|abhi nahi|not interested)\b/;
function yn2(inp: In, yesId: string, noId: string): boolean | null {
  if (inp.replyId?.endsWith(yesId)) return true;
  if (inp.replyId?.endsWith(noId)) return false;
  const t = lc(inp.text).replace(/[^a-z0-9 ]+/g, " ");
  const y = YES2.test(t), n = NO2.test(t);
  if (n && !(y && /\b(haan|yes|ok|okay|bhejo|send|share)\b/.test(t) && !/\b(no|nahi|nahin|nhi|not interested)\b/.test(t))) return false;
  if (y) return true;
  if (/^(1|y)$/.test(t.trim())) return true;
  if (/^(2|n)$/.test(t.trim())) return false;
  return null;
}

function pickRole(inp: In): Role | null {
  const id = inp.replyId?.split(":").pop();
  if (id && ["tenant", "landlord", "broker", "buyer", "seller"].includes(id)) return id as Role;
  const t = lc(inp.text);
  if (/^1\b|tenant|kiray[ae] (par|pe) chahiye|rent (par|pe) chahiye|on rent|flat chahiye|ghar chahiye|makaan chahiye/.test(t)) return "tenant";
  if (/^2\b|landlord|rent (par|pe) dena|kiray[ae] (par|pe) dena/.test(t)) return "landlord";
  if (/^3\b|broker|agent|dalal|partner/.test(t)) return "broker";
  if (/^4\b|buyer|kharid|purchase|\bbuy\b/.test(t)) return "buyer";
  if (/^5\b|owner|bechna|sell|malik/.test(t)) return "seller";
  if (/chahiye|kiray|\brent\b/.test(t)) return "tenant";
  return null;
}

const roleMenu = (cfg: DeskConfig): Out => ({ kind: "list", body: MSG.welcome(cfg.tenant_min_budget), button: "Select kariye", rows: MSG.roleRows });
const ynButtons = (body: string, key: string): Out => ({ kind: "buttons", body, buttons: [{ id: `rd:${key}_yes`, title: MSG.yes }, { id: `rd:${key}_no`, title: MSG.no }] });
const timelineOut = (): Out => ({ kind: "buttons", body: MSG.timelineAsk, buttons: MSG.timelineRows });
const pitchOut = (cfg: DeskConfig): Out => ynButtons(MSG.pitch(cfg.fee, cfg.support_phone), "qr");
export const planFee = (plan: State["plan"], cfg: Pick<DeskConfig, "fee" | "urgent_fee">) => (plan === "urgent" ? cfg.urgent_fee : cfg.fee);
export const followupOut = (): Out => ({ kind: "buttons", body: MSG.followup, buttons: [{ id: "rd:fu_yes", title: MSG.fuYes }, { id: "rd:fu_no", title: MSG.fuNo }] });

/** "1", "single", "akela", "1 person" → one person living alone. */
export function isSingle(a: Answers) {
  const occ = clean(a.occupants ?? "").toLowerCase();
  return /^(1|one|ek)\b|single|akela|alone|^1\s*(person|member|log|people)/.test(occ) || /\b(single|akela|alone)\b/.test((a.tenant_type ?? "").toLowerCase());
}

function payOut(cfg: DeskConfig, plan: State["plan"]): Out[] {
  const fee = planFee(plan, cfg);
  const out: Out[] = [];
  if (/^https:\/\//.test(cfg.qr_url)) out.push({ kind: "image", url: cfg.qr_url, caption: MSG.payQrCaption(fee, cfg.upi_id) });
  out.push({ kind: "text", body: MSG.payTerms(fee, cfg.upi_id) });
  return out;
}
const withLinks = (body: string, cfg: DeskConfig) => [body, MSG.links(cfg.channel_url, cfg.instagram_url)].filter(Boolean).join("\n\n");

/** Reel / post link, a photo or a property code instead of an answer. */
const LINK_RE = /https?:\/\/|www\.|instagram\.com|instagr\.am|youtu\.?be|fb\.watch/i;
const CODE_RE = /\bproperty\s*(code|id|no)\b|\b(code|ref)\s*[:#-]?\s*[a-z0-9-]{2,}|\b[A-Z]{1,4}-?\d{2,6}\b|#\d{3,}/;
const isRef = (inp: In) => !looksLikeForm(inp.text) && (inp.media || LINK_RE.test(inp.text) || CODE_RE.test(inp.text));

/** "₹150 kis baat ka?", "fee kyu?": a question about the fee. */
const FEE_Q_RE = /(150|200|500|fee|fees|charge|registration|register|paise|paisa|payment)/;
const ASK_RE = /\?|\b(kis|kiss|kyu|kyun|kyon|kyo|why|what|kya|kaisa|kaise|kaun|matlab|meaning|fayda|benefit)\b/;
const feeQuestion = (inp: In) => !inp.replyId && FEE_Q_RE.test(lc(inp.text)) && ASK_RE.test(lc(inp.text));
/** Objections: "pasand nahi aaya", "flat nahi mila to", "refund", "guarantee". */
const FAQ_RE = /pasand (nahi|nhi|nahin|na) (aaya|aya|aye|aaye|aayi|aai)|(flat|ghar|property) (nahi|nhi|nahin|na) (mila|mile|mili) (to|toh)|refund|guarant|gaurant|gurant/;
const faqHit = (inp: In) => !inp.replyId && FAQ_RE.test(lc(inp.text));

/** The benefits message, only once per enquiry: [messages, state]. */
function benefitsOnce(s: State, cfg: DeskConfig): [Out[], State] {
  if (s.benefits) return [[], s];
  return [[{ kind: "text", body: MSG.benefits(cfg.fee, cfg.help_phone) }], { ...s, benefits: true }];
}

/** Lead details for the admin / zone WhatsApp alerts (the server adds the customer's name, number and link). */
export function leadDetails(s: State, cfg: DeskConfig, extra: string[] = []) {
  const zs = cfg.zones.filter((z) => s.zones.includes(z.no));
  return [formNote(s.answers, s.role), s.budget ? `Budget: ${inr(s.budget)}` : null,
    zs.length ? zs.map((z) => `Zone ${z.no}: ${z.name}`).join(", ") : "Zone: not matched", s.answers.timeline ? `Timeline: ${s.answers.timeline}` : null, ...extra]
    .filter(Boolean).join("\n");
}

/** The question the customer still has to answer (asked again after an FAQ / random text). */
function prompt(s: State, cfg: DeskConfig): Out[] {
  switch (s.stage) {
    case "role": return [roleMenu(cfg)];
    case "form": {
      const f = s.asking ? fieldsFor(s.role).find((x) => x.key === s.asking) : undefined;
      return [{ kind: "text", body: f ? `👉 ${f.ask}` : formText(s.role) }];
    }
    case "details": return s.role && s.role in ROLE_FORMS ? [{ kind: "text", body: roleFormText(s.role as keyof typeof ROLE_FORMS) }] : [];
    case "sharing": return [ynButtons(MSG.sharingAsk, "sh")];
    case "timeline": return [timelineOut()];
    case "fast_ask": return [ynButtons(MSG.fastAsk, "fast")];
    case "pitch": case "fee_offer": return [pitchOut(cfg)];
    case "awaiting_payment": return [{ kind: "text", body: MSG.sendScreenshot }];
    default: return [];
  }
}

function afterForm(s: State, cfg: DeskConfig): Result {
  const zs = zonesFor(s.answers.area ?? "", cfg.zones);
  const st: State = { ...s, asking: null, zone: zs[0]?.no ?? null, zones: zs.map((x) => x.no), budget: parseBudget(s.answers.budget ?? "") };
  const b = st.budget ?? 0;
  const form = formNote(st.answers) + (zs.length ? `\n${zs.map((x) => `Zone: ${x.no} ${x.name}`).join("\n")}` : "\nZone: not matched (pick on Rental desk)");
  const note: Act = { kind: "note", body: form };
  const single = isSingle(st.answers);
  const independent = b >= cfg.tenant_min_budget;
  const sharing = !independent && single && b >= cfg.single_min_budget;
  const out: Out[] = [{ kind: "text", body: MSG.brokerage(summaryOf(st.answers)) }];
  // The poster goes with the brokerage note when the lead goes on (cody: full details + budget ₹15k and up).
  if ((independent || sharing) && b >= cfg.poster_min_budget && /^https:\/\//.test(cfg.poster_url)) out.push({ kind: "image", url: cfg.poster_url, caption: "" });

  if (independent) {
    const done: State = { ...st, stage: "timeline" };
    return {
      state: done, handled: true, out: [...out, timelineOut()],
      acts: [note, { kind: "tag", tag: "Form filled" }, { kind: "tag", tag: `Budget ${inr(cfg.tenant_min_budget)}+` },
        ...(zs.length ? [{ kind: "zone_assign", note: form } as Act] : [{ kind: "notify_admins", title: "Rental form: area matched no zone", body: `Area: ${st.answers.area ?? "-"}. Pick the zone on the Rental desk page.`.slice(0, 200) } as Act]),
        { kind: "wa_admin", title: `🏠 New tenant lead (${inr(b)})`, body: leadDetails(done, cfg) },
        ...(zs.length ? [{ kind: "wa_zone", title: `🏠 New tenant lead (${inr(b)})`, body: leadDetails(done, cfg) } as Act] : [])],
    };
  }
  if (sharing) {
    return { state: { ...st, stage: "sharing" }, handled: true, out: [...out, ynButtons(MSG.sharingAsk, "sh")],
      acts: [note, { kind: "tag", tag: "Form filled" }, { kind: "tag", tag: "Single - sharing?" }] };
  }
  return {
    state: { ...st, stage: "declined" }, handled: true,
    out: [...out, { kind: "text", body: MSG.lowBudget(cfg.tenant_min_budget, cfg.instagram_url) }],
    acts: [note, { kind: "tag", tag: "Form filled" }, { kind: "tag", tag: "Low budget" }],
  };
}

function afterBuyerForm(s: State): Result {
  return {
    state: { ...s, stage: "done", asking: null }, handled: true,
    out: [{ kind: "text", body: MSG.buyerThanks }],
    acts: [{ kind: "note", body: formNote(s.answers, "buyer") }, { kind: "tag", tag: "Buyer form filled" },
      { kind: "notify_admins", title: "New Buyer enquiry (form filled)", body: [s.answers.b_budget, s.answers.b_bhk, s.answers.b_area].filter(Boolean).join(" · ").slice(0, 200) }],
  };
}

function takeForm(s: State, inp: In, cfg: DeskConfig): Result {
  let answers = { ...s.answers };
  let bad: Field | null = null;
  const fields = fieldsFor(s.role);
  if (looksLikeForm(inp.text) || !s.asking) {
    answers = { ...answers, ...parseForm(inp.text, fields) };
  } else {
    const f = fields.find((x) => x.key === s.asking);
    if (!f) answers = { ...answers, ...parseForm(inp.text, fields) }; // asked a point the form no longer has
    else if (validAnswer(f, inp.text)) answers[f.key] = clean(inp.text).slice(0, 300);
    else bad = f;
  }
  const miss = missingFields(answers, fields);
  if (!miss.length) return s.role === "buyer" ? afterBuyerForm({ ...s, answers }) : afterForm({ ...s, answers }, cfg);
  const next = bad ?? miss[0];
  let body: string;
  if (s.role === "buyer") body = bad ? MSG.invalidAnswer(bad) : s.asking ? MSG.missingNext(miss.length, next) : MSG.missingFirst(miss.length, next);
  else body = bad ? MSG.invalidAnswer(bad) : MSG.missing(miss, next);
  return { state: { ...s, answers, asking: next.key }, out: [{ kind: "text", body }], acts: [], handled: true };
}

/** A reply that is not the details (hi / ok / thanks / an emoji). */
const ACK_RE = /^(hi+|hello|hey|hlo|ok+|okay|k|haan|han|ha|yes|no|thik|theek|thik hai|theek hai|hmm+|thanks|thank you|ty|done|👍|🙏)[\s.!?🙏👍]*$/i;

/** Lead with the 7-day timeline: priority alert to the admin, then the registration pitch. */
function urgentPitch(s: State, cfg: DeskConfig, label: string, extra: Out[] = []): Result {
  const st: State = { ...s, stage: "pitch", answers: { ...s.answers, timeline: label } };
  return { state: st, handled: true, out: [...extra, pitchOut(cfg)],
    acts: [{ kind: "tag", tag: "URGENT - 7 DAYS" }, { kind: "wa_admin", title: "🚨 URGENT - 7 DAYS lead", body: leadDetails(st, cfg) }] };
}

function pickTimeline(inp: In): 7 | 15 | 30 | null {
  const id = inp.replyId?.split(":").pop();
  if (id === "tl_7") return 7;
  if (id === "tl_15") return 15;
  if (id === "tl_30") return 30;
  const t = lc(inp.text);
  if (/\b15\b|pandrah|2 (week|hafte)|two weeks|^2$/.test(t)) return 15;
  if (/month|mahin|mahena|\b30\b|^3$/.test(t)) return 30;
  if (/\b7\b|saat|1 (week|hafta)|ek hafta|week|hafte|urgent|jaldi|turant|asap|^1$/.test(t)) return 7;
  return null;
}
const TIMELINE_LABEL = { 7: "Within 7 Days", 15: "Within 15 Days", 30: "Within 1 Month" } as const;

const RESTART_STAGES: Stage[] = ["role", "form", "details", "done", "not_registered", "closed", "declined", "sharing", "timeline", "fast_ask", "pitch", "fee_offer"];
const FAQ_STAGES: Stage[] = ["role", "form", "sharing", "timeline", "fast_ask", "pitch", "fee_offer", "awaiting_payment", "not_registered", "declined", "details"];

/**
 * One inbound message → next state, messages to send and side effects.
 * `handled: false` = the desk has nothing to say (an agent handles the chat).
 */
export function step(s0: State | null, inp: In, cfg: DeskConfig): Result {
  const s = s0 ?? freshState();
  const t = lc(inp.text);
  const none = (st: State = s): Result => ({ state: st, out: [], acts: [], handled: true });
  const again = (st: State = s, pre: Out[] = []): Result => ({ state: st, out: [...pre, ...prompt(st, cfg)], acts: [], handled: true });

  // Start / restart.
  if (!s0 || (/^(menu|restart|start)$/.test(t) && RESTART_STAGES.includes(s.stage))) {
    return { state: freshState(), out: [...(isRef(inp) ? [{ kind: "text", body: MSG.refNote } as Out] : []), roleMenu(cfg)], acts: [], handled: true };
  }
  // "Pasand nahi aaya to?", "refund?", "guarantee?": the answer, then the open question again.
  if (faqHit(inp) && FAQ_STAGES.includes(s.stage)) return again(s, [{ kind: "text", body: MSG.faq(cfg.support_phone) }]);

  switch (s.stage) {
    case "role": {
      const role = isRef(inp) ? null : pickRole(inp);
      if (!role) return again(s, isRef(inp) ? [{ kind: "text", body: MSG.refNote }] : []);
      if (role === "tenant") {
        return { state: { ...s, role, stage: "form", asking: null }, out: [{ kind: "text", body: MSG.tenantIntro }, { kind: "text", body: FORM_TEXT }], acts: [{ kind: "tag", tag: "Tenant" }], handled: true };
      }
      return { state: { ...s, role, stage: "details" }, out: [{ kind: "text", body: roleFormText(role as keyof typeof ROLE_FORMS) }], acts: [{ kind: "tag", tag: ROLE_LABEL[role] }], handled: true };
    }
    case "details": {
      const role = s.role ?? "landlord";
      if (!inp.media && (ACK_RE.test(inp.text.trim()) || clean(inp.text).length < 3)) return again(s, [{ kind: "text", body: MSG.detailsAgain }]);
      const label = ROLE_LABEL[role];
      const body = `${label} details:\n${inp.text.trim() || "(photo / file)"}`;
      return {
        state: { ...s, stage: "done" }, out: [{ kind: "text", body: MSG.thanks(role, supportOf(cfg)) }], handled: true,
        acts: [{ kind: "note", body }, { kind: "tag", tag: `${label} details` },
          { kind: "wa_admin", title: `New ${label} enquiry`, body }],
      };
    }
    case "form":
      if (isRef(inp)) return again(s, [{ kind: "text", body: MSG.refNote }]);
      return takeForm(s, inp, cfg);
    case "sharing": {
      const yn = yn2(inp, "sh_yes", "sh_no");
      if (yn === true) {
        const st: State = { ...s, stage: "timeline", answers: { ...s.answers, sharing: "Yes" } };
        return { state: st, handled: true, out: [{ kind: "text", body: MSG.sharingYes(cfg.support_phone) }, timelineOut()],
          acts: [{ kind: "tag", tag: "Sharing flat" }, { kind: "wa_admin", title: "👥 Sharing flat lead", body: leadDetails(st, cfg, ["Sharing flat: Yes"]) }] };
      }
      if (yn === false) return { state: { ...s, stage: "declined" }, out: [{ kind: "text", body: MSG.sharingNo }], acts: [{ kind: "tag", tag: "Sharing: no" }], handled: true };
      return again();
    }
    case "timeline": {
      const d = pickTimeline(inp);
      if (d === 7) return urgentPitch(s, cfg, TIMELINE_LABEL[7]);
      if (d) {
        const st: State = { ...s, stage: "fast_ask", answers: { ...s.answers, timeline: TIMELINE_LABEL[d] } };
        return { state: st, out: [ynButtons(MSG.fastAsk, "fast")], acts: [{ kind: "tag", tag: TIMELINE_LABEL[d] }], handled: true };
      }
      return again();
    }
    case "fast_ask": {
      const yn = yn2(inp, "fast_yes", "fast_no");
      if (yn === true) return { state: { ...s, stage: "pitch" }, out: [pitchOut(cfg)], acts: [], handled: true };
      if (yn === false) return { state: { ...s, stage: "not_registered", base_stage: "not_registered" }, out: [{ kind: "text", body: MSG.fastNo(cfg.support_phone) }], acts: [{ kind: "tag", tag: "Not registered" }], handled: true };
      return again();
    }
    case "pitch":
    case "fee_offer": {
      if (feeQuestion(inp)) {
        const [b, st] = benefitsOnce(s, cfg);
        return again(st, b);
      }
      // Old ₹ offer buttons (sent before 2026-11-23) still work.
      const old = inp.replyId?.endsWith("fee_yes") || inp.replyId?.endsWith("fee_urgent") ? true : inp.replyId?.endsWith("fee_no") ? false : null;
      const yn = old ?? yn2(inp, "qr_yes", "qr_no");
      if (yn === true) {
        return { state: { ...s, stage: "awaiting_payment", plan: "standard" }, out: payOut(cfg, "standard"), handled: true,
          acts: [{ kind: "status", status: "Registration Pending (Rs 200)" }, { kind: "tag", tag: "QR sent" }] };
      }
      if (yn === false) return { state: { ...s, stage: "not_registered", base_stage: "not_registered" }, out: [{ kind: "text", body: MSG.pitchNo(cfg.support_phone) }], acts: [{ kind: "tag", tag: "Not registered" }], handled: true };
      return again();
    }
    case "awaiting_payment":
      if (inp.media) {
        const fee = planFee(s.plan, cfg);
        return {
          state: { ...s, stage: "payment_review" }, out: [{ kind: "text", body: MSG.screenshotThanks }], handled: true,
          acts: [{ kind: "screenshot" }, { kind: "tag", tag: "Payment check" },
            { kind: "wa_admin", title: `💰 PAID ${inr(fee)} REGISTRATION - ACTION REQUIRED`, body: leadDetails(s, cfg, ["Payment screenshot received in the chat. Confirm it on the Rental desk page."]) }],
        };
      }
      if (feeQuestion(inp) && !s.benefits) {
        const [b, st] = benefitsOnce(s, cfg);
        return { state: st, out: [...b, { kind: "text", body: MSG.sendScreenshot }], acts: [], handled: true };
      }
      if (/qr|upi|pay|register/.test(t)) return { state: s, out: payOut(cfg, s.plan), acts: [], handled: true };
      return { state: s, out: [{ kind: "text", body: MSG.sendScreenshot }], acts: [], handled: true };
    case "payment_review":
      if (inp.media) return { state: s, out: [], acts: [{ kind: "screenshot" }], handled: true };
      return none();
    case "not_registered":
      if (/^(register|urgent|qr)\b|register karo|register karna|qr bhejo/.test(t) || inp.replyId?.endsWith("fee_yes") || inp.replyId?.endsWith("fee_urgent") || inp.replyId?.endsWith("qr_yes")) {
        return { state: { ...s, stage: "awaiting_payment", plan: "standard" }, out: payOut(cfg, "standard"), acts: [{ kind: "status", status: "Registration Pending (Rs 200)" }], handled: true };
      }
      if (inp.replyId?.endsWith("fee_no") || inp.replyId?.endsWith("qr_no")) return { state: s, out: [{ kind: "text", body: MSG.keepTouch }], acts: [], handled: true };
      if (feeQuestion(inp) && !s.benefits) {
        const [b, st] = benefitsOnce(s, cfg);
        return { state: st, out: [...b, ynButtons("Register karna hai? QR bhejein? 👇", "qr")], acts: [], handled: true };
      }
      return { ...none(), handled: false };
    case "declined":
    case "registered":
      return { ...none(), handled: false };
    case "fu_ask": {
      const base = s.base_stage ?? "registered";
      const yn = yesNo(inp, "fu_yes", "fu_no");
      if (yn === true) return { state: { ...s, stage: "fu_broker" }, out: [{ kind: "text", body: MSG.askBroker }], acts: [], handled: true };
      if (yn === false) {
        if (base === "registered") return { state: { ...s, stage: base }, out: [{ kind: "text", body: MSG.keepTouch }], acts: [], handled: true };
        // Not registered: the benefits message once (with the QR question), after that the short reminder.
        const [b, st] = benefitsOnce({ ...s, stage: base }, cfg);
        if (b.length) return { state: st, out: [{ kind: "text", body: withLinks(MSG.keepTouch, cfg) }, ...b, ynButtons("Register karna hai? QR bhejein? 👇", "qr")], acts: [], handled: true };
        return { state: st, out: [{ kind: "text", body: withLinks(MSG.keepTouchUnreg(cfg.fee), cfg) }], acts: [], handled: true };
      }
      return { state: { ...s, stage: base }, out: [], acts: [], handled: false };
    }
    case "fu_broker":
      if (!inp.text.trim()) return { state: s, out: [{ kind: "text", body: MSG.askBroker }], acts: [], handled: true };
      return { state: { ...s, stage: "fu_rent", found_broker: clean(inp.text).slice(0, 120) }, out: [{ kind: "text", body: MSG.askRent }], acts: [], handled: true };
    case "fu_rent":
      if (!inp.text.trim()) return { state: s, out: [{ kind: "text", body: MSG.askRent }], acts: [], handled: true };
      return {
        state: { ...s, stage: "fu_happy", found_rent: clean(inp.text).slice(0, 60) }, handled: true,
        out: [{ kind: "buttons", body: MSG.askHappy, buttons: [{ id: "rd:happy_yes", title: MSG.happyYes }, { id: "rd:happy_no", title: MSG.happyNo }] }], acts: [],
      };
    case "fu_happy": {
      const yn = yesNo(inp, "happy_yes", "happy_no");
      const happy = yn === true ? "Yes" : yn === false ? "No" : clean(inp.text).slice(0, 120) || "-";
      const st: State = { ...s, stage: "closed", happy };
      const registered = s.base_stage === "registered";
      return {
        state: st, out: [{ kind: "text", body: MSG.closedThanks }], handled: true,
        acts: [
          { kind: "note", body: `🏠 Flat final. Given by: ${s.found_broker ?? "-"} · Rent: ${s.found_rent ?? "-"} · Happy: ${happy}` },
          { kind: "tag", tag: "Flat final" },
          ...(registered ? [{ kind: "status", status: "Deal Closed" } as Act, { kind: "final_alert" } as Act] : []),
        ],
      };
    }
    case "done":
    case "closed":
      return { ...none(), handled: false };
  }
  return { ...none(), handled: false };
}

/** Whether a not-registered tenant still gets daily follow-ups (budget at or above the minimum). */
export const followUnregistered = (budget: number | null, cfg: DeskConfig) => (budget ?? 0) >= cfg.min_followup_budget;

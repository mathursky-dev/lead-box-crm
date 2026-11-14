// Rental desk: a fixed WhatsApp enquiry flow for rental brokerages (built for LivoraRent Ahmedabad).
// Pure and shared: the webhook runner (lib/rental-desk-server.ts), the admin page and the tests use it.
//
// Flow: who are you (tenant / owner / broker / buyer) → tenant gets the 11-point requirement form →
// every missing answer is asked one by one → the lead goes to the agents of the zone(s) of the area →
// ₹fee registration offer → UPI QR → payment screenshot → an admin confirms the payment on the
// Rental desk page → daily "flat mila?" follow-ups → who gave the flat + final rent + happy? → personal alert.

export type Role = "tenant" | "owner" | "broker" | "buyer";
export type Stage =
  | "role" | "form" | "fee_offer" | "awaiting_payment" | "payment_review" | "registered" | "not_registered"
  | "fu_ask" | "fu_broker" | "fu_rent" | "fu_happy" | "details" | "done" | "closed";

/** A zone: its agents are the active users of department_id (user_id = fallback when the department is empty). */
export type Zone = { no: number; name: string; areas: string[]; user_id: string | null; department_id?: string | null };
export type DeskConfig = {
  enabled: boolean; fee: number; upi_id: string; upi_name: string; qr_url: string;
  /** ₹500 urgent plan: flat within 3 days, adjusted in the final brokerage. */
  urgent_fee: number;
  /** A single person is accepted (sharing flat / PG) only at or above this budget. */
  single_min_budget: number;
  channel_url: string; instagram_url: string;
  /** Call number in the "fill the form first" reply (reel link / screenshot) and the benefits message. */
  help_phone: string;
  min_followup_budget: number; followup_hours: number; max_followups: number; max_followups_unreg: number;
  zones: Zone[];
};

export type Field = { key: string; label: string; ask: string; aliases: string[]; number?: boolean };

/** The RENTAL REQUIREMENT FORM (11 points, cody 2026-11-14), in the order the customer sees it. */
export const FIELDS: Field[] = [
  { key: "bhk", label: "BHK", ask: "Kitne BHK chahiye? (1 / 2 / 3 BHK)", aliases: ["bhk"] },
  { key: "budget", label: "Monthly Budget (Rent + Maint)", ask: "Monthly budget kitna hai? (Rent + Maintenance, jaise 25000)", aliases: ["budget", "monthly budget", "rent + maint"], number: true },
  { key: "area", label: "Preferred Area / Landmark", ask: "Preferred area / landmark kaunsa hai?", aliases: ["preferred area", "area", "landmark", "location"] },
  { key: "furnishing", label: "Furnishing (Full / Semi / Raw)", ask: "Furnishing kaisi chahiye? (Full / Semi / Raw)", aliases: ["furnishing", "furnished"] },
  { key: "move_in", label: "Move-in Date", ask: "Move-in date kab ki hai?", aliases: ["move-in", "move in", "shifting"] },
  { key: "tenant_type", label: "Tenant Type (Family / Bachelors / Working)", ask: "Tenant type kya hai? (Family / Bachelors / Working)", aliases: ["tenant type", "tenant"] },
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
  ["Planned Stay Duration (Tenure)", "tenure"], ["Comfortable with Society Rules (Yes/No)", null], ["Agree to Lock-in & 1-Month Notice (Yes/No)", null],
].map(([k, v]) => [labelKey(k as string), v]));

/** True when the text looks like the filled form (at least 2 numbered or labelled lines). */
export function looksLikeForm(text: string) {
  const lines = text.split(/\r?\n/);
  const numbered = lines.filter((l) => /^\s*\*?\s*(?:[1-9]|1\d|20)\s*[.)\-:]/.test(l)).length;
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
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20) {
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

export const MSG = {
  welcome: "Namaste 🙏 *LivoraRent* me aapka swagat hai, Ahmedabad West me aapka rental property partner 🏠\n\nAap kaun hain? Neeche se choose kariye 👇",
  roleRows: [
    { id: "tenant", title: "Tenant", description: "Mujhe ghar kiraye pe chahiye" },
    { id: "owner", title: "Owner", description: "Mera flat kiraye pe dena hai" },
    { id: "broker", title: "Broker", description: "Main broker hoon" },
    { id: "buyer", title: "Buyer", description: "Mujhe ghar kharidna hai" },
  ],
  tenantIntro:
    "Bahut badhiya 👍 Aapke liye best rental option dhoondhne ke liye neeche wala form *copy karke har line bhar kar* bhejiye.\n\n" +
    "📌 Humare paas *₹25,000+ budget* ki rental properties hain:\n• 1BHK furnished: ₹20,000 se\n• 2BHK furnished: ₹25,000 se\n• 3BHK furnished: ₹30,000 se\n\n" +
    "_Note: Budget aur location ke hisaab se hi market me available options diye jaenge. Unrealistic demand par hum kaam nahi karte._",
  details: {
    owner: "Dhanyavaad 🙏 Apne flat ki details bhejiye: area, BHK, rent, furnishing aur photos (agar ho to).",
    broker: "Dhanyavaad 🙏 Apna naam, agency aur aapke paas kaunsi property / requirement hai, bataiye.",
  } as Record<"owner" | "broker", string>,
  buyerIntro: "Bahut badhiya 👍 Aapke liye sahi property dhoondhne ke liye neeche wala form *copy karke har line bhar kar* bhejiye. Jo detail baaki rahegi, hum ek-ek karke puch lenge.",
  buyerThanks: "Dhanyavaad 🙏 Aapki poori requirement mil gayi hai. Humari team jaldi aapse contact karegi aur aapke budget aur location ke hisaab se best options share karegi 🏡",
  detailsThanks: "Shukriya 🙏 Humari team jaldi aapse contact karegi 📞",
  missingFirst: (n: number, f: Field) => `Dhanyavaad 🙏 Form me *${n} detail${n === 1 ? "" : "s"}* baaki hai. Poori details ke bina enquiry submit nahi hogi.\n\n👉 ${f.ask}`,
  missingNext: (n: number, f: Field) => `👍 Noted. ${n} aur baaki.\n\n👉 ${f.ask}`,
  invalidAnswer: (f: Field) => f.number ? `Kripya budget number me bataiye (jaise 25000) 🙏\n\n👉 ${f.ask}` : `👉 ${f.ask}`,
  feeOffer: (summary: string, zone: string, fee: number, urgent: number) =>
    `✅ Aapki requirement mil gayi!\n\n${summary}${zone ? `\n📍 ${zone}` : ""}\n\n` +
    "Hum daily limited aur genuine enquiries par hi kaam karte hain. Humari *dedicated team* aapki requirement ke hisaab se best options dhoondh kar deti hai.\n\n" +
    `📋 *${inr(fee)} Registration*\n• *100 ghante ke andar* final flat options\n• ${inr(fee)} non-refundable\n\n` +
    `⚡ *${inr(urgent)} Urgent (3 din me flat)*\n• Team sirf aapke liye options filter karegi\n• ${inr(urgent)} aapke final brokerage me *100% adjust* (koi extra kharcha nahi)`,
  feeYes: "₹200 Register",
  feeUrgent: "₹500 Urgent (3 din)",
  feeNo: "Abhi nahi",
  singleOk: "👤 Single person ke liye hum *sharing flat / PG* options bhi dete hain.",
  singleDecline: (min: number) => `Dhanyavaad 🙏 Single person ke liye hum ${inr(min)}+ budget me hi sharing flat / PG options par kaam karte hain.`,
  payQrCaption: (fee: number, upi: string) => `${inr(fee)} is QR par pay kariye${upi ? `\nUPI ID: ${upi}` : ""}`,
  payText: (fee: number, upi: string) => `💳 ${inr(fee)} registration fee${upi ? `\nUPI ID: *${upi}*` : ""}\n\nPayment ke baad *screenshot yahin bhejiye* 📸 Payment confirm hote hi aapki enquiry aapke zone ki dedicated team ko submit ho jayegi.`,
  sendScreenshot: "Payment ka *screenshot* (photo) yahin bhejiye 📸 Koi sawaal ho to likhiye, team jawab degi.",
  screenshotThanks: "Screenshot mil gaya ✅ Hum payment check karke jaldi confirm karte hain. Confirm hote hi aapki enquiry zone team ko submit ho jayegi.",
  notNow: "Koi baat nahi 🙏 Jab tak aapko best option nahi milta, humare touch me rahiye. We will help you as soon as possible.\n\nKabhi bhi register karna ho to *REGISTER* (ya urgent ke liye *URGENT*) likh kar bhejiye.",
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
  /** Reel link / screenshot instead of the form (cody 2026-11-14). */
  formFirst: (phone: string) =>
    "Pahle *Requirement Form* fill kariye, to aapko complete multiple property options or same property ki bhi details mil jaegi 🙏" +
    (phone ? `\n\nAgar koi query hai to aap humare number par call kar sakte hain: ${phone}` : "") + "\n\nThank You!!!",
  /** "₹500 kis baat ka?" / not registering: sent once per enquiry (cody 2026-11-14). */
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
  keepTouchUnreg: (fee: number) => `Hum help kar sakte hain 🙌 Dedicated team se urgent options ke liye ${inr(fee)} registration kariye: *REGISTER* likh kar bhejiye.`,
};

export function summaryOf(a: Answers) {
  const b = parseBudget(a.budget ?? "");
  return [
    a.bhk && `🏠 ${a.bhk}`, b && `💰 ${inr(b)}/month`, a.area && `📍 ${a.area}`, a.move_in && `📅 Move-in: ${a.move_in}`,
    a.tenant_type && `👥 ${a.tenant_type}${a.occupants ? ` (${a.occupants})` : ""}`, a.furnishing && `🛋️ ${a.furnishing}`,
  ].filter(Boolean).join("\n");
}

/** Full form as a note on the lead / message to the zone user. */
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
  | { kind: "zone_assign"; note: string };

export type In = { text: string; replyId?: string | null; media: boolean };
export type Result = { state: State; out: Out[]; acts: Act[]; handled: boolean };

export const freshState = (): State => ({
  stage: "role", role: null, answers: {}, asking: null, zone: null, budget: null, base_stage: null, found_broker: null, found_rent: null, happy: null, plan: null, zones: [], benefits: false,
});

const lc = (s: string) => s.trim().toLowerCase();
const NO_RE = /\b(nahi|nahin|nai|na|no|not|nope|abhi nahi|not yet)\b/;
const YES_RE = /\b(haan|han|ha|haa|yes|yeah|yep|ok|okay|mil gaya|mila|mil gya|done|ho gaya|final)\b/;

/** yes / no / null from a button id or a typed reply. */
function yesNo(inp: In, yesId: string, noId: string): boolean | null {
  if (inp.replyId?.endsWith(yesId)) return true;
  if (inp.replyId?.endsWith(noId)) return false;
  const t = lc(inp.text);
  if (NO_RE.test(t)) return false;
  if (YES_RE.test(t)) return true;
  return null;
}

function pickRole(inp: In): Role | null {
  const id = inp.replyId?.split(":").pop();
  if (id && ["tenant", "owner", "broker", "buyer"].includes(id)) return id as Role;
  const t = lc(inp.text);
  if (/^1\b|tenant|kiray|rent pe|on rent|chahiye/.test(t)) return "tenant";
  if (/^2\b|owner|malik|dena hai/.test(t)) return "owner";
  if (/^3\b|broker|agent|dalal/.test(t)) return "broker";
  if (/^4\b|buyer|buy|kharid|purchase/.test(t)) return "buyer";
  return null;
}

const roleMenu = (): Out => ({ kind: "list", body: MSG.welcome, button: "Choose kariye", rows: MSG.roleRows });
const feeButtons = (body: string, cfg: DeskConfig): Out => ({ kind: "buttons", body, buttons: [
  { id: "rd:fee_yes", title: `${inr(cfg.fee)} Register` }, { id: "rd:fee_urgent", title: `${inr(cfg.urgent_fee)} Urgent (3 din)` }, { id: "rd:fee_no", title: MSG.feeNo }] });
export const planFee = (plan: State["plan"], cfg: Pick<DeskConfig, "fee" | "urgent_fee">) => (plan === "urgent" ? cfg.urgent_fee : cfg.fee);

/** "1", "single", "akela", "1 person" → one person living alone. */
export function isSingle(a: Answers) {
  const occ = clean(a.occupants ?? "").toLowerCase();
  return /^(1|one|ek)\b|single|akela|alone|^1\s*(person|member|log|people)/.test(occ) || /\bsingle\b/.test((a.tenant_type ?? "").toLowerCase());
}

/** Plan picked on the offer: urgent / standard / no / null (unclear). */
function pickPlan(inp: In): "urgent" | "standard" | "no" | null {
  if (inp.replyId?.endsWith("fee_urgent")) return "urgent";
  if (inp.replyId?.endsWith("fee_yes")) return "standard";
  if (inp.replyId?.endsWith("fee_no")) return "no";
  const t = lc(inp.text);
  if (/urgent|500|3 din|teen din/.test(t)) return "urgent";
  if (NO_RE.test(t)) return "no";
  if (/register|200|pay|haan|yes|ok/.test(t)) return "standard";
  return null;
}
export const followupOut = (): Out => ({ kind: "buttons", body: MSG.followup, buttons: [{ id: "rd:fu_yes", title: MSG.fuYes }, { id: "rd:fu_no", title: MSG.fuNo }] });

function payOut(cfg: DeskConfig, plan: State["plan"]): Out[] {
  const fee = planFee(plan, cfg);
  const out: Out[] = [];
  if (/^https:\/\//.test(cfg.qr_url)) out.push({ kind: "image", url: cfg.qr_url, caption: MSG.payQrCaption(fee, cfg.upi_id) });
  out.push({ kind: "text", body: MSG.payText(fee, cfg.upi_id) });
  return out;
}
const withLinks = (body: string, cfg: DeskConfig) => [body, MSG.links(cfg.channel_url, cfg.instagram_url)].filter(Boolean).join("\n\n");

const zoneText = (zs: Zone[]) => zs.map((z) => `Zone ${z.no}: ${z.name}`).join("\n📍 ");

/** Reel / post link or a photo instead of the form. */
const LINK_RE = /https?:\/\/|www\.|instagram\.com|instagr\.am|youtu\.?be|fb\.watch/i;
const isReel = (inp: In) => (inp.media && !looksLikeForm(inp.text)) || (LINK_RE.test(inp.text) && !looksLikeForm(inp.text));

/** "₹500 kis baat ka?", "200 kyu?", "registration fee kya hai": a question about the fee. */
const FEE_Q_RE = /(200|500|fee|fees|charge|registration|register|paise|paisa|payment)/;
const ASK_RE = /\?|\b(kis|kiss|kyu|kyun|kyon|kyo|why|what|kya|kaisa|kaise|kaun|matlab|meaning|fayda|benefit)\b/;
const feeQuestion = (inp: In) => !inp.replyId && FEE_Q_RE.test(lc(inp.text)) && ASK_RE.test(lc(inp.text));

/** The benefits message, only once per enquiry: [messages, state]. */
function benefitsOnce(s: State, cfg: DeskConfig): [Out[], State] {
  if (s.benefits) return [[], s];
  return [[{ kind: "text", body: MSG.benefits(cfg.urgent_fee, cfg.help_phone) }], { ...s, benefits: true }];
}

function afterForm(s: State, cfg: DeskConfig): Result {
  const zs = zonesFor(s.answers.area ?? "", cfg.zones);
  const z = zs[0] ?? null;
  const st: State = { ...s, stage: "fee_offer", asking: null, zone: z?.no ?? null, zones: zs.map((x) => x.no), budget: parseBudget(s.answers.budget ?? "") };
  const form = formNote(st.answers) + (zs.length ? `\n${zs.map((x) => `Zone: ${x.no} ${x.name}`).join("\n")}` : "\nZone: not matched (pick on Rental desk)");
  const note: Act = { kind: "note", body: form };
  const single = isSingle(st.answers);
  // Single person: only with a budget for a sharing flat / PG.
  if (single && (st.budget ?? 0) < cfg.single_min_budget) {
    return {
      state: { ...st, stage: "not_registered", base_stage: "not_registered" }, handled: true,
      out: [{ kind: "text", body: withLinks(MSG.singleDecline(cfg.single_min_budget), cfg) }],
      acts: [note, { kind: "tag", tag: "Single - low budget" }],
    };
  }
  const summary = summaryOf(st.answers) + (single ? `\n${MSG.singleOk}` : "");
  return {
    state: st, handled: true,
    // Long text first, then the buttons (an interactive body is limited to 1024 characters).
    out: [{ kind: "text", body: MSG.feeOffer(summary, zoneText(zs), cfg.fee, cfg.urgent_fee) }, feeButtons("Kaunsa option chahiye? 👇", cfg)],
    acts: [note, { kind: "tag", tag: "Form filled" }, ...(single ? [{ kind: "tag", tag: "Single - sharing/PG" } as Act] : []),
      ...(zs.length ? [{ kind: "zone_assign", note: form } as Act] : [{ kind: "notify_admins", title: "Rental form: area matched no zone", body: `Area: ${st.answers.area ?? "-"}. Pick the zone on the Rental desk page.`.slice(0, 200) } as Act])],
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
  if (looksLikeForm(inp.text) || !s.asking) {
    answers = { ...answers, ...parseForm(inp.text, fieldsFor(s.role)) };
  } else {
    const f = fieldsFor(s.role).find((x) => x.key === s.asking);
    if (!f) answers = { ...answers, ...parseForm(inp.text, fieldsFor(s.role)) }; // asked a point the form no longer has
    else if (validAnswer(f, inp.text)) answers[f.key] = clean(inp.text).slice(0, 300);
    else bad = f;
  }
  const miss = missingFields(answers, fieldsFor(s.role));
  if (!miss.length) return s.role === "buyer" ? afterBuyerForm({ ...s, answers }) : afterForm({ ...s, answers }, cfg);
  const next = bad ?? miss[0];
  const body = bad ? MSG.invalidAnswer(bad) : s.asking ? MSG.missingNext(miss.length, next) : MSG.missingFirst(miss.length, next);
  return { state: { ...s, answers, asking: next.key }, out: [{ kind: "text", body }], acts: [], handled: true };
}

/**
 * One inbound message → next state, messages to send and side effects.
 * `handled: false` = the desk has nothing to say (an agent handles the chat).
 */
export function step(s0: State | null, inp: In, cfg: DeskConfig): Result {
  const s = s0 ?? freshState();
  const t = lc(inp.text);
  const none = (st: State = s): Result => ({ state: st, out: [], acts: [], handled: true });

  // Start / restart.
  if (!s0 || (/^(menu|restart|start)$/.test(t) && ["role", "form", "fee_offer", "details", "done", "not_registered", "closed"].includes(s.stage))) {
    return { state: freshState(), out: [...(isReel(inp) ? [{ kind: "text", body: MSG.formFirst(cfg.help_phone) } as Out] : []), roleMenu()], acts: [], handled: true };
  }

  switch (s.stage) {
    case "role": {
      const role = isReel(inp) ? null : pickRole(inp);
      if (!role) return { state: s, out: [...(isReel(inp) ? [{ kind: "text", body: MSG.formFirst(cfg.help_phone) } as Out] : []), roleMenu()], acts: [], handled: true };
      if (role === "buyer") {
        return { state: { ...s, role, stage: "form", asking: null }, out: [{ kind: "text", body: MSG.buyerIntro }, { kind: "text", body: formText("buyer") }], acts: [{ kind: "tag", tag: "Buyer" }], handled: true };
      }
      if (role === "tenant") {
        return { state: { ...s, role, stage: "form", asking: null }, out: [{ kind: "text", body: MSG.tenantIntro }, { kind: "text", body: FORM_TEXT }], acts: [{ kind: "tag", tag: "Tenant" }], handled: true };
      }
      return { state: { ...s, role, stage: "details" }, out: [{ kind: "text", body: MSG.details[role as "owner" | "broker"] }], acts: [{ kind: "tag", tag: role[0].toUpperCase() + role.slice(1) }], handled: true };
    }
    case "details": {
      const label = s.role ? s.role[0].toUpperCase() + s.role.slice(1) : "Contact";
      return {
        state: { ...s, stage: "done" }, out: [{ kind: "text", body: MSG.detailsThanks }], handled: true,
        acts: [{ kind: "note", body: `${label} details: ${inp.text || "(media)"}` }, { kind: "notify_admins", title: `New ${label} enquiry on WhatsApp`, body: (inp.text || "Sent a photo / file").slice(0, 200) }],
      };
    }
    case "form":
      if (isReel(inp)) {
        const f = s.asking ? fieldsFor(s.role).find((x) => x.key === s.asking) : undefined;
        return { state: s, out: [{ kind: "text", body: MSG.formFirst(cfg.help_phone) }, { kind: "text", body: f ? `👉 ${f.ask}` : formText(s.role) }], acts: [], handled: true };
      }
      return takeForm(s, inp, cfg);
    case "fee_offer": {
      if (feeQuestion(inp)) {
        const [b, st] = benefitsOnce(s, cfg);
        return { state: st, out: [...b, feeButtons("Kaunsa option chahiye? 👇", cfg)], acts: [], handled: true };
      }
      const p = pickPlan(inp);
      if (p === "standard" || p === "urgent") {
        return { state: { ...s, stage: "awaiting_payment", plan: p }, out: payOut(cfg, p), handled: true,
          acts: [{ kind: "status", status: "Registration Pending (Rs 200)" }, ...(p === "urgent" ? [{ kind: "tag", tag: "Urgent 3 days" } as Act] : [])] };
      }
      if (p === "no") {
        const [b, st] = benefitsOnce({ ...s, stage: "not_registered", base_stage: "not_registered" }, cfg);
        return { state: st, out: [{ kind: "text", body: withLinks(MSG.notNow, cfg) }, ...b], acts: [{ kind: "tag", tag: "Not registered" }], handled: true };
      }
      return { state: s, out: [feeButtons("Kaunsa option chahiye? 👇", cfg)], acts: [], handled: true };
    }
    case "awaiting_payment":
      if (inp.media) {
        return {
          state: { ...s, stage: "payment_review" }, out: [{ kind: "text", body: MSG.screenshotThanks }], handled: true,
          acts: [{ kind: "screenshot" }, { kind: "tag", tag: "Payment check" }, { kind: "notify_admins", title: `💰 ${inr(planFee(s.plan, cfg))}${s.plan === "urgent" ? " (urgent)" : ""} screenshot received`, body: "Check the payment and confirm it on the Rental desk page." }],
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
      if (/^(register|urgent)\b|register karo|register karna/.test(t) || inp.replyId?.endsWith("fee_yes") || inp.replyId?.endsWith("fee_urgent")) {
        const plan = /^urgent/.test(t) || inp.replyId?.endsWith("fee_urgent") ? "urgent" : "standard";
        return { state: { ...s, stage: "awaiting_payment", plan }, out: payOut(cfg, plan), acts: [{ kind: "status", status: "Registration Pending (Rs 200)" }], handled: true };
      }
      if (inp.replyId?.endsWith("fee_no")) return { state: s, out: [{ kind: "text", body: MSG.keepTouch }], acts: [], handled: true };
      if (feeQuestion(inp) && !s.benefits) {
        const [b, st] = benefitsOnce(s, cfg);
        return { state: st, out: [...b, feeButtons("Register karna hai? 👇", cfg)], acts: [], handled: true };
      }
      return { ...none(), handled: false };
    case "registered":
      return { ...none(), handled: false };
    case "fu_ask": {
      const base = s.base_stage ?? "registered";
      const yn = yesNo(inp, "fu_yes", "fu_no");
      if (yn === true) return { state: { ...s, stage: "fu_broker" }, out: [{ kind: "text", body: MSG.askBroker }], acts: [], handled: true };
      if (yn === false) {
        if (base === "registered") return { state: { ...s, stage: base }, out: [{ kind: "text", body: MSG.keepTouch }], acts: [], handled: true };
        // Not registered: the benefits message once (with Register buttons), after that the short reminder.
        const [b, st] = benefitsOnce({ ...s, stage: base }, cfg);
        if (b.length) return { state: st, out: [{ kind: "text", body: withLinks(MSG.keepTouch, cfg) }, ...b, feeButtons("Register karna hai? 👇", cfg)], acts: [], handled: true };
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

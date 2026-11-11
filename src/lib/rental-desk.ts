// Rental desk: a fixed WhatsApp enquiry flow for rental brokerages (built for LivoraRent Ahmedabad).
// Pure and shared: the webhook runner (lib/rental-desk-server.ts), the admin page and the tests use it.
//
// Flow: who are you (tenant / owner / broker / buyer) → tenant gets the 20-point requirement form →
// every missing answer is asked one by one → ₹fee registration offer → UPI QR → payment screenshot →
// an admin confirms the payment on the Rental desk page → the lead goes to the zone's user →
// daily "flat mila?" follow-ups → who gave the flat + final rent + happy? → personal alert.

export type Role = "tenant" | "owner" | "broker" | "buyer";
export type Stage =
  | "role" | "form" | "fee_offer" | "awaiting_payment" | "payment_review" | "registered" | "not_registered"
  | "fu_ask" | "fu_broker" | "fu_rent" | "fu_happy" | "details" | "done" | "closed";

export type Zone = { no: number; name: string; areas: string[]; user_id: string | null };
export type DeskConfig = {
  enabled: boolean; fee: number; upi_id: string; upi_name: string; qr_url: string;
  /** ₹500 urgent plan: flat within 3 days, adjusted in the final brokerage. */
  urgent_fee: number;
  /** A single person is accepted (sharing flat / PG) only at or above this budget. */
  single_min_budget: number;
  channel_url: string; instagram_url: string;
  min_followup_budget: number; followup_hours: number; max_followups: number; max_followups_unreg: number;
  zones: Zone[];
};

export type Field = { key: string; label: string; ask: string; aliases: string[]; number?: boolean };

/** The 20-point RENTAL REQUIREMENT FORM, in the order the customer sees it. */
export const FIELDS: Field[] = [
  { key: "bhk", label: "BHK", ask: "Kitne BHK chahiye? (1 / 2 / 3 BHK)", aliases: ["bhk"] },
  { key: "budget", label: "Monthly Budget (Rent + Maint)", ask: "Monthly budget kitna hai? (Rent + Maintenance, jaise 25000)", aliases: ["budget", "monthly budget", "rent + maint"], number: true },
  { key: "move_in", label: "Move-in Date", ask: "Move-in date kab ki hai?", aliases: ["move-in", "move in", "shifting"] },
  { key: "deposit", label: "Deposit Capacity", ask: "Deposit kitna de sakte hain?", aliases: ["deposit"] },
  { key: "occupants", label: "Total Occupants", ask: "Kul kitne log rahenge? (Total occupants)", aliases: ["occupants", "total members", "members"] },
  { key: "tenant_type", label: "Tenant Type (Family/Bachelors/Working)", ask: "Tenant type kya hai? (Family / Bachelors / Working)", aliases: ["tenant type", "tenant"] },
  { key: "profession", label: "Profession & Office Location", ask: "Aapka profession aur office location kya hai?", aliases: ["profession", "office"] },
  { key: "food", label: "Food Preference (Veg/Non-Veg)", ask: "Food preference? (Veg / Non-Veg)", aliases: ["food"] },
  { key: "pets", label: "Pets (Yes/No)", ask: "Pets hain? (Yes / No)", aliases: ["pets", "pet"] },
  { key: "area", label: "Preferred Area / Landmark", ask: "Preferred area / landmark kaunsa hai?", aliases: ["preferred area", "area", "landmark", "location"] },
  { key: "commute", label: "Max Commute Distance", ask: "Office tak max kitni doori chalegi? (Max commute distance)", aliases: ["commute", "distance"] },
  { key: "metro", label: "Metro / Public Transport Needed", ask: "Metro / public transport paas me chahiye? (Yes / No)", aliases: ["metro", "public transport", "transport"] },
  { key: "furnishing", label: "Furnishing (Full / Semi / Raw)", ask: "Furnishing kaisi chahiye? (Full / Semi / Raw)", aliases: ["furnishing", "furnished"] },
  { key: "parking", label: "Parking Needed (Car / 2-Wheeler)", ask: "Parking chahiye? (Car / 2-Wheeler / No)", aliases: ["parking"] },
  { key: "floor", label: "Floor Preference & Lift Needed", ask: "Floor preference aur lift chahiye ya nahi?", aliases: ["floor", "lift"] },
  { key: "balcony", label: "Balcony Compulsory (Yes/No)", ask: "Balcony compulsory hai? (Yes / No)", aliases: ["balcony"] },
  { key: "backup", label: "24/7 Water & Power Backup Needed", ask: "24/7 water aur power backup chahiye? (Yes / No)", aliases: ["water", "power backup", "backup"] },
  { key: "tenure", label: "Planned Stay Duration (Tenure)", ask: "Kitne time tak rehne ka plan hai? (Tenure)", aliases: ["stay duration", "tenure", "duration"] },
  { key: "rules", label: "Comfortable with Society Rules (Yes/No)", ask: "Society rules ke saath comfortable hain? (Yes / No)", aliases: ["society rules", "society"] },
  { key: "lockin", label: "Agree to Lock-in & 1-Month Notice (Yes/No)", ask: "Lock-in aur 1 month notice se agree hain? (Yes / No)", aliases: ["lock-in", "lock in", "notice"] },
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
const formTitle = (role: Role | null) => (role === "buyer" ? "PROPERTY BUYING REQUIREMENT FORM" : "RENTAL REQUIREMENT FORM");
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
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= FIELDS.length) {
      f = FIELDS[Number(m[1]) - 1];
      v = valueAfterLabel(m[2], f);
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

/** The zone of a preferred area: the longest area name found in the text wins (so "Thaltej-Sola Road" beats "Thaltej"). */
export function zoneFor(area: string, zones: Zone[]): Zone | null {
  if (!area?.trim()) return null;
  const t = norm(area), tq = squash(area);
  let best: { z: Zone; len: number } | null = null;
  for (const z of zones) {
    for (const a of z.areas) {
      const k = norm(a).trim(), kq = squash(a);
      if (!kq) continue;
      const hit = t.includes(` ${k} `) || (kq.length >= 6 && tq.includes(kq));
      if (hit && (!best || kq.length > best.len)) best = { z, len: kq.length };
    }
  }
  return best?.z ?? null;
}

/** LivoraRent – Ahmedabad West, 5 main broker zones (from their zone poster). Spelling variants included. */
export const LIVORA_ZONES: Omit<Zone, "user_id">[] = [
  { no: 1, name: "Satellite-Prahladnagar Hub", areas: [
    "Satellite", "Jodhpur", "Jodhpur Gam", "Shivranjani", "Anandnagar", "Anand Nagar", "Ramdevnagar", "Ramdev Nagar", "Nehrunagar", "Nehru Nagar",
    "Shyamal", "Prahladnagar", "Prahlad Nagar", "Makarba", "Vejalpur", "Juhapura", "Sarkhej", "Vasna", "Fatehwadi", "Corporate Road",
    "South Satellite", "100 Feet Road", "100 Ft Road", "Shreyas Crossing", "Shreyas"] },
  { no: 2, name: "Bodakdev-Thaltej-Bopal Hub", areas: [
    "Bodakdev", "Thaltej", "Sindhu Bhavan", "Sindhubhavan", "Hebatpur", "Shilaj", "Ambli", "Bopal", "South Bopal", "Shela",
    "Ghuma", "Sanathal", "Godhavi", "Telav", "Science City", "Drive In", "Drive-In Road", "Judges Bungalow", "Palladium",
    "Iscon", "Ambli Road", "SP Ring Road", "S P Ring Road", "Ring Road Bopal", "Vastrapur Lake"] },
  { no: 3, name: "Sola-Gota-Ghatlodia Hub", areas: [
    "Sola", "Gota", "Jagatpur", "Chandlodia", "Chandlodiya", "Ghatlodia", "Ghatlodiya", "Bhadaj", "Tragad", "Ognaj", "Sola Road", "New Sola",
    "Thaltej Sola Road", "Ranna Park", "Akhbarnagar", "Akhbar Nagar", "Nirnaynagar", "Nirnay Nagar", "Chandlodia Railway", "Vaishnodevi",
    "Vaishno Devi", "Zundal S", "Bhuyangdev", "Sattadhar", "KK Nagar", "K K Nagar", "RC Technical", "R C Technical"] },
  { no: 4, name: "Chandkheda-Sabarmati Hub", areas: [
    "Chandkheda", "Motera", "Motera Stadium", "Sabarmati", "New CG Road", "Zundal", "Koteshwar", "Tapovan", "Visat", "Ranip", "New Ranip", "ONGC",
    "IOC Road", "Tragad Extension", "Adalaj", "Chandkheda Railway", "Sabarmati Railway", "Acher", "Ramnagar", "Ram Nagar", "D Cabin",
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
  | { kind: "final_alert" };

export type In = { text: string; replyId?: string | null; media: boolean };
export type Result = { state: State; out: Out[]; acts: Act[]; handled: boolean };

export const freshState = (): State => ({
  stage: "role", role: null, answers: {}, asking: null, zone: null, budget: null, base_stage: null, found_broker: null, found_rent: null, happy: null, plan: null,
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

function afterForm(s: State, cfg: DeskConfig): Result {
  const z = zoneFor(s.answers.area ?? "", cfg.zones);
  const st: State = { ...s, stage: "fee_offer", asking: null, zone: z?.no ?? null, budget: parseBudget(s.answers.budget ?? "") };
  const note: Act = { kind: "note", body: formNote(st.answers) + (z ? `\nZone: ${z.no} ${z.name}` : "\nZone: not matched (pick on Rental desk)") };
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
    out: [{ kind: "text", body: MSG.feeOffer(summary, z ? `Zone ${z.no}: ${z.name}` : "", cfg.fee, cfg.urgent_fee) }, feeButtons("Kaunsa option chahiye? 👇", cfg)],
    acts: [note, { kind: "tag", tag: "Form filled" }, ...(single ? [{ kind: "tag", tag: "Single - sharing/PG" } as Act] : [])],
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
    const f = fieldsFor(s.role).find((x) => x.key === s.asking)!;
    if (validAnswer(f, inp.text)) answers[f.key] = clean(inp.text).slice(0, 300);
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
    return { state: freshState(), out: [roleMenu()], acts: [], handled: true };
  }

  switch (s.stage) {
    case "role": {
      const role = pickRole(inp);
      if (!role) return { state: s, out: [roleMenu()], acts: [], handled: true };
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
      if (inp.media && !inp.text.trim()) return { state: s, out: [{ kind: "text", body: s.asking ? MSG.invalidAnswer(fieldsFor(s.role).find((f) => f.key === s.asking)!) : "Kripya form text me bhar kar bhejiye 🙏" }], acts: [], handled: true };
      return takeForm(s, inp, cfg);
    case "fee_offer": {
      const p = pickPlan(inp);
      if (p === "standard" || p === "urgent") {
        return { state: { ...s, stage: "awaiting_payment", plan: p }, out: payOut(cfg, p), handled: true,
          acts: [{ kind: "status", status: "Registration Pending (Rs 200)" }, ...(p === "urgent" ? [{ kind: "tag", tag: "Urgent 3 days" } as Act] : [])] };
      }
      if (p === "no") return { state: { ...s, stage: "not_registered", base_stage: "not_registered" }, out: [{ kind: "text", body: withLinks(MSG.notNow, cfg) }], acts: [{ kind: "tag", tag: "Not registered" }], handled: true };
      return { state: s, out: [feeButtons("Kaunsa option chahiye? 👇", cfg)], acts: [], handled: true };
    }
    case "awaiting_payment":
      if (inp.media) {
        return {
          state: { ...s, stage: "payment_review" }, out: [{ kind: "text", body: MSG.screenshotThanks }], handled: true,
          acts: [{ kind: "screenshot" }, { kind: "tag", tag: "Payment check" }, { kind: "notify_admins", title: `💰 ${inr(planFee(s.plan, cfg))}${s.plan === "urgent" ? " (urgent)" : ""} screenshot received`, body: "Check the payment and confirm it on the Rental desk page." }],
        };
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
      return { ...none(), handled: false };
    case "registered":
      return { ...none(), handled: false };
    case "fu_ask": {
      const base = s.base_stage ?? "registered";
      const yn = yesNo(inp, "fu_yes", "fu_no");
      if (yn === true) return { state: { ...s, stage: "fu_broker" }, out: [{ kind: "text", body: MSG.askBroker }], acts: [], handled: true };
      if (yn === false) {
        return { state: { ...s, stage: base }, out: [{ kind: "text", body: base === "registered" ? MSG.keepTouch : withLinks(MSG.keepTouchUnreg(cfg.fee), cfg) }], acts: [], handled: true };
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

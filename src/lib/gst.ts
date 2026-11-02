// GST helpers: state codes, GSTIN check, per-line tax split (CGST/SGST vs IGST),
// GSTR-1 sections (B2B, B2CL, B2CS, HSN, documents) and the NIC e-invoice JSON.
// Pure functions, no server imports (the invoice editor uses some of them too).

import { lineAmount, type QuoteItem } from "./quotes";

export const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "96": "Foreign Country",
};

/** "27-Maharashtra" as the GST portal writes a place of supply. */
export const posLabel = (code: string | null | undefined) => (code && STATES[code] ? `${code}-${STATES[code]}` : "");

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CP = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Format + checksum check of a GSTIN (15 chars). */
export function validGstin(raw: string | null | undefined): boolean {
  const g = String(raw ?? "").trim().toUpperCase();
  if (!GSTIN_RE.test(g) || !STATES[g.slice(0, 2)]) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CP.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CP[(36 - (sum % 36)) % 36] === g[14];
}

export const stateOfGstin = (g: string | null | undefined) => {
  const s = String(g ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(s) && STATES[s] ? s : null;
};

/** HSN codes are 4/6/8 digits (SAC for services starts with 99). */
export const cleanHsn = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(0, 8);
export const isService = (hsn: string) => hsn.startsWith("99");

/** Unit Quantity Codes accepted by GSTR-1 / e-invoice (common subset). */
export const UQC = ["NOS", "PCS", "KGS", "GMS", "LTR", "MTR", "SQF", "SQM", "BOX", "SET", "PAC", "DOZ", "BAG", "BTL", "ROL", "TON", "UNT", "OTH"] as const;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type TaxLine = {
  item: QuoteItem; taxable: number; rate: number; igst: number; cgst: number; sgst: number; total: number;
};

/**
 * Splits every line into taxable value and tax heads. The invoice discount is spread
 * over lines in proportion to their value (same maths as totals() in quotes.ts).
 * Inter-state (place of supply != seller state) -> IGST, else CGST + SGST halves.
 */
export function taxLines(items: QuoteItem[], discount: number, interState: boolean): TaxLine[] {
  const subtotal = r2(items.reduce((s, i) => s + lineAmount(i), 0));
  const disc = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  return items.map((item) => {
    const base = lineAmount(item);
    const taxable = r2(subtotal > 0 ? base - (disc * base) / subtotal : 0);
    const tax = r2((taxable * item.tax_pct) / 100);
    const half = r2(tax / 2);
    return interState
      ? { item, taxable, rate: item.tax_pct, igst: tax, cgst: 0, sgst: 0, total: r2(taxable + tax) }
      : { item, taxable, rate: item.tax_pct, igst: 0, cgst: half, sgst: r2(tax - half), total: r2(taxable + tax) };
  });
}

export type GstInvoice = {
  id: string; doc_no: string; issue_date: string; status: string; total: number; discount: number; items: QuoteItem[];
  buyer_gstin: string | null; buyer_legal_name: string | null; buyer_address: string | null; buyer_pincode: string | null;
  place_of_supply: string | null; reverse_charge: boolean; customer_name: string | null; customer_location: string | null;
  irn: string | null;
};

export type Seller = { gstin: string; state: string | null; name: string; address: string; pincode: string; phone: string; email: string };

/** Place of supply of an invoice: explicit, else buyer GSTIN's state, else the seller's own state. */
export const posOf = (inv: Pick<GstInvoice, "place_of_supply" | "buyer_gstin">, seller: Pick<Seller, "state">) =>
  inv.place_of_supply || stateOfGstin(inv.buyer_gstin) || seller.state || "";

/** B2CL limit: inter-state invoices to unregistered buyers above ₹1,00,000 (from Aug 2024). */
export const B2CL_LIMIT = 100000;

const ddmmyyyy = (d: string, sep = "-") => `${d.slice(8, 10)}${sep}${d.slice(5, 7)}${sep}${d.slice(0, 4)}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ddMonyyyy = (d: string) => `${d.slice(8, 10)}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;

type RateRow = { rate: number; taxable: number; igst: number; cgst: number; sgst: number };
const byRate = (lines: TaxLine[]) => {
  const m = new Map<number, RateRow>();
  for (const l of lines) {
    const r = m.get(l.rate) ?? { rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    r.taxable = r2(r.taxable + l.taxable); r.igst = r2(r.igst + l.igst); r.cgst = r2(r.cgst + l.cgst); r.sgst = r2(r.sgst + l.sgst);
    m.set(l.rate, r);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
};

export type Gstr1 = {
  period: string;              // YYYY-MM
  seller: Seller;
  b2b: { inv: GstInvoice; pos: string; rows: RateRow[] }[];
  b2cl: { inv: GstInvoice; pos: string; rows: RateRow[] }[];
  b2cs: { pos: string; inter: boolean; rate: number; taxable: number; igst: number; cgst: number; sgst: number }[];
  hsn: { b2b: HsnRow[]; b2c: HsnRow[] };
  docs: { from: string; to: string; total: number; cancelled: number } | null;
  totals: { invoices: number; taxable: number; igst: number; cgst: number; sgst: number; value: number };
  warnings: string[];
};
export type HsnRow = { hsn: string; desc: string; uqc: string; qty: number; rate: number; taxable: number; igst: number; cgst: number; sgst: number; value: number };

/** Builds GSTR-1 tables for one month from that month's invoices (cancelled ones count only in the document summary). */
export function buildGstr1(period: string, seller: Seller, all: GstInvoice[]): Gstr1 {
  const live = all.filter((i) => i.status !== "cancelled");
  const warnings: string[] = [];
  if (!validGstin(seller.gstin)) warnings.push("Your GSTIN is missing or invalid (Settings → Quotes & Payments). GSTR-1 needs it.");
  const out: Gstr1 = { period, seller, b2b: [], b2cl: [], b2cs: [], hsn: { b2b: [], b2c: [] }, docs: null,
    totals: { invoices: live.length, taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0 }, warnings };
  const b2cs = new Map<string, Gstr1["b2cs"][number]>();
  const hsnMaps = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  let noHsn = 0;

  for (const inv of live) {
    const pos = posOf(inv, seller);
    const inter = Boolean(pos && seller.state && pos !== seller.state);
    const lines = taxLines(inv.items, inv.discount, inter);
    const rows = byRate(lines);
    const registered = validGstin(inv.buyer_gstin);
    if (inv.buyer_gstin && !registered) warnings.push(`${inv.doc_no}: buyer GSTIN ${inv.buyer_gstin} looks wrong, treated as B2C.`);
    if (!pos) warnings.push(`${inv.doc_no}: place of supply unknown.`);
    if (registered) out.b2b.push({ inv, pos, rows });
    else if (inter && inv.total > B2CL_LIMIT) out.b2cl.push({ inv, pos, rows });
    else for (const r of rows) {
      const k = `${pos}|${r.rate}`;
      const x = b2cs.get(k) ?? { pos, inter, rate: r.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      x.taxable = r2(x.taxable + r.taxable); x.igst = r2(x.igst + r.igst); x.cgst = r2(x.cgst + r.cgst); x.sgst = r2(x.sgst + r.sgst);
      b2cs.set(k, x);
    }
    const hm = registered ? hsnMaps.b2b : hsnMaps.b2c;
    for (const l of lines) {
      const hsn = cleanHsn(l.item.hsn);
      if (!hsn) noHsn++;
      const uqc = l.item.unit || "NOS";
      const k = `${hsn}|${uqc}|${l.rate}`;
      const h = hm.get(k) ?? { hsn, desc: l.item.name.slice(0, 30), uqc, qty: 0, rate: l.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0 };
      h.qty = r2(h.qty + l.item.qty); h.taxable = r2(h.taxable + l.taxable); h.igst = r2(h.igst + l.igst);
      h.cgst = r2(h.cgst + l.cgst); h.sgst = r2(h.sgst + l.sgst); h.value = r2(h.value + l.total);
      hm.set(k, h);
      out.totals.taxable = r2(out.totals.taxable + l.taxable); out.totals.igst = r2(out.totals.igst + l.igst);
      out.totals.cgst = r2(out.totals.cgst + l.cgst); out.totals.sgst = r2(out.totals.sgst + l.sgst);
    }
    out.totals.value = r2(out.totals.value + inv.total);
  }
  if (noHsn) warnings.push(`${noHsn} invoice line(s) have no HSN/SAC code. Add it in the invoice items; the portal needs it.`);
  out.b2cs = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  out.hsn = { b2b: [...hsnMaps.b2b.values()], b2c: [...hsnMaps.b2c.values()] };
  if (all.length) {
    const nos = [...all].sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));
    out.docs = { from: nos[0].doc_no, to: nos[nos.length - 1].doc_no, total: all.length, cancelled: all.length - live.length };
  }
  return out;
}

// ---------------------------------------------------------------- CSV (GST offline tool templates)
const cell = (v: unknown) => {
  const s = typeof v === "number" ? String(r2(v)) : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export const GSTR1_SECTIONS = ["b2b", "b2cl", "b2cs", "hsn_b2b", "hsn_b2c", "docs"] as const;
export type Gstr1Section = (typeof GSTR1_SECTIONS)[number];

/** One section as CSV with the column headings of the GST offline tool. */
export function gstr1Csv(g: Gstr1, section: Gstr1Section): string {
  switch (section) {
    case "b2b": return csv([
      ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
      ...g.b2b.flatMap(({ inv, pos, rows }) => rows.map((r) => [
        inv.buyer_gstin, inv.buyer_legal_name || inv.customer_name || "", inv.doc_no, ddMonyyyy(inv.issue_date), inv.total, posLabel(pos),
        inv.reverse_charge ? "Y" : "N", "", "Regular B2B", "", r.rate, r.taxable, 0])),
    ]);
    case "b2cl": return csv([
      ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
      ...g.b2cl.flatMap(({ inv, pos, rows }) => rows.map((r) => [inv.doc_no, ddMonyyyy(inv.issue_date), inv.total, posLabel(pos), "", r.rate, r.taxable, 0, ""])),
    ]);
    case "b2cs": return csv([
      ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
      ...g.b2cs.map((r) => ["OE", posLabel(r.pos), "", r.rate, r.taxable, 0, ""]),
    ]);
    case "hsn_b2b":
    case "hsn_b2c": return csv([
      ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
      ...(section === "hsn_b2b" ? g.hsn.b2b : g.hsn.b2c).map((h) => [h.hsn, h.desc, uqcLabel(h.uqc), h.qty, h.value, h.rate, h.taxable, h.igst, h.cgst, h.sgst, 0]),
    ]);
    case "docs": return csv([
      ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
      ...(g.docs ? [["Invoices for outward supply", g.docs.from, g.docs.to, g.docs.total, g.docs.cancelled]] : []),
    ]);
  }
}

const UQC_NAME: Record<string, string> = {
  NOS: "NUMBERS", PCS: "PIECES", KGS: "KILOGRAMS", GMS: "GRAMMES", LTR: "LITRES", MTR: "METERS", SQF: "SQUARE FEET", SQM: "SQUARE METERS",
  BOX: "BOX", SET: "SETS", PAC: "PACKS", DOZ: "DOZENS", BAG: "BAGS", BTL: "BOTTLES", ROL: "ROLLS", TON: "TONNES", UNT: "UNITS", OTH: "OTHERS",
};
const uqcLabel = (u: string) => `${u}-${UQC_NAME[u] ?? "OTHERS"}`;

// ---------------------------------------------------------------- GSTR-1 JSON (portal upload format)
/** GSTR-1 JSON in the GST portal's offline-upload shape. Check it in the offline tool before filing. */
export function gstr1Json(g: Gstr1) {
  const fp = `${g.period.slice(5, 7)}${g.period.slice(0, 4)}`;
  const itms = (rows: RateRow[]) => rows.map((r, i) => ({ num: i + 1, itm_det: { txval: r.taxable, rt: r.rate, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 } }));
  const ctin = new Map<string, unknown[]>();
  for (const { inv, pos, rows } of g.b2b) {
    const list = ctin.get(inv.buyer_gstin!) ?? [];
    list.push({ inum: inv.doc_no, idt: ddmmyyyy(inv.issue_date), val: inv.total, pos, rchrg: inv.reverse_charge ? "Y" : "N", inv_typ: "R", itms: itms(rows) });
    ctin.set(inv.buyer_gstin!, list);
  }
  const b2clPos = new Map<string, unknown[]>();
  for (const { inv, pos, rows } of g.b2cl) {
    const list = b2clPos.get(pos) ?? [];
    list.push({ inum: inv.doc_no, idt: ddmmyyyy(inv.issue_date), val: inv.total, itms: itms(rows).map((x) => ({ num: x.num, itm_det: { txval: x.itm_det.txval, rt: x.itm_det.rt, iamt: x.itm_det.iamt, csamt: 0 } })) });
    b2clPos.set(pos, list);
  }
  const hsn = (rows: HsnRow[]) => rows.map((h, i) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rate, txval: h.taxable, iamt: h.igst, camt: h.cgst, samt: h.sgst, csamt: 0 }));
  return {
    gstin: g.seller.gstin, fp, version: "GST3.2.1", hash: "hash",
    ...(ctin.size ? { b2b: [...ctin.entries()].map(([c, inv]) => ({ ctin: c, inv })) } : {}),
    ...(b2clPos.size ? { b2cl: [...b2clPos.entries()].map(([pos, inv]) => ({ pos, inv })) } : {}),
    ...(g.b2cs.length ? { b2cs: g.b2cs.map((r) => ({ sply_ty: r.inter ? "INTER" : "INTRA", pos: r.pos, typ: "OE", txval: r.taxable, rt: r.rate, iamt: r.igst, camt: r.cgst, samt: r.sgst, csamt: 0 })) } : {}),
    ...(g.hsn.b2b.length || g.hsn.b2c.length ? { hsn: { ...(g.hsn.b2b.length ? { hsn_b2b: hsn(g.hsn.b2b) } : {}), ...(g.hsn.b2c.length ? { hsn_b2c: hsn(g.hsn.b2c) } : {}) } } : {}),
    ...(g.docs ? { doc_issue: { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: g.docs.from, to: g.docs.to, totnum: g.docs.total, cancel: g.docs.cancelled, net_issue: g.docs.total - g.docs.cancelled }] }] } } : {}),
  };
}

// ---------------------------------------------------------------- e-invoice (NIC IRP schema 1.1)
const pinFrom = (s: string | null | undefined) => String(s ?? "").match(/\b[1-9]\d{5}\b/)?.[0] ?? "";

/** Problems that stop an invoice from being registered on the IRP. Empty = ready. */
export function einvoiceProblems(inv: GstInvoice, seller: Seller): string[] {
  const p: string[] = [];
  if (!validGstin(seller.gstin)) p.push("Your GSTIN is missing or invalid.");
  if (!(seller.pincode || pinFrom(seller.address))) p.push("Your business PIN code is missing.");
  if (!validGstin(inv.buyer_gstin)) p.push("Buyer GSTIN is missing or invalid (e-invoice is for B2B).");
  if (!(inv.buyer_pincode || pinFrom(inv.buyer_address))) p.push("Buyer PIN code is missing.");
  if (inv.items.some((i) => cleanHsn(i.hsn).length < 4)) p.push("Every item needs an HSN/SAC code (4+ digits).");
  return p;
}

/** The e-invoice JSON for one invoice, ready to upload through a GSP / the IRP bulk tool. */
export function einvoiceJson(inv: GstInvoice, seller: Seller) {
  const pos = posOf(inv, seller);
  const inter = Boolean(pos && seller.state && pos !== seller.state);
  const lines = taxLines(inv.items, inv.discount, inter);
  const sum = (k: "taxable" | "igst" | "cgst" | "sgst") => r2(lines.reduce((s, l) => s + l[k], 0));
  const buyerState = stateOfGstin(inv.buyer_gstin) ?? pos;
  const addr = (s: string) => (s || "").replace(/\s+/g, " ").trim();
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: inv.reverse_charge ? "Y" : "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: inv.doc_no, Dt: ddmmyyyy(inv.issue_date, "/") },
    SellerDtls: {
      Gstin: seller.gstin, LglNm: seller.name.slice(0, 100), Addr1: addr(seller.address).slice(0, 100) || seller.name.slice(0, 100),
      Loc: (seller.state && STATES[seller.state]) || "", Pin: Number(seller.pincode || pinFrom(seller.address)) || undefined, Stcd: seller.state ?? "",
      ...(seller.phone ? { Ph: seller.phone.replace(/\D/g, "").slice(-12) } : {}), ...(seller.email ? { Em: seller.email } : {}),
    },
    BuyerDtls: {
      Gstin: inv.buyer_gstin, LglNm: (inv.buyer_legal_name || inv.customer_name || "Buyer").slice(0, 100), Pos: pos,
      Addr1: addr(inv.buyer_address || inv.customer_location || "").slice(0, 100) || "NA", Loc: (buyerState && STATES[buyerState]) || "",
      Pin: Number(inv.buyer_pincode || pinFrom(inv.buyer_address)) || undefined, Stcd: buyerState,
    },
    ItemList: lines.map((l, i) => {
      const hsn = cleanHsn(l.item.hsn);
      return {
        SlNo: String(i + 1), PrdDesc: l.item.name.slice(0, 300), IsServc: isService(hsn) ? "Y" : "N", HsnCd: hsn,
        Qty: l.item.qty, Unit: l.item.unit || (isService(hsn) ? "OTH" : "NOS"), UnitPrice: l.item.rate, TotAmt: lineAmount(l.item),
        Discount: r2(lineAmount(l.item) - l.taxable), AssAmt: l.taxable, GstRt: l.rate,
        IgstAmt: l.igst, CgstAmt: l.cgst, SgstAmt: l.sgst, TotItemVal: l.total,
      };
    }),
    ValDtls: (() => {
      const calc = r2(sum("taxable") + sum("cgst") + sum("sgst") + sum("igst"));
      const rnd = r2(inv.total - calc);
      return { AssVal: sum("taxable"), CgstVal: sum("cgst"), SgstVal: sum("sgst"), IgstVal: sum("igst"), ...(rnd ? { RndOffAmt: rnd } : {}), TotInvVal: inv.total };
    })(),
  };
}

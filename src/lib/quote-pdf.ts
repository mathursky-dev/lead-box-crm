import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { KIND_LABEL, lineAmount, type Quote } from "./quotes";
import { posLabel, posOf, validGstin, type Seller } from "./gst";

export type PdfCompany = { business_name: string; address: string; gstin: string; phone: string; email: string; bank_details: string; footer_note: string };
export type PdfCustomer = { name: string | null; phone: string; email: string | null; location: string | null };

// Standard PDF fonts only cover Latin text (WinAnsi). Anything else (₹, Hindi, emoji)
// is swapped so the PDF never fails to render.
const safe = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
const money = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");

const GREEN = rgb(0.03, 0.47, 0.34), NAVY = rgb(0.06, 0.14, 0.27), GREY = rgb(0.42, 0.45, 0.5), LINE = rgb(0.86, 0.88, 0.9), BAND = rgb(0.95, 0.97, 0.96);

/** Splits text into lines that fit `width`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      // A single word longer than the width is cut hard.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let k = w.length;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
        out.push(w.slice(0, k)); w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

export type PdfSignature = { signer_name: string; signature_png: string; doc_hash: string; ip: string | null; signed_at: string; current_hash: string };
export type PdfExtra = { seller?: Seller; signature?: PdfSignature | null };

const istStamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function quotePdf(q: Quote, co: PdfCompany, cu: PdfCustomer, leadNo: number | string, extra: PdfExtra = {}): Promise<Uint8Array> {
  const seller = extra.seller;
  const pos = seller ? posOf({ place_of_supply: q.place_of_supply ?? null, buyer_gstin: q.buyer_gstin ?? null }, seller) : "";
  const inter = Boolean(seller?.state && pos && pos !== seller.state);
  const taxInvoice = q.kind === "invoice" && validGstin(co.gstin);
  const title = taxInvoice ? "TAX INVOICE" : KIND_LABEL[q.kind].toUpperCase();
  const doc = await PDFDocument.create();
  doc.setTitle(`${KIND_LABEL[q.kind]} ${q.doc_no}`);
  doc.setProducer("Lead Box CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const size = o.size ?? 9, f = o.f ?? font, t = safe(s);
    const xx = o.right ? x - f.widthOfTextAtSize(t, size) : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color: o.color ?? NAVY });
  };
  const newPageIfNeeded = (need: number) => {
    if (y - need > M + 30) return false;
    page = doc.addPage([W, H]); y = H - M; return true;
  };

  // Header band
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: GREEN });
  text(co.business_name || "Your business", M, y - 8, { size: 16, f: bold });
  text(title, W - M, y - 8, { size: 18, f: bold, color: GREEN, right: true });
  y -= 24;
  const coLines = [...wrap(co.address, font, 9, 260), [co.phone && `Phone: ${co.phone}`, co.email].filter(Boolean).join("  |  "), co.gstin && `GSTIN: ${co.gstin}`].filter(Boolean) as string[];
  let ly = y;
  for (const l of coLines) { text(l, M, ly, { color: GREY }); ly -= 12; }
  const meta: [string, string][] = [
    [q.kind === "quotation" ? "Quotation no." : "Invoice no.", q.doc_no],
    ["Date", fmtDate(q.issue_date)],
    ...(q.valid_until ? [[q.kind === "quotation" ? "Valid till" : "Due date", fmtDate(q.valid_until)] as [string, string]] : []),
    ["Lead", `LB-${leadNo}`],
    ...(pos && (q.buyer_gstin || q.kind === "invoice") ? [["Place of supply", posLabel(pos)] as [string, string]] : []),
    ...(q.reverse_charge ? [["Reverse charge", "Yes"] as [string, string]] : []),
  ];
  let my = y;
  for (const [k, v] of meta) { text(k, W - M - 150, my, { color: GREY }); text(v, W - M, my, { f: bold, right: true }); my -= 13; }
  y = Math.min(ly, my) - 12;

  // Bill to
  const billLines = [
    [cu.phone, cu.email].filter(Boolean).join("  |  "),
    ...(q.buyer_address || cu.location ? wrap(`${q.buyer_address || cu.location}${q.buyer_pincode ? ` - ${q.buyer_pincode}` : ""}`, font, 9, W - 2 * M - 20).slice(0, 2) : []),
    ...(q.buyer_gstin ? [`GSTIN: ${q.buyer_gstin}`] : []),
  ].filter(Boolean);
  const billH = 34 + billLines.length * 12;
  page.drawRectangle({ x: M, y: y - billH + 4, width: W - 2 * M, height: billH, color: BAND });
  text(q.kind === "quotation" ? "QUOTATION FOR" : "BILL TO", M + 10, y - 12, { size: 8, f: bold, color: GREEN });
  text(q.buyer_legal_name || cu.name || "Customer", M + 10, y - 26, { size: 11, f: bold });
  billLines.forEach((l, i) => text(l, M + 10, y - 39 - i * 12, { color: GREY }));
  y -= billH + 14;

  // Items table
  const cols = { no: M + 6, item: M + 28, qty: W - M - 250, rate: W - M - 175, tax: W - M - 105, amt: W - M - 6 };
  const head = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 20, color: NAVY });
    const c = rgb(1, 1, 1);
    text("#", cols.no, y - 10, { f: bold, color: c }); text("Item / description", cols.item, y - 10, { f: bold, color: c });
    text("Qty", cols.qty, y - 10, { f: bold, color: c, right: true }); text("Rate", cols.rate, y - 10, { f: bold, color: c, right: true });
    text("GST %", cols.tax, y - 10, { f: bold, color: c, right: true }); text("Amount", cols.amt, y - 10, { f: bold, color: c, right: true });
    y -= 22;
  };
  head();
  q.items.forEach((it, i) => {
    const nameL = wrap(it.name, bold, 9, cols.qty - cols.item - 40);
    const descL = [...(it.description ? wrap(it.description, font, 8, cols.qty - cols.item - 40) : []), ...(it.hsn ? [`HSN/SAC: ${it.hsn}${it.unit ? ` · ${it.unit}` : ""}`] : [])];
    const h = nameL.length * 11 + descL.length * 10 + 8;
    if (newPageIfNeeded(h)) head();
    text(String(i + 1), cols.no, y - 10);
    let iy = y - 10;
    for (const l of nameL) { text(l, cols.item, iy, { f: bold }); iy -= 11; }
    for (const l of descL) { text(l, cols.item, iy, { size: 8, color: GREY }); iy -= 10; }
    text(String(it.qty), cols.qty, y - 10, { right: true });
    text(money(it.rate), cols.rate, y - 10, { right: true });
    text(`${it.tax_pct}%`, cols.tax, y - 10, { right: true });
    text(money(lineAmount(it)), cols.amt, y - 10, { right: true });
    y -= h;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: LINE });
  });

  // Totals
  newPageIfNeeded(110);
  y -= 8;
  const tot: [string, string, boolean][] = [
    ["Subtotal", money(q.subtotal), false],
    ...(q.discount > 0 ? [["Discount", `- ${money(q.discount)}`, false] as [string, string, boolean]] : []),
    ...(q.tax_total > 0 && seller?.state && pos
      ? (inter ? [[`IGST`, money(q.tax_total), false] as [string, string, boolean]]
        : [["CGST", money(Math.round(q.tax_total * 50) / 100), false] as [string, string, boolean], ["SGST", money(q.tax_total - Math.round(q.tax_total * 50) / 100), false] as [string, string, boolean]])
      : [["GST", money(q.tax_total), false] as [string, string, boolean]]),
    ["Total (INR)", `Rs. ${money(q.total)}`, true],
    ...(q.amount_paid > 0 ? [["Paid", money(q.amount_paid), false] as [string, string, boolean], ["Balance due", `Rs. ${money(Math.max(0, q.total - q.amount_paid))}`, true] as [string, string, boolean]] : []),
  ];
  for (const [k, v, strong] of tot) {
    if (strong) page.drawRectangle({ x: W - M - 200, y: y - 5, width: 200, height: 18, color: BAND });
    text(k, W - M - 192, y, { f: strong ? bold : font, size: strong ? 10 : 9, color: strong ? NAVY : GREY });
    text(v, cols.amt, y, { f: strong ? bold : font, size: strong ? 10 : 9, right: true });
    y -= 18;
  }
  y -= 8;

  // Notes, terms, bank details
  const block = (title: string, body: string) => {
    if (!body.trim()) return;
    const lines = wrap(body, font, 8.5, W - 2 * M);
    newPageIfNeeded(16 + lines.length * 11);
    text(title, M, y, { f: bold, size: 9, color: GREEN }); y -= 13;
    for (const l of lines) { if (newPageIfNeeded(11)) { /* continue on next page */ } text(l, M, y, { size: 8.5, color: GREY }); y -= 11; }
    y -= 6;
  };
  block("Notes", q.notes);
  block("Terms & conditions", q.terms);
  block("Bank details", co.bank_details);

  // e-invoice: IRN, acknowledgement and the IRP's signed QR code
  if (q.irn && !q.irn_cancelled_at) {
    newPageIfNeeded(120);
    let qrImg = null;
    if (q.irn_signed_qr) {
      try { qrImg = await doc.embedPng(await QRCode.toBuffer(q.irn_signed_qr, { errorCorrectionLevel: "M", margin: 1, width: 300 })); } catch { qrImg = null; }
    }
    text("E-INVOICE", M, y, { f: bold, size: 9, color: GREEN }); y -= 13;
    const irnLines = [`IRN: ${q.irn}`, ...(q.irn_ack_no ? [`Ack No: ${q.irn_ack_no}${q.irn_ack_date ? `   Ack Date: ${istStamp(q.irn_ack_date)}` : ""}`] : [])];
    const top = y;
    for (const l of irnLines) for (const w of wrap(l, font, 8.5, W - 2 * M - 110)) { text(w, M, y, { size: 8.5, color: GREY }); y -= 11; }
    if (qrImg) { page.drawImage(qrImg, { x: W - M - 95, y: top - 90, width: 95, height: 95 }); y = Math.min(y, top - 98); }
    y -= 6;
  }

  // Online acceptance + signature (quotations signed on /q/<token>/sign)
  const sg = extra.signature;
  if (sg) {
    newPageIfNeeded(150);
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.5, color: LINE });
    y -= 8;
    text("ACCEPTED & SIGNED ONLINE", M, y, { f: bold, size: 9, color: GREEN }); y -= 8;
    try {
      const png = await doc.embedPng(Buffer.from(sg.signature_png.split(",")[1] ?? "", "base64"));
      const h = 60, w = Math.min(220, (png.width / png.height) * h);
      page.drawImage(png, { x: M, y: y - h, width: w, height: h });
    } catch { /* unreadable image: keep the text record */ }
    y -= 66;
    const rec = [
      `Signed by: ${sg.signer_name}`,
      `Date & time: ${istStamp(sg.signed_at)} IST${sg.ip ? `   IP: ${sg.ip}` : ""}`,
      `Document fingerprint (SHA-256): ${sg.doc_hash}`,
      ...(sg.doc_hash !== sg.current_hash ? ["Note: this quotation was edited after it was signed."] : []),
    ];
    for (const l of rec) for (const w of wrap(l, font, 8, W - 2 * M)) { text(w, M, y, { size: 8, color: GREY }); y -= 10; }
  }

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const f = safe(co.footer_note);
    if (f) p.drawText(f, { x: M, y: 24, size: 8, font, color: GREY });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 8), y: 24, size: 8, font, color: GREY });
  });
  return doc.save();
}

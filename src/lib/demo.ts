import "server-only";
import { cache } from "react";
import { createAdminClient, createClient, hasServiceRole } from "./supabase/server";

// Shared demo company for prospective buyers (lb_companies.is_demo, seeded and reset daily by lb_demo_reset()).
// Nothing in a demo company may reach WhatsApp, Meta, email or payments: the database refuses tokens and
// never sends demo messages (lb_claim_outbox), and the actions below return DEMO_BLOCKED first.

export const DEMO_BLOCKED = "This is a demo account, so this action is turned off. Everything else works — try leads, inbox, follow-ups and flows.";
export const DEMO_EMAIL_DOMAIN = "@demo.leadboxs.in";

async function lookup(companyId: string) {
  const db = hasServiceRole() ? createAdminClient() : await createClient();
  const { data, error } = await db.from("lb_companies").select("is_demo").eq("id", companyId).maybeSingle();
  return !error && data?.is_demo === true;
}

/** True for a demo company. Never throws: a database without the column reads as "not demo". */
export const isDemoCompany = cache(async (companyId: string | null | undefined): Promise<boolean> =>
  companyId ? lookup(companyId).catch(() => false) : false);

/** DEMO_BLOCKED for a demo company, otherwise null. */
export async function demoBlocked(companyId: string | null | undefined) {
  return (await isDemoCompany(companyId)) ? DEMO_BLOCKED : null;
}

// ------------------------------------------------------------ sample files for the demo Documents library

function pdf(title: string, lines: string[]) {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, "");
  const text = [`BT /F1 22 Tf 60 770 Td (${esc(title)}) Tj ET`, `BT /F1 11 Tf 60 745 Td (Urban Nest Interiors - sample document for the LEAD BOX demo) Tj ET`,
    ...lines.map((l, i) => `BT /F1 13 Tf 60 ${700 - i * 24} Td (${esc(l)}) Tj ET`)].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const SAMPLE_FILES: Record<string, { mime: string; body: () => Buffer }> = {
  "demo-price-list.pdf": { mime: "application/pdf", body: () => pdf("Price List 2026", [
    "Modular Kitchen (straight)          from Rs 1,50,000", "Modular Kitchen (L-shape)           from Rs 1,80,000",
    "Sliding Wardrobe                    Rs 1,450 per sq ft", "Hinged Wardrobe                     Rs 1,250 per sq ft",
    "2BHK Full Home Interiors            from Rs 6,50,000", "3BHK Full Home Interiors            from Rs 9,50,000",
    "Office Interiors                    from Rs 1,200 per sq ft", "", "Prices include design, material, installation and 5-year warranty."]) },
  "demo-kitchen-catalogue.pdf": { mime: "application/pdf", body: () => pdf("Modular Kitchen Catalogue", [
    "Layouts: Straight, L-shape, U-shape, Parallel, Island", "Finishes: Acrylic, PU, Laminate, Glass, Veneer",
    "Countertops: Granite, Quartz, Corian", "Hardware: Soft-close hinges and channels (Hettich / Blum)", "Free 3D design and site measurement"]) },
  "demo-wardrobe-catalogue.pdf": { mime: "application/pdf", body: () => pdf("Wardrobe Catalogue 2026", [
    "Sliding wardrobes with profile handles", "Hinged wardrobes with loft storage", "Walk-in wardrobes", "Finishes: Laminate, Acrylic, Lacquered glass"]) },
  "demo-company-profile.pdf": { mime: "application/pdf", body: () => pdf("Company Profile", [
    "Urban Nest Interiors - home and office interiors since 2015", "1,200+ homes delivered across Jaipur and Delhi NCR",
    "Experience centre: C-Scheme, Jaipur", "45-day delivery promise", "This is a fictional company used for the demo."]) },
  "demo-quotation-format.csv": { mime: "text/csv", body: () => Buffer.from(
    "Item,Size,Material,Qty,Rate,Amount\nModular Kitchen L-shape,10x8 ft,Acrylic,1,210000,210000\nTall unit,2x7 ft,Laminate,1,28000,28000\nChimney,90 cm,-,1,18000,18000\nTotal,,,,,256000\n") },
};

/** Writes the demo company's sample files to storage when they are missing (after a reset). */
export async function ensureDemoFiles(companyId: string) {
  if (!hasServiceRole() || !(await isDemoCompany(companyId))) return;
  const st = createAdminClient().storage.from("lb-docs");
  const { data } = await st.list(companyId, { limit: 100 });
  const have = new Set((data ?? []).map((f) => f.name));
  for (const [name, f] of Object.entries(SAMPLE_FILES)) {
    if (!have.has(name)) await st.upload(`${companyId}/${name}`, f.body(), { contentType: f.mime, upsert: true });
  }
}

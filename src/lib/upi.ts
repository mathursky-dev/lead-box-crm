// UPI deep links (NPCI "upi://pay" intent). Opening one on a phone launches
// GPay / PhonePe / Paytm with the payee and amount filled in; on a desktop the
// same link is shown as a QR code to scan.

export type Upi = { id: string; name: string };

export const UPI_ID_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;
export const UTR_RE = /^[0-9]{12}$/;
export const TOPUP_MIN = 100;
export const TOPUP_MAX = 500000;

export function upiLink(upi: Upi, amount: number, note: string) {
  // encodeURIComponent, not URLSearchParams: some UPI apps show "+" literally and expect a raw "@" in pa.
  const q = { pa: upi.id, pn: upi.name, am: amount.toFixed(2), cu: "INR", tn: note.slice(0, 50) };
  return `upi://pay?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`).join("&")}`;
}

/** Note shown in the payer's UPI app and on the bank statement, so the Super Admin can match it. */
export const topupNote = (company: string) => `Lead Box wallet ${company}`.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 50);

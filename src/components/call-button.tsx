"use client";
import { dialNumber } from "./call-sync";

/** "Call" button: inside the Lead Box app the call is tracked and saved on the lead. */
export function CallButton({ phone, className = "btn-ghost btn-sm" }: { phone: string; className?: string }) {
  return <button type="button" className={className} onClick={() => dialNumber(phone)}>📞 Call</button>;
}

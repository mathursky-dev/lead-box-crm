"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TwoFactorSetup } from "@/app/(auth)/two-factor/forms";

export function EnableTwoFactor() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (!open) return <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>Turn on two-factor</button>;
  return <div className="max-w-xs"><TwoFactorSetup onDone={() => { setOpen(false); router.refresh(); }} /></div>;
}

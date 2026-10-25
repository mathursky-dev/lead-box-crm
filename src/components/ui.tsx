"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export type FormState = { error?: string; ok?: string } | undefined;
type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function Submit({ children, className = "btn-primary", pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}

export function Alert({ state }: { state: FormState }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <div role={state.error ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${state.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>
      {state.error ?? state.ok}
    </div>
  );
}

/** Form bound to a server action with inline error/success feedback. */
export function ActionForm({ action, children, className = "space-y-3", resetOnOk = false, onOk, confirm }: {
  action: Action; children: React.ReactNode; className?: string; resetOnOk?: boolean; onOk?: () => void; confirm?: string;
}) {
  const [state, run] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (resetOnOk) ref.current?.reset();
      onOk?.();
      router.refresh();
    }
  }, [state, resetOnOk, onOk, router]);
  return (
    <form ref={ref} action={run} className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      <Alert state={state} />
    </form>
  );
}

/** Button that runs a server action with optional confirmation, showing errors inline. */
export function ActionButton({ action, children, className = "btn-ghost btn-sm", confirm }: {
  action: () => Promise<FormState>; children: React.ReactNode; className?: string; confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setState(r);
            if (!r?.error) router.refresh();
          });
        }}>
        {pending ? "…" : children}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title}
        className={`max-h-[92vh] w-full overflow-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalButton({ label, title, children, className = "btn-primary", wide }: {
  label: React.ReactNode; title: string; children: (close: () => void) => React.ReactNode; className?: string; wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide={wide}>{children(() => setOpen(false))}</Modal>
    </>
  );
}

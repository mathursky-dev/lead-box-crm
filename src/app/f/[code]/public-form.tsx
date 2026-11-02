"use client";
import { useActionState, useEffect } from "react";
import { submitLeadForm, type SubmitState } from "@/lib/actions/public-form";
import { LeadFormView, fontHref, type FormLook, type ViewField } from "@/components/lead-form-view";
import { onColor } from "@/lib/settings-shared";

export function PublicForm({ code, look, fields }: { code: string; look: FormLook; fields: ViewField[] }) {
  const [state, run, pending] = useActionState<SubmitState, FormData>(submitLeadForm.bind(null, code), undefined);
  useEffect(() => {
    if (state?.done && state.redirect) { const t = setTimeout(() => { window.location.href = state.redirect!; }, 1200); return () => clearTimeout(t); }
  }, [state]);
  return (
    <>
      <link rel="stylesheet" href={fontHref(look.font)} />
      {state?.done ? (
        <div className="overflow-hidden rounded-2xl bg-white text-center shadow-xl">
          <div className="px-6 py-8" style={{ background: look.bg_color, color: onColor(look.bg_color) }}>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white/25 text-3xl">✓</div>
            <h1 className="text-2xl font-bold">{state.thankYou}</h1>
          </div>
          {state.redirect && <p className="p-4 text-sm text-slate-500">Taking you onward…</p>}
        </div>
      ) : (
        <form action={run} noValidate={false}>
          <LeadFormView look={look} fields={fields} pending={pending} error={state?.error} />
        </form>
      )}
    </>
  );
}

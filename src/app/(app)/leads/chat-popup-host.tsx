"use client";
import { useCallback, useEffect, useState } from "react";
import { ChatPopup, type ChatContext } from "@/app/(app)/inbox/inbox";
import { getChatContext } from "@/lib/actions/chat-popup";

// Opens the customer's chat in a right-side popup when something on the page
// fires `lb:open-chat` with { convId } (the ⋮ menu next to a number does).
export function openChatPopup(convId: string) {
  window.dispatchEvent(new CustomEvent("lb:open-chat", { detail: { convId } }));
}

export function ChatPopupHost() {
  const [convId, setConvId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ChatContext | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ convId: string }>).detail.convId;
      setConvId(id);
      if (!ctx) getChatContext().then(setCtx).catch(() => setErr("Couldn't open the chat. Try again."));
    };
    window.addEventListener("lb:open-chat", h);
    return () => window.removeEventListener("lb:open-chat", h);
  }, [ctx]);
  const close = useCallback(() => { setConvId(null); setErr(null); }, []);
  if (!convId) return null;
  if (!ctx) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] items-center justify-center bg-white text-sm text-slate-500 shadow-2xl">
        {err ?? "Loading chat…"} <button type="button" className="btn-ghost btn-sm ml-2" onClick={close}>Close</button>
      </div>
    );
  }
  return <ChatPopup key={convId} convId={convId} ctx={ctx} onClose={close} />;
}

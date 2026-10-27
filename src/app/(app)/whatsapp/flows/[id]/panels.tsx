"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/kit";
import {
  BLOCKS, advance, rid, triggerHit,
  type Choice, type Effect, type FlowGraph, type FlowNode, type FlowTrigger, type NodeData,
} from "@/lib/wa-flow";

export type Lookups = {
  numbers: { id: string; label: string }[];
  tags: string[];
  templates: { name: string; language: string; body: string }[];
  agents: { id: string; full_name: string }[];
};

const VAR_HINT = "Use {{name}}, {{phone}} or any saved answer like {{city}}.";

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/** Settings for the selected block. Every change goes through `set`, which records undo history. */
export function NodeSettings({ node, graph, set, lookups, onDelete, onDuplicate }: {
  node: FlowNode; graph: FlowGraph; set: (d: Partial<NodeData>) => void; lookups: Lookups; onDelete: () => void; onDuplicate: () => void;
}) {
  const d = node.data;
  const vars = Array.from(new Set(["name", "phone", "email", "last_reply", ...graph.nodes.map((n) => n.data.variable).filter(Boolean) as string[]]));
  const txt = (k: keyof NodeData, label: string, o: { rows?: number; hint?: string; max?: number; ph?: string } = {}) => (
    <F label={label} hint={o.hint}>
      {o.rows
        ? <textarea className="input text-sm" rows={o.rows} maxLength={o.max} value={(d[k] as string) ?? ""} placeholder={o.ph} onChange={(e) => set({ [k]: e.target.value })} />
        : <input className="input text-sm" maxLength={o.max} value={(d[k] as string) ?? ""} placeholder={o.ph} onChange={(e) => set({ [k]: e.target.value })} />}
    </F>
  );
  const choices = (max: number, maxLen: number, withDesc: boolean) => {
    const list = d.choices ?? [];
    const upd = (i: number, c: Partial<Choice>) => set({ choices: list.map((x, j) => (j === i ? { ...x, ...c } : x)) });
    return (
      <div>
        <span className="mb-1 block text-xs font-semibold text-slate-600">{node.type === "buttons" ? "Buttons" : "Rows"} ({list.length}/{max})</span>
        <div className="space-y-2">
          {list.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-2">
              <div className="flex gap-1">
                <input className="input py-1 text-sm" value={c.title} maxLength={maxLen} placeholder={`Title (max ${maxLen})`} onChange={(e) => upd(i, { title: e.target.value })} />
                <button type="button" className="btn-ghost btn-sm" disabled={i === 0} title="Move up"
                  onClick={() => { const l = [...list]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; set({ choices: l }); }}>↑</button>
                <button type="button" className="btn-ghost btn-sm text-red-600" title="Remove" onClick={() => set({ choices: list.filter((_, j) => j !== i) })}><Icon name="x" className="h-3 w-3" /></button>
              </div>
              {withDesc && <input className="input mt-1 py-1 text-xs" value={c.description ?? ""} maxLength={72} placeholder="Description (optional)" onChange={(e) => upd(i, { description: e.target.value })} />}
            </div>
          ))}
        </div>
        {list.length < max && (
          <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => set({ choices: [...list, { id: rid(node.type === "buttons" ? "b" : "r"), title: "" }] })}>
            <Icon name="plus" className="h-3 w-3" /> Add {node.type === "buttons" ? "button" : "row"}
          </button>
        )}
        <p className="mt-1 text-[11px] text-slate-400">Wire each one to the next block. “other reply” catches anything else the customer types.</p>
      </div>
    );
  };
  const saveAs = (fallback: string) => (
    <F label="Save the choice as" hint={`Available later as {{${d.variable || fallback}}}.`}>
      <input className="input text-sm" value={d.variable ?? ""} placeholder={fallback} onChange={(e) => set({ variable: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
    </F>
  );
  const tpl = lookups.templates.find((t) => t.name === d.template_name && t.language === d.template_language);
  const paramCount = tpl ? new Set(tpl.body.match(/\{\{\d+\}\}/g) ?? []).size : 0;

  const def = node.type === "start" ? null : BLOCKS[node.type];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ background: def?.color ?? "#16a34a" }}><Icon name={def?.icon ?? "bolt"} className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-navy-900">{def?.label ?? "Start"}</div>
          <div className="text-[11px] text-slate-400">{def?.sub ?? "Where every run begins"} · {node.id}</div>
        </div>
      </div>

      {node.type === "start" && <p className="text-sm text-slate-600">The flow starts here when the trigger at the top matches (keywords, any message or a new contact). Drag from the dot on the right to the first block.</p>}
      {node.type === "message" && txt("text", "Message", { rows: 6, max: 4096, hint: VAR_HINT })}
      {node.type === "media" && <>
        <F label="Type">
          <select className="input text-sm" value={d.media_type ?? "image"} onChange={(e) => set({ media_type: e.target.value as NodeData["media_type"] })}>
            {["image", "video", "audio", "document", "sticker"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </F>
        {txt("url", "File link", { ph: "https://…/brochure.pdf", hint: "A public https link. WhatsApp downloads it when sending." })}
        {d.media_type !== "audio" && d.media_type !== "sticker" && txt("text", "Caption", { rows: 2, max: 1024 })}
        {d.media_type === "document" && txt("filename", "File name", { ph: "Brochure.pdf" })}
      </>}
      {node.type === "template" && <>
        <F label="Template" hint="Approved templates synced from Meta (WhatsApp › Templates).">
          <select className="input text-sm" value={d.template_name ? `${d.template_name}|${d.template_language}` : ""}
            onChange={(e) => { const [name, language] = e.target.value.split("|"); set({ template_name: name, template_language: language, params: [] }); }}>
            <option value="">Choose…</option>
            {lookups.templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}
          </select>
        </F>
        {tpl && <div className="whitespace-pre-wrap rounded-lg bg-[#e7f8ee] p-2 text-xs text-slate-700">{tpl.body}</div>}
        {Array.from({ length: paramCount }, (_, i) => (
          <F key={i} label={`Variable {{${i + 1}}}`}>
            <input className="input text-sm" value={d.params?.[i] ?? ""} placeholder="e.g. {{name}}"
              onChange={(e) => { const p = [...(d.params ?? [])]; p[i] = e.target.value; set({ params: p }); }} />
          </F>
        ))}
      </>}
      {node.type === "location" && <div className="grid grid-cols-2 gap-2">
        {txt("latitude", "Latitude", { ph: "28.6139" })}{txt("longitude", "Longitude", { ph: "77.2090" })}
        <div className="col-span-2">{txt("name", "Place name")}</div><div className="col-span-2">{txt("address", "Address")}</div>
      </div>}
      {node.type === "contact" && <>{txt("contact_name", "Name")}{txt("contact_phone", "Phone", { ph: "+91 98xxxxxx" })}{txt("contact_email", "Email")}{txt("contact_org", "Company")}</>}
      {node.type === "product" && <>
        {txt("catalog_id", "Catalog ID", { hint: "From Meta Commerce Manager." })}
        {txt("product_ids", "Product retailer ID(s)", { hint: "One ID sends a single product; several (comma separated) send a product list." })}
        {txt("header", "Header (lists only)", { max: 60 })}
        {txt("text", "Message", { rows: 2, max: 1024 })}
      </>}
      {node.type === "buttons" && <>{txt("text", "Message", { rows: 3, max: 1024, hint: VAR_HINT })}{txt("footer", "Footer (optional)", { max: 60 })}{choices(3, 20, false)}{saveAs("choice")}</>}
      {node.type === "list" && <>
        {txt("text", "Message", { rows: 3, max: 1024, hint: VAR_HINT })}{txt("button", "Menu button text", { max: 20 })}
        {txt("header", "Header (optional)", { max: 60 })}{txt("footer", "Footer (optional)", { max: 60 })}{choices(10, 24, true)}{saveAs("choice")}
      </>}
      {node.type === "question" && <>
        {txt("text", "Question", { rows: 3, max: 1024, hint: VAR_HINT })}
        <F label="Save the answer as" hint={`Use it later as {{${d.variable || "answer"}}}.`}>
          <input className="input text-sm" value={d.variable ?? ""} onChange={(e) => set({ variable: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
        </F>
        <F label="Expect">
          <select className="input text-sm" value={d.validate ?? "text"} onChange={(e) => set({ validate: e.target.value as NodeData["validate"] })}>
            <option value="text">Any text</option><option value="number">A number</option><option value="email">An email</option><option value="phone">A phone number</option>
          </select>
        </F>
        {txt("error_text", "If the answer is not valid", { rows: 2, ph: "Sorry, that doesn't look right. Please try again." })}
      </>}
      {node.type === "condition" && <>
        <F label="Check">
          <select className="input text-sm" value={d.op ?? "contains"} onChange={(e) => set({ op: e.target.value as NodeData["op"] })}>
            <option value="contains">Variable contains any of</option><option value="equals">Variable equals</option><option value="not_empty">Variable is not empty</option>
            <option value="gt">Number is greater than</option><option value="lt">Number is less than</option><option value="has_tag">Chat has tag</option>
          </select>
        </F>
        {d.op !== "has_tag" && <F label="Variable">
          <select className="input text-sm" value={d.variable ?? ""} onChange={(e) => set({ variable: e.target.value })}>
            {vars.map((v) => <option key={v} value={v}>{`{{${v}}}`}</option>)}
          </select>
        </F>}
        {d.op !== "not_empty" && (d.op === "has_tag"
          ? <F label="Tag"><input className="input text-sm" list="flow-tags" value={d.value ?? ""} onChange={(e) => set({ value: e.target.value })} /></F>
          : txt("value", "Value", { hint: d.op === "contains" ? "Comma separated words, e.g. price, rate, cost" : undefined }))}
      </>}
      {node.type === "tag" && <>
        <F label="Action">
          <select className="input text-sm" value={d.tag_op ?? "add"} onChange={(e) => set({ tag_op: e.target.value as "add" | "remove" })}><option value="add">Add tag</option><option value="remove">Remove tag</option></select>
        </F>
        <F label="Tag" hint="New tags are created automatically."><input className="input text-sm" list="flow-tags" value={d.tag ?? ""} onChange={(e) => set({ tag: e.target.value })} /></F>
      </>}
      {node.type === "field" && <>
        <F label="Contact field">
          <select className="input text-sm" value={d.field ?? "name"} onChange={(e) => set({ field: e.target.value as NodeData["field"] })}><option value="name">Name</option><option value="email">Email</option><option value="location">City / location</option></select>
        </F>
        <F label="From variable">
          <select className="input text-sm" value={d.variable ?? ""} onChange={(e) => set({ variable: e.target.value })}>{vars.map((v) => <option key={v} value={v}>{`{{${v}}}`}</option>)}</select>
        </F>
      </>}
      {node.type === "assign" && <>
        <F label="Assign chat to" hint="The bot stops here and the chat waits in Live chat.">
          <select className="input text-sm" value={d.user_id ?? ""} onChange={(e) => set({ user_id: e.target.value })}>
            <option value="">Keep unassigned (team picks it up)</option>{lookups.agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </F>
        {txt("text", "Message to the customer (optional)", { rows: 2, hint: VAR_HINT })}
      </>}
      {node.type === "webhook" && <>{txt("webhook_url", "URL", { ph: "https://example.com/hook", hint: "We POST { flow, conversation_id, variables } as JSON. Errors never stop the flow." })}</>}
      {node.type === "end" && <p className="text-sm text-slate-600">The flow finishes. The next message from the customer can start a flow again.</p>}

      {node.type !== "start" && (
        <div className="flex gap-2 border-t border-slate-100 pt-3">
          <button type="button" className="btn-ghost btn-sm" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="btn-ghost btn-sm text-red-600" onClick={onDelete}>Delete block</button>
        </div>
      )}
      <datalist id="flow-tags">{lookups.tags.map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  );
}

type Bubble = { me: boolean; text: string; effect?: Effect; note?: string };

/** Phone-style dry run of the flow in the browser. Nothing is sent. */
export function Simulator({ graph, trigger, onNode, onClose }: { graph: FlowGraph; trigger: FlowTrigger; onNode: (id: string | null) => void; onClose: () => void }) {
  const [log, setLog] = useState<Bubble[]>([]);
  const [st, setSt] = useState<{ node: string | null; vars: Record<string, string>; retries: number } | null>(null);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log]);

  const apply = (effects: Effect[], add: Bubble[]) => {
    let t = tags;
    for (const e of effects) {
      if (e.kind === "send") add.push({ me: false, text: e.body, effect: e });
      if (e.kind === "tag") { t = e.op === "add" ? [...new Set([...t, e.tag])] : t.filter((x) => x !== e.tag); add.push({ me: false, text: "", note: `${e.op === "add" ? "Tag added" : "Tag removed"}: ${e.tag}` }); }
      if (e.kind === "field") add.push({ me: false, text: "", note: `Contact ${e.field} = ${e.value}` });
      if (e.kind === "assign") add.push({ me: false, text: "", note: "Handed off to an agent · bot stops" });
      if (e.kind === "webhook") add.push({ me: false, text: "", note: `Webhook POST → ${e.url}` });
    }
    setTags(t);
  };
  const send = (input: string, replyId?: string) => {
    if (!input.trim()) return;
    const add: Bubble[] = [{ me: true, text: input }];
    const vars = { name: "Test User", phone: "+919800000000", email: "", ...(st?.vars ?? {}) };
    if (!st || !st.node) {
      if (!triggerHit({ ...trigger, number_id: null }, input, { numberId: null, tags, firstMessage: true }) && trigger.trigger_type !== "manual")
        add.push({ me: false, text: "", note: "This message would NOT start the flow (trigger didn't match). Running it anyway for the test." });
      const start = graph.nodes.find((n) => n.type === "start")!;
      const r = advance(graph, start.id, { vars, tags });
      apply(r.effects, add);
      if (r.status === "done") add.push({ me: false, text: "", note: "Flow finished" });
      setSt({ node: r.node, vars: r.vars, retries: r.retries });
      onNode(r.node);
    } else {
      const r = advance(graph, st.node, { vars, tags }, { text: input, replyId }, st.retries);
      apply(r.effects, add);
      if (r.status === "done") add.push({ me: false, text: "", note: r.invalid ? "Too many invalid replies · flow ended" : "Flow finished" });
      setSt({ node: r.node, vars: r.vars, retries: r.retries });
      onNode(r.node);
    }
    setLog((l) => [...l, ...add]);
    setText("");
  };
  const reset = () => { setLog([]); setSt(null); setTags([]); onNode(null); };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold text-navy-900">Simulate</div>
        <div className="flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={reset}>Restart</button><button type="button" className="btn-ghost btn-sm" onClick={() => { reset(); onClose(); }}><Icon name="x" className="h-3 w-3" /></button></div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-[#efeae2] p-3">
        {!log.length && <div className="rounded-lg bg-white/80 p-2 text-center text-xs text-slate-500">Type what a customer would send{trigger.trigger_type === "keywords" && trigger.keywords[0] ? `, e.g. “${trigger.keywords[0]}”` : ""}. Nothing is sent to WhatsApp.</div>}
        {log.map((b, i) => b.note ? (
          <div key={i} className="text-center"><span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-500">{b.note}</span></div>
        ) : (
          <div key={i} className={`flex ${b.me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${b.me ? "bg-[#d9fdd3]" : "bg-white"}`}>
              <Preview b={b} live={i === lastAsk(log) && !!st?.node} onPick={send} />
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" />
        <button className="btn-primary btn-sm"><Icon name="send" className="h-3.5 w-3.5" /></button>
      </form>
      {st && Object.keys(st.vars).length > 0 && (
        <div className="mt-2 text-[11px] text-slate-500">Saved: {Object.entries(st.vars).filter(([k]) => !["phone", "email"].includes(k)).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
      )}
    </div>
  );
}

function lastAsk(log: Bubble[]) {
  for (let i = log.length - 1; i >= 0; i--) { const e = log[i].effect; if (e?.kind === "send" && e.type === "interactive") return i; }
  return -1;
}

function Preview({ b, live, onPick }: { b: Bubble; live: boolean; onPick: (text: string, id?: string) => void }) {
  const e = b.effect;
  if (e?.kind === "send" && e.type === "interactive") {
    const p = e.payload as { type: string; body?: { text: string }; action: { buttons?: { reply: { id: string; title: string } }[]; button?: string; sections?: { rows?: { id: string; title: string; description?: string }[] }[] } };
    if (p.type === "button" || p.type === "list") {
      const opts = p.type === "button" ? p.action.buttons!.map((x) => ({ id: x.reply.id, title: x.reply.title })) : p.action.sections!.flatMap((s) => s.rows ?? []);
      return (
        <div>
          <div className="whitespace-pre-wrap">{p.body?.text}</div>
          {p.type === "list" && <div className="mt-1 border-t pt-1 text-center text-xs font-semibold text-sky-600">☰ {p.action.button}</div>}
          <div className="mt-1 space-y-1">
            {opts.map((o) => (
              <button key={o.id} type="button" disabled={!live} onClick={() => onPick(o.title, o.id)}
                className="block w-full rounded-md border border-slate-200 px-2 py-1 text-center text-xs font-semibold text-sky-600 enabled:hover:bg-sky-50 disabled:opacity-60">{o.title}</button>
            ))}
          </div>
        </div>
      );
    }
  }
  if (e?.kind === "send" && e.type === "template") return <div className="text-xs"><b>Template</b> {e.template_name} ({e.template_language}){e.params.length ? ` · ${e.params.join(", ")}` : ""}</div>;
  if (e?.kind === "send" && ["image", "video", "audio", "document", "sticker"].includes(e.type)) return <div className="text-xs">📎 <b>{e.type}</b> {String((e as { payload: { link?: string } }).payload.link ?? "")}<div className="whitespace-pre-wrap text-sm">{e.body.startsWith("[") ? "" : e.body}</div></div>;
  return <div className="whitespace-pre-wrap">{b.text}</div>;
}


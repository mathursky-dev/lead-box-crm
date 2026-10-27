"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { saveFlow, listFlowVersions, flowStats, type FlowMeta } from "@/lib/actions/wa-flows";
import {
  BLOCKS, GROUPS, NODE_W, LAYOUT, inY, isAsk, libraryFlows, nodeHeight, normalizeGraph, portY, portsOf, rid, tidy, validateGraph,
  type FlowEdge, type FlowGraph, type FlowNode, type NodeData, type NodeType,
} from "@/lib/wa-flow";
import { NodeSettings, Simulator, type Lookups } from "./panels";

type Meta = Omit<FlowMeta, "id" | "note"> & { keywordsText: string; tagsText: string };
type View = { x: number; y: number; k: number };
type Drag =
  | { kind: "nodes"; sx: number; sy: number; start: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "box"; sx: number; sy: number; x: number; y: number }
  | { kind: "wire"; from: string; port: string; x: number; y: number };

const SHORTCUTS: [string[], string][] = [
  [["Del"], "delete"], [["Ctrl", "C", "/", "V"], "copy / paste"], [["Ctrl", "D"], "duplicate"], [["Ctrl", "Z", "/", "Y"], "undo / redo"],
  [["Shift"], "+drag select several"], [["Ctrl"], "+wheel zoom"], [["Ctrl", "S"], "save"],
];

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

function preview(n: FlowNode) {
  const d = n.data;
  switch (n.type) {
    case "media": return `${d.media_type ?? "image"} · ${d.url || "no link yet"}`;
    case "template": return d.template_name ? `${d.template_name} (${d.template_language})` : "Choose a template";
    case "location": return d.name || d.address || (d.latitude ? `${d.latitude}, ${d.longitude}` : "Set a location");
    case "contact": return d.contact_name ? `${d.contact_name} · ${d.contact_phone}` : "Add contact details";
    case "product": return d.product_ids ? `Products: ${d.product_ids}` : "Add catalog products";
    case "question": return `${d.text ?? ""} → {{${d.variable || "answer"}}}`;
    case "condition": return d.op === "has_tag" ? `Has tag “${d.value ?? ""}”` : `{{${d.variable}}} ${d.op === "not_empty" ? "is filled" : `${d.op} ${d.value ?? ""}`}`;
    case "tag": return `${d.tag_op === "remove" ? "Remove" : "Add"} tag “${d.tag || "…"}”`;
    case "field": return `Contact ${d.field} ← {{${d.variable}}}`;
    case "assign": return d.text || "Hand off to the team";
    case "webhook": return d.webhook_url || "Set a URL";
    case "end": return "Flow finishes";
    default: return d.text ?? "";
  }
}

export function FlowEditor({ flowId, initialMeta, initialGraph, lookups, canEdit }: {
  flowId: string | null; initialMeta: Omit<FlowMeta, "id" | "note">; initialGraph: FlowGraph; lookups: Lookups; canEdit: boolean;
}) {
  const router = useRouter();
  const [id, setId] = useState(flowId);
  const [meta, setMeta] = useState<Meta>({ ...initialMeta, keywordsText: initialMeta.keywords.join(", "), tagsText: initialMeta.tag_names.join(", ") });
  // Graph plus undo/redo history in one state, so every update stays a pure function.
  const [h, setH] = useState({ g: initialGraph, past: [] as FlowGraph[], future: [] as FlowGraph[], merge: null as string | null });
  const graph = h.g;
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panel, setPanel] = useState<"settings" | "simulate" | "issues" | "versions">("settings");
  const [modal, setModal] = useState<"settings" | "library" | "keys" | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof flowStats>> | null>(null);
  const [simNode, setSimNode] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [paletteQ, setPaletteQ] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [saving, startSave] = useTransition();
  const canvas = useRef<HTMLDivElement>(null);
  const clip = useRef<{ nodes: FlowNode[]; edges: FlowEdge[] } | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  /** Every graph change goes through here so undo/redo sees it. `merge` folds typing into one step. */
  const setGraph = useCallback((fn: (g: FlowGraph) => FlowGraph, merge?: string) => {
    setH((s) => {
      const next = fn(s.g);
      if (next === s.g) return s;
      const push = !merge || merge !== s.merge;
      return { g: next, past: push ? [...s.past.slice(-99), s.g] : s.past, future: [], merge: merge ?? null };
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    setH((s) => (s.past.length ? { g: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [...s.future, s.g], merge: null } : s));
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    setH((s) => (s.future.length ? { g: s.future[s.future.length - 1], future: s.future.slice(0, -1), past: [...s.past, s.g], merge: null } : s));
    setDirty(true);
  }, []);

  const issues = useMemo(() => validateGraph(graph), [graph]);
  const errNodes = useMemo(() => new Set(issues.filter((i) => i.level === "error").map((i) => i.node)), [issues]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const selected = sel.size === 1 ? byId.get([...sel][0]) ?? null : null;

  // ---------------------------------------------------------------- geometry
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);
  const zoomAt = useCallback((k: number, cx?: number, cy?: number) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return;
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    setView((v) => {
      const nk = Math.min(2, Math.max(0.25, k));
      const wx = (px - r.left - v.x) / v.k, wy = (py - r.top - v.y) / v.k;
      return { k: nk, x: px - r.left - wx * nk, y: py - r.top - wy * nk };
    });
  }, []);
  const bounds = useMemo(() => {
    if (!graph.nodes.length) return { x: 0, y: 0, w: 600, h: 400 };
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const x2 = Math.max(...graph.nodes.map((n) => n.x + NODE_W)), y2 = Math.max(...graph.nodes.map((n) => n.y + nodeHeight(n)));
    return { x: Math.min(...xs), y: Math.min(...ys), w: x2 - Math.min(...xs), h: y2 - Math.min(...ys) };
  }, [graph.nodes]);
  const fit = useCallback(() => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.min(1, Math.max(0.25, Math.min((r.width - 80) / bounds.w, (r.height - 80) / bounds.h)));
    if (k >= 0.6) { setView({ k, x: (r.width - bounds.w * k) / 2 - bounds.x * k, y: (r.height - bounds.h * k) / 2 - bounds.y * k }); return; }
    // Too big to read when fitted: start readable at the left edge, around Start.
    const k2 = 0.7, st = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0];
    setView({ k: k2, x: 40 - bounds.x * k2, y: r.height / 2 - (st ? st.y + 22 : bounds.y) * k2 });
  }, [bounds, graph.nodes]);
  const centerOn = useCallback((n: FlowNode) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return;
    setView((v) => ({ ...v, x: r.width / 2 - (n.x + NODE_W / 2) * v.k, y: r.height / 2 - (n.y + nodeHeight(n) / 2) * v.k }));
  }, []);
  useEffect(() => { fit(); /* first paint only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- graph edits
  const addNode = useCallback((type: Exclude<NodeType, "start">, at?: { x: number; y: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    const pos = at ?? toWorld(r.left + r.width / 2 - 130, r.top + r.height / 2 - 40);
    const n: FlowNode = { id: rid(), type, x: Math.round(pos.x), y: Math.round(pos.y), data: BLOCKS[type].data() };
    setGraph((g) => {
      const edges = [...g.edges];
      // Click-to-add continues from the selected block's free output.
      const src = !at && sel.size === 1 ? g.nodes.find((x) => sel.has(x.id)) : null;
      if (src) {
        const free = portsOf(src).find((p) => p.id !== "other" && !edges.some((e) => e.from === src.id && e.port === p.id));
        if (free) { edges.push({ id: rid("e"), from: src.id, port: free.id, to: n.id }); n.x = src.x + 340; n.y = src.y; }
      }
      return { ...g, nodes: [...g.nodes, n], edges };
    });
    setSel(new Set([n.id]));
    setSelEdge(null);
  }, [setGraph, sel, toWorld]);

  const removeSelected = useCallback(() => {
    if (selEdge) { setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== selEdge) })); setSelEdge(null); return; }
    const ids = new Set([...sel].filter((x) => byId.get(x)?.type !== "start"));
    if (!ids.size) return;
    setGraph((g) => ({ ...g, nodes: g.nodes.filter((n) => !ids.has(n.id)), edges: g.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to)) }));
    setSel(new Set());
  }, [sel, selEdge, byId, setGraph]);

  const paste = useCallback((data: { nodes: FlowNode[]; edges: FlowEdge[] } | null, offset = 40) => {
    if (!data?.nodes.length) return;
    const map = new Map<string, string>();
    const nodes = data.nodes.filter((n) => n.type !== "start").map((n) => {
      const nid = rid(); map.set(n.id, nid);
      // Choice ids must stay unique per block; remap them and the wires that use them.
      const choices = n.data.choices?.map((c) => ({ ...c, oldId: c.id, id: rid("c") }));
      return { ...n, id: nid, x: n.x + offset, y: n.y + offset, data: { ...n.data, ...(choices ? { choices: choices.map((c) => ({ id: c.id, title: c.title, description: c.description })) } : {}) }, _choices: choices };
    });
    const portMap = new Map<string, string>();
    nodes.forEach((n) => n._choices?.forEach((c) => portMap.set(`${n.id}:${c.oldId}`, c.id)));
    const edges = data.edges.filter((e) => map.has(e.from) && map.has(e.to)).map((e) => {
      const from = map.get(e.from)!;
      return { id: rid("e"), from, to: map.get(e.to)!, port: portMap.get(`${from}:${e.port}`) ?? e.port };
    });
    const clean: FlowNode[] = nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, data: n.data }));
    setGraph((g) => ({ ...g, nodes: [...g.nodes, ...clean], edges: [...g.edges, ...edges] }));
    setSel(new Set(clean.map((n) => n.id)));
  }, [setGraph]);
  const copySel = useCallback(() => {
    const nodes = graph.nodes.filter((n) => sel.has(n.id) && n.type !== "start");
    clip.current = { nodes, edges: graph.edges.filter((e) => sel.has(e.from) && sel.has(e.to)) };
  }, [graph, sel]);

  const setData = useCallback((nid: string, d: Partial<NodeData>) => {
    setGraph((g) => {
      let edges = g.edges;
      if (d.choices) { // drop wires of removed choices
        const keep = new Set([...d.choices.map((c) => c.id), "other"]);
        edges = g.edges.filter((e) => e.from !== nid || keep.has(e.port));
      }
      return { ...g, edges, nodes: g.nodes.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...d } } : n)) };
    }, `data:${nid}:${Object.keys(d).join()}`);
  }, [setGraph]);

  // ---------------------------------------------------------------- save
  const metaOut = useCallback((): FlowMeta => ({
    id, name: meta.name, description: meta.description, trigger_type: meta.trigger_type, match_type: meta.match_type, number_id: meta.number_id, priority: meta.priority, is_active: meta.is_active,
    keywords: meta.keywordsText.split(/[,\n]/).map((k) => k.trim()).filter(Boolean), tag_names: meta.tagsText.split(",").map((k) => k.trim()).filter(Boolean),
  }), [id, meta]);
  const save = useCallback((note?: string) => {
    if (!canEdit) return;
    startSave(async () => {
      const r = await saveFlow({ ...metaOut(), note }, graph);
      setMsg(r);
      if (r.ok) {
        setDirty(false);
        if (!id && r.id) { setId(r.id); router.replace(`/whatsapp/flows/${r.id}`); }
      }
    });
  }, [canEdit, metaOut, graph, id, router]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => { if (msg?.ok) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); }
      else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "c") copySel();
      else if (mod && e.key.toLowerCase() === "v") paste(clip.current);
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); copySel(); paste(clip.current); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSel(new Set(graph.nodes.map((n) => n.id))); }
      else if (e.key === "Escape") { setSel(new Set()); setSelEdge(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save, removeSelected, undo, redo, copySel, paste, graph.nodes]);

  // ---------------------------------------------------------------- pointer
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [view.k, zoomAt]);

  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-node],[data-ui]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelEdge(null);
    if (e.shiftKey) { const w = toWorld(e.clientX, e.clientY); setDrag({ kind: "box", sx: w.x, sy: w.y, x: w.x, y: w.y }); }
    else setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };
  const onNodeDown = (e: React.PointerEvent, n: FlowNode) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-port]")) return;
    e.stopPropagation();
    canvas.current!.setPointerCapture(e.pointerId);
    setSelEdge(null);
    let next = sel;
    if (e.shiftKey) { next = new Set(sel); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); }
    else if (!sel.has(n.id)) next = new Set([n.id]);
    setSel(next);
    if (!canEdit) return;
    setDrag({ kind: "nodes", sx: e.clientX, sy: e.clientY, moved: false, start: new Map(graph.nodes.filter((x) => next.has(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])) });
  };
  const onPortDown = (e: React.PointerEvent, n: FlowNode, port: string) => {
    if (!canEdit) return;
    e.stopPropagation();
    canvas.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    setDrag({ kind: "wire", from: n.id, port, x: w.x, y: w.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) setDrag({ ...drag, moved: true });
    } else if (drag.kind === "nodes") {
      const dx = (e.clientX - drag.sx) / view.k, dy = (e.clientY - drag.sy) / view.k;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      if (!drag.moved) { setH((s) => ({ ...s, past: [...s.past.slice(-99), s.g], future: [], merge: null })); setDrag({ ...drag, moved: true }); setDirty(true); }
      setH((s) => ({ ...s, g: { ...s.g, nodes: s.g.nodes.map((n) => { const p = drag.start.get(n.id); return p ? { ...n, x: Math.round(p.x + dx), y: Math.round(p.y + dy) } : n; }) } }));
    } else {
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ ...drag, x: w.x, y: w.y });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan" && !drag.moved) setSel(new Set());
    if (drag.kind === "box") {
      const [x1, x2] = [Math.min(drag.sx, drag.x), Math.max(drag.sx, drag.x)], [y1, y2] = [Math.min(drag.sy, drag.y), Math.max(drag.sy, drag.y)];
      setSel(new Set(graph.nodes.filter((n) => n.x < x2 && n.x + NODE_W > x1 && n.y < y2 && n.y + nodeHeight(n) > y1).map((n) => n.id)));
    }
    if (drag.kind === "wire") {
      const hit = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.("[data-node]") as HTMLElement | null).find(Boolean);
      const to = hit?.dataset.node;
      if (to && to !== drag.from && byId.get(to)?.type !== "start") {
        setGraph((g) => ({ ...g, edges: [...g.edges.filter((x) => !(x.from === drag.from && x.port === drag.port)), { id: rid("e"), from: drag.from, port: drag.port, to }] }));
      }
    }
    setDrag(null);
  };
  const onDrop = (e: React.DragEvent) => {
    const t = e.dataTransfer.getData("application/x-flow-block") as Exclude<NodeType, "start">;
    if (!t || !(t in BLOCKS) || !canEdit) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    addNode(t, { x: w.x - 40, y: w.y - 18 });
  };

  // ---------------------------------------------------------------- toolbar actions
  const exportJson = () => {
    const m = metaOut();
    const blob = new Blob([JSON.stringify({ lead_box_flow: 1, ...m, id: undefined, is_active: false, graph }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(meta.name || "flow").replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const g = normalizeGraph(j.graph ?? j);
      setGraph(() => g);
      if (j.name && !meta.name) setMeta((m) => ({ ...m, name: String(j.name).slice(0, 120) }));
      if (Array.isArray(j.keywords) && !meta.keywordsText) setMeta((m) => ({ ...m, keywordsText: j.keywords.join(", ") }));
      setMsg({ ok: `Imported ${g.nodes.length} blocks. Save to keep them.` });
      setTimeout(fit, 0);
    } catch { setMsg({ error: "That file is not a flow export (JSON)." }); }
  };
  const toggleStats = async () => {
    if (stats) { setStats(null); return; }
    if (!id) { setMsg({ error: "Save the flow first; stats appear once customers run it." }); return; }
    const s = await flowStats(id);
    if (!s) setMsg({ error: "Could not load stats." }); else setStats(s);
  };

  const trigger = { trigger_type: meta.trigger_type, keywords: meta.keywordsText.split(",").map((k) => k.trim()).filter(Boolean), match_type: meta.match_type, number_id: null, tag_names: meta.tagsText.split(",").map((k) => k.trim()).filter(Boolean) };
  const errors = issues.filter((i) => i.level === "error").length;
  const findHits = find.trim() ? graph.nodes.filter((n) => `${n.id} ${n.type} ${BLOCKS[n.type as Exclude<NodeType, "start">]?.label ?? "start"} ${preview(n)}`.toLowerCase().includes(find.toLowerCase())).slice(0, 8) : [];

  // ---------------------------------------------------------------- render
  const tb = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className="space-y-3">
      {/* Flow name and trigger */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input className="input w-48 flex-1" placeholder="Flow name" value={meta.name} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} />
        <input className="input w-48 flex-1" placeholder="Description (optional)" value={meta.description ?? ""} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, description: e.target.value }); setDirty(true); }} />
        <select className="input w-auto" value={meta.trigger_type} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, trigger_type: e.target.value as Meta["trigger_type"] }); setDirty(true); }} title="What starts the flow">
          <option value="keywords">Trigger: keywords</option><option value="any">Trigger: any message</option><option value="new_contact">Trigger: new contact</option><option value="manual">Trigger: off (manual)</option>
        </select>
        {meta.trigger_type === "keywords" && <>
          <input className="input w-56 flex-1" placeholder="keywords: menu, help, start" value={meta.keywordsText} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, keywordsText: e.target.value }); setDirty(true); }} />
          <select className="input w-auto" value={meta.match_type} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, match_type: e.target.value as Meta["match_type"] }); setDirty(true); }}>
            <option value="contains">contains</option><option value="exact">exact</option><option value="starts">starts with</option>
          </select>
        </>}
        <select className="input w-auto" value={meta.number_id ?? ""} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, number_id: e.target.value || null }); setDirty(true); }}>
          <option value="">All numbers</option>{lookups.numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500" title="Order: when several flows match, the lowest number wins">
          <Icon name="sliders" className="h-3.5 w-3.5" />
          <input className="input w-16" type="number" min={1} max={9999} value={meta.priority} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, priority: Number(e.target.value) || 10 }); setDirty(true); }} />
        </label>
        <input className="input w-56" list="flow-tags-top" placeholder="only contacts tagged…" value={meta.tagsText} disabled={!canEdit} onChange={(e) => { setMeta({ ...meta, tagsText: e.target.value }); setDirty(true); }} />
        <datalist id="flow-tags-top">{lookups.tags.map((t) => <option key={t} value={t} />)}</datalist>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-navy-900">
          <button type="button" role="switch" aria-checked={meta.is_active} disabled={!canEdit} onClick={() => { setMeta({ ...meta, is_active: !meta.is_active }); setDirty(true); }}
            className={`relative h-6 w-11 rounded-full transition ${meta.is_active ? "bg-brand-500" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${meta.is_active ? "left-5" : "left-0.5"}`} />
          </button>
          Active
        </label>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex"><button className={`${tb} rounded-r-none`} title="Undo (Ctrl+Z)" onClick={undo} disabled={!h.past.length}>↶</button><button className={`${tb} rounded-l-none border-l-0`} title="Redo (Ctrl+Y)" onClick={redo} disabled={!h.future.length}>↷</button></div>
        <button className={tb} onClick={() => setPanel(panel === "issues" ? "settings" : "issues")}>
          <Icon name="check" className="h-4 w-4" /> Validate {issues.length > 0 && <span className={`rounded-full px-1.5 text-[10px] text-white ${errors ? "bg-red-500" : "bg-amber-500"}`}>{issues.length}</span>}
        </button>
        <button className={tb} title="Tidy layout" disabled={!canEdit} onClick={() => { setGraph((g) => tidy(g)); setTimeout(fit, 0); }}><Icon name="sparkle" className="h-4 w-4" /><span className="hidden 2xl:inline">Tidy</span></button>
        <div className="flex">
          <button className={`${tb} rounded-r-none`} onClick={() => zoomAt(view.k / 1.2)} title="Zoom out">−</button>
          <span className={`${tb} w-14 justify-center rounded-none border-x-0`}>{Math.round(view.k * 100)}%</span>
          <button className={`${tb} rounded-none`} onClick={() => zoomAt(view.k * 1.2)} title="Zoom in">+</button>
          <button className={`${tb} rounded-l-none border-l-0`} onClick={fit} title="Fit to screen">⛶</button>
        </div>
        <button className={tb} title="Flow settings" onClick={() => setModal("settings")}><Icon name="sliders" className="h-4 w-4" /><span className="hidden 2xl:inline">Settings</span></button>
        <button className={`${tb} ${panel === "simulate" ? "border-brand-500 text-brand-700" : ""}`} onClick={() => setPanel(panel === "simulate" ? "settings" : "simulate")}><Icon name="chat" className="h-4 w-4" /> Simulate</button>
        <span className="flex-1" />
        <button className={tb} title="Library" disabled={!canEdit} onClick={() => setModal("library")}><Icon name="book" className="h-4 w-4" /><span className="hidden 2xl:inline">Library</span></button>
        <button className={tb} title="Import JSON" disabled={!canEdit} onClick={() => fileIn.current?.click()}><Icon name="upload" className="h-4 w-4" /><span className="hidden 2xl:inline">Import</span></button>
        <input ref={fileIn} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
        <button className={tb} title="Export JSON" onClick={exportJson}><Icon name="download" className="h-4 w-4" /><span className="hidden 2xl:inline">Export</span></button>
        <button className={`${tb} ${panel === "versions" ? "border-brand-500 text-brand-700" : ""}`} title="Versions" disabled={!id} onClick={() => setPanel(panel === "versions" ? "settings" : "versions")}><Icon name="clock" className="h-4 w-4" /><span className="hidden 2xl:inline">Versions</span></button>
        <button className={`${tb} ${stats ? "border-brand-500 text-brand-700" : ""}`} title="Stats" onClick={toggleStats}><Icon name="chart" className="h-4 w-4" /><span className="hidden 2xl:inline">Stats</span></button>
        <button className={tb} title="Keyboard shortcuts" onClick={() => setModal("keys")}>⌨</button>
        {canEdit && (
          <button className="btn-primary h-9" disabled={saving} onClick={() => save()}>
            <Icon name="check" className="h-4 w-4" /> {saving ? "Saving…" : "Save flow"}{dirty && !saving && <span className="ml-1 h-2 w-2 rounded-full bg-amber-300" title="Unsaved changes" />}
          </button>
        )}
      </div>
      {msg && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.error ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>{msg.error ?? msg.ok}</div>}
      {stats && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[["Started", stats.started], ["Completed", stats.completed], ["Handed off", stats.handoff], ["Waiting now", stats.waiting], ["Invalid replies", stats.invalid]].map(([l, v]) => (
            <span key={l as string} className="rounded-full border border-slate-200 bg-white px-3 py-1"><b className="text-navy-900">{v}</b> {l}</span>
          ))}
          <span className="px-1 py-1 text-slate-400">last 30 days · numbers on blocks = times reached</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)_270px] 2xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Palette */}
        <div className="card flex max-h-64 flex-col p-2 lg:max-h-[72vh]">
          <div className="relative mb-2">
            <Icon name="search" className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8 text-sm" placeholder="Search blocks…" value={paletteQ} onChange={(e) => setPaletteQ(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {GROUPS.map((grp) => {
              const items = (Object.entries(BLOCKS) as [Exclude<NodeType, "start">, (typeof BLOCKS)[keyof typeof BLOCKS]][])
                .filter(([, b]) => b.group === grp && `${b.label} ${b.sub}`.toLowerCase().includes(paletteQ.toLowerCase()));
              if (!items.length) return null;
              return (
                <div key={grp}>
                  <div className="px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-navy-900">{grp}</div>
                  {items.map(([t, b]) => (
                    <button key={t} type="button" draggable={canEdit} disabled={!canEdit}
                      onDragStart={(e) => { e.dataTransfer.setData("application/x-flow-block", t); e.dataTransfer.effectAllowed = "copy"; }}
                      onClick={() => addNode(t)}
                      className="mb-1.5 flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left hover:border-brand-400 hover:shadow-sm disabled:opacity-60">
                      <span className="mt-0.5" style={{ color: b.color }}><Icon name={b.icon} className="h-4 w-4" /></span>
                      <span><span className="block text-sm font-semibold text-navy-900">{b.label}</span><span className="block text-[11px] leading-tight text-slate-500">{b.sub}</span></span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Canvas */}
        <div ref={canvas} onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
          onDragOver={(e) => { if (canEdit) e.preventDefault(); }} onDrop={onDrop}
          className={`relative h-[72vh] min-h-[480px] touch-none select-none overflow-hidden rounded-xl border-2 border-indigo-200 bg-white ${drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: `${20 * view.k}px ${20 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              {graph.edges.map((e) => {
                const a = byId.get(e.from), b = byId.get(e.to);
                if (!a || !b) return null;
                const d = curve(a.x + NODE_W, a.y + portY(a, e.port), b.x, b.y + inY(b));
                const on = selEdge === e.id;
                return (
                  <g key={e.id} className="pointer-events-auto cursor-pointer" onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(e.id); setSel(new Set()); }}>
                    <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                    <path d={d} stroke={on ? "#dc2626" : e.port === "other" ? "#94a3b8" : "#64748b"} strokeWidth={on ? 3 : 2} fill="none" strokeDasharray={e.port === "other" ? "5 4" : undefined} />
                  </g>
                );
              })}
              {drag?.kind === "wire" && (() => { const a = byId.get(drag.from)!; return <path d={curve(a.x + NODE_W, a.y + portY(a, drag.port), drag.x, drag.y)} stroke="#16a34a" strokeWidth={2} fill="none" strokeDasharray="6 4" />; })()}
            </svg>
            {graph.nodes.map((n) => (
              <NodeView key={n.id} n={n} selected={sel.has(n.id)} error={errNodes.has(n.id)} sim={simNode === n.id} count={stats?.nodes[n.id]}
                onDown={(e) => onNodeDown(e, n)} onPort={(e, p) => onPortDown(e, n, p)} wired={(p) => graph.edges.some((e) => e.from === n.id && e.port === p)} />
            ))}
            {drag?.kind === "box" && <div className="absolute border border-indigo-400 bg-indigo-100/30" style={{ left: Math.min(drag.sx, drag.x), top: Math.min(drag.sy, drag.y), width: Math.abs(drag.x - drag.sx), height: Math.abs(drag.y - drag.sy) }} />}
          </div>

          {/* Find a block */}
          <div data-ui className="absolute left-3 top-3 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <div className="relative"><Icon name="search" className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
              <input className="w-full rounded-lg border border-slate-200 py-1 pl-7 pr-2 text-sm outline-none focus:border-brand-500" placeholder="Find a block…" value={find} onChange={(e) => setFind(e.target.value)} /></div>
            {findHits.length > 0 && <div className="mt-1 max-h-48 overflow-y-auto">{findHits.map((n) => (
              <button key={n.id} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-slate-100" onClick={() => { setSel(new Set([n.id])); centerOn(n); setFind(""); }}>
                <b>{n.type === "start" ? "Start" : BLOCKS[n.type].label}</b> · {preview(n) || n.id}
              </button>
            ))}</div>}
          </div>

          <MiniMap graph={graph} view={view} canvas={canvas} bounds={bounds} onJump={(x, y) => { const r = canvas.current!.getBoundingClientRect(); setView((v) => ({ ...v, x: r.width / 2 - x * v.k, y: r.height / 2 - y * v.k })); }} />
        </div>

        {/* Right panel */}
        <div className="card max-h-[72vh] overflow-y-auto p-4">
          {panel === "simulate" ? (
            <div className="h-[calc(72vh-2rem)]"><Simulator graph={graph} trigger={trigger} onNode={setSimNode} onClose={() => { setPanel("settings"); setSimNode(null); }} /></div>
          ) : panel === "issues" ? (
            <div>
              <div className="mb-2 flex items-center justify-between"><div className="font-semibold text-navy-900">Validation</div><button className="btn-ghost btn-sm" onClick={() => setPanel("settings")}><Icon name="x" className="h-3 w-3" /></button></div>
              {!issues.length ? <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">✓ All good. The flow is ready to turn on.</div> : (
                <ul className="space-y-1.5">{issues.map((i, k) => (
                  <li key={k}><button type="button" className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs ${i.level === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                    onClick={() => { const n = i.node && byId.get(i.node); if (n) { setSel(new Set([n.id])); centerOn(n); setPanel("settings"); } }}>{i.level === "error" ? "✕" : "!"} {i.text}</button></li>
                ))}</ul>
              )}
              <p className="mt-3 text-[11px] text-slate-400">Red items must be fixed before the flow can be Active. Yellow ones are hints.</p>
            </div>
          ) : panel === "versions" && id ? (
            <Versions flowId={id} onClose={() => setPanel("settings")} onRestore={(s) => {
              setGraph(() => normalizeGraph(s.graph));
              setMeta((m) => ({ ...m, ...(s as Partial<Meta>), keywordsText: ((s.keywords as string[]) ?? []).join(", "), tagsText: ((s.tag_names as string[]) ?? []).join(", ") }));
              setMsg({ ok: "Version loaded into the editor. Save to make it live." });
              setTimeout(fit, 0);
            }} />
          ) : selEdge ? (
            <div className="space-y-3">
              <div className="font-semibold text-navy-900">Connection</div>
              <button className="btn-ghost btn-sm text-red-600" disabled={!canEdit} onClick={removeSelected}>Delete connection</button>
              <p className="text-xs text-slate-500">Or press Del. Drag from an output dot to another block to rewire.</p>
            </div>
          ) : selected && canEdit ? (
            <NodeSettings node={selected} graph={graph} lookups={lookups} set={(d) => setData(selected.id, d)} onDelete={removeSelected} onDuplicate={() => { copySel(); paste(clip.current); }} />
          ) : sel.size > 1 ? (
            <div className="space-y-3">
              <div className="font-semibold text-navy-900">{sel.size} blocks selected</div>
              <div className="flex gap-2"><button className="btn-ghost btn-sm" disabled={!canEdit} onClick={() => { copySel(); paste(clip.current); }}>Duplicate</button><button className="btn-ghost btn-sm text-red-600" disabled={!canEdit} onClick={removeSelected}>Delete</button></div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col items-center py-6 text-center">
                <span className="text-slate-300"><Icon name="target" className="h-10 w-10" /></span>
                <div className="mt-2 font-semibold text-navy-900">Select a block</div>
                <p className="mt-1 text-sm text-slate-500">Its settings appear here. Drag blocks from the palette, connect ports by dragging.</p>
              </div>
              <Shortcuts />
            </div>
          )}
        </div>
      </div>

      {modal && (
        <div data-ui className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" onClick={() => setModal(null)}>
          <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">{modal === "settings" ? "Flow settings" : modal === "library" ? "Flow library" : "Keyboard shortcuts"}</h3>
              <button className="btn-ghost btn-sm" onClick={() => setModal(null)}><Icon name="x" className="h-3 w-3" /></button>
            </div>
            {modal === "keys" && <Shortcuts />}
            {modal === "settings" && (
              <div className="space-y-3 text-sm">
                {([["timeout_hours", "Forget an unanswered flow after (hours)", "number"], ["max_retries", "Wrong replies allowed before the flow ends", "number"],
                  ["invalid_text", "Message when a reply matches no button", "text"], ["restart_keyword", "Restart keyword (starts this flow again)", "text"], ["stop_keyword", "Stop keyword (customer leaves the bot)", "text"]] as const).map(([k, l, t]) => (
                  <label key={k} className="block"><span className="label">{l}</span>
                    <input className="input" type={t} min={t === "number" ? (k === "timeout_hours" ? 1 : 0) : undefined} max={t === "number" ? (k === "timeout_hours" ? 24 : 5) : undefined} disabled={!canEdit}
                      value={graph.settings[k] as string | number} onChange={(e) => setGraph((g) => ({ ...g, settings: { ...g.settings, [k]: t === "number" ? Math.max(0, Math.min(k === "timeout_hours" ? 24 : 5, Number(e.target.value) || 0)) : e.target.value } }), `settings:${k}`)} />
                  </label>
                ))}
                <p className="text-xs text-slate-500">WhatsApp only allows free-form replies within 24 hours of the customer&apos;s last message, so flows time out after at most 24 hours. Opt-out (STOP) keywords from WhatsApp › Settings always win over flows, and flows pause on chats assigned to an agent when that preference is on.</p>
              </div>
            )}
            {modal === "library" && (
              <div className="space-y-2">
                {libraryFlows().map((f) => (
                  <div key={f.name} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                    <div><div className="font-semibold text-navy-900">{f.name}</div><p className="text-xs text-slate-500">{f.description}</p><p className="mt-1 text-[11px] text-slate-400">Keywords: {f.keywords}</p></div>
                    <button className="btn-primary btn-sm shrink-0" onClick={() => {
                      if (graph.nodes.length > 2 && !window.confirm("Replace the blocks on the canvas with this template?")) return;
                      setGraph(() => f.build());
                      setMeta((m) => ({ ...m, name: m.name || f.name, keywordsText: m.keywordsText || f.keywords, trigger_type: "keywords" }));
                      setModal(null); setSel(new Set()); setTimeout(fit, 0);
                    }}>Use</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Shortcuts() {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-navy-900">Shortcuts</div>
      <ul className="space-y-1.5 text-sm text-slate-600">
        {SHORTCUTS.map(([keys, label]) => (
          <li key={label} className="flex items-center gap-1">
            {keys.map((k, i) => k === "/" ? <span key={i}>/</span> : <kbd key={i} className="rounded border border-slate-200 bg-slate-50 px-1.5 text-xs">{k}</kbd>)}
            <span className="ml-1">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodeView({ n, selected, error, sim, count, onDown, onPort, wired }: {
  n: FlowNode; selected: boolean; error: boolean; sim: boolean; count?: number;
  onDown: (e: React.PointerEvent) => void; onPort: (e: React.PointerEvent, port: string) => void; wired: (port: string) => boolean;
}) {
  const ring = sim ? "ring-4 ring-amber-300" : selected ? "ring-2 ring-indigo-500" : error ? "ring-2 ring-red-400" : "";
  const badge = count !== undefined && <span className="absolute -top-2.5 right-2 rounded-full bg-navy-900 px-2 text-[10px] font-bold text-white">{count}</span>;
  const dot = (p: string, top: number, dashed = false) => (
    <span data-port onPointerDown={(e) => onPort(e, p)} title="Drag to connect"
      className={`absolute -right-[7px] h-3.5 w-3.5 cursor-crosshair rounded-full border-2 bg-white hover:scale-125 ${dashed ? "border-dashed border-slate-400" : wired(p) ? "border-brand-600 bg-brand-100" : "border-brand-600"}`}
      style={{ top: top - 7 }} />
  );
  if (n.type === "start") {
    return (
      <div data-node={n.id} onPointerDown={onDown} className={`absolute flex cursor-move items-center justify-between rounded-lg bg-brand-500 px-4 text-white shadow-md ${ring}`} style={{ left: n.x, top: n.y, width: NODE_W, height: 44 }}>
        <span className="flex items-center gap-2 font-semibold">▶ Start</span><span className="font-mono text-xs opacity-80">start</span>
        {badge}{dot("next", 22)}
      </div>
    );
  }
  const b = BLOCKS[n.type];
  const ports = portsOf(n);
  const rows = n.type === "buttons" || n.type === "list" || n.type === "condition";
  return (
    <div data-node={n.id} onPointerDown={onDown} className={`absolute cursor-move rounded-xl border border-slate-200 bg-white shadow-md ${ring}`} style={{ left: n.x, top: n.y, width: NODE_W, height: nodeHeight(n) }}>
      <span className="absolute -left-[7px] h-3.5 w-3.5 rounded-full border-2 border-sky-500 bg-white" style={{ top: inY(n) - 7 }} />
      <div className="flex items-center gap-2 rounded-t-xl px-3 text-sm font-semibold text-white" style={{ background: b.color, height: LAYOUT.HEAD }}>
        <Icon name={b.icon} className="h-4 w-4" /><span className="flex-1 truncate">{b.label}</span>
        {isAsk(n.type) && <span className="rounded bg-white/20 px-1 text-[9px] uppercase">waits</span>}
        <span className="font-mono text-[10px] opacity-80">{n.id.slice(0, 6)}</span>
      </div>
      <div className="line-clamp-2 px-3 pt-2 text-xs text-slate-600" style={{ height: LAYOUT.BODY }}>{preview(n) || <i className="text-slate-400">Empty</i>}</div>
      {rows ? ports.map((p, i) => (
        <div key={p.id} className={`relative flex items-center justify-end pr-4 text-xs ${p.id === "other" ? "italic text-slate-400" : "font-semibold text-navy-900"}`} style={{ height: LAYOUT.ROW }}>
          {p.label}{dot(p.id, LAYOUT.ROW / 2, p.id === "other")}<span className="sr-only">{i}</span>
        </div>
      )) : ports.length > 0 && dot("next", LAYOUT.HEAD / 2)}
      {badge}
    </div>
  );
}

function MiniMap({ graph, view, canvas, bounds, onJump }: { graph: FlowGraph; view: View; canvas: React.RefObject<HTMLDivElement | null>; bounds: { x: number; y: number; w: number; h: number }; onJump: (x: number, y: number) => void }) {
  const W = 180, H = 120, pad = 200;
  const r = canvas.current?.getBoundingClientRect();
  const vb = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
  const s = Math.min(W / vb.w, H / vb.h);
  return (
    <svg data-ui width={W} height={H} className="absolute bottom-3 right-3 cursor-pointer rounded-lg border border-slate-200 bg-white/90 shadow-sm"
      onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); onJump(vb.x + (e.clientX - b.left) / s, vb.y + (e.clientY - b.top) / s); }}>
      {graph.nodes.map((n) => (
        <rect key={n.id} x={(n.x - vb.x) * s} y={(n.y - vb.y) * s} width={NODE_W * s} height={nodeHeight(n) * s} rx={2}
          fill={n.type === "start" ? "#22c55e" : BLOCKS[n.type].color} opacity={0.75} />
      ))}
      {r && <rect x={(-view.x / view.k - vb.x) * s} y={(-view.y / view.k - vb.y) * s} width={(r.width / view.k) * s} height={(r.height / view.k) * s} fill="#22c55e" fillOpacity={0.08} stroke="#16a34a" strokeWidth={1.5} />}
    </svg>
  );
}

function Versions({ flowId, onClose, onRestore }: { flowId: string; onClose: () => void; onRestore: (snapshot: Record<string, unknown>) => void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof listFlowVersions>> | null>(null);
  useEffect(() => { listFlowVersions(flowId).then(setList); }, [flowId]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><div className="font-semibold text-navy-900">Versions</div><button className="btn-ghost btn-sm" onClick={onClose}><Icon name="x" className="h-3 w-3" /></button></div>
      {!list ? <p className="text-sm text-slate-500">Loading…</p> : !list.length ? <p className="text-sm text-slate-500">No saved versions yet.</p> : (
        <ul className="space-y-1.5">{list.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs">
            <div><b className="text-navy-900">v{v.version}</b>{i === 0 && <span className="ml-1 rounded bg-brand-100 px-1 text-brand-700">current</span>}
              <div className="text-slate-500">{new Date(v.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{v.author ? ` · ${v.author}` : ""}</div>
              <div className="text-slate-400">{((v.snapshot.graph as FlowGraph | undefined)?.nodes.length ?? 0)} blocks</div></div>
            {i > 0 && <button className="btn-ghost btn-sm" onClick={() => { if (window.confirm(`Load v${v.version} into the editor?`)) onRestore(v.snapshot); }}>Restore</button>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

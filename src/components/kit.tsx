import Link from "next/link";

// Presentational building blocks shared by the CRM and the WhatsApp Business module (server-safe).

const P: Record<string, string> = {
  overview: "M3 12a9 9 0 1 0 9-9v9z M14 3.5A8.5 8.5 0 0 1 20.5 10H14z",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  contacts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  template: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  bot: "M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2",
  flow: "M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM6 9v3a3 3 0 0 0 3 3h6M18 9v6",
  cart: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2M20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6",
  chart: "M3 3v18h18M7 16v-5M12 16V8M17 16v-8",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1",
  check: "M20 6 9 17l-5-5",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1",
  wallet: "M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2",
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8M7 7h.01",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  agent: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  plus: "M12 5v14M5 12h14",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  refresh: "M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  userPlus: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
  xCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M15 9l-6 6M9 9l6 6",
  ban: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M4.9 4.9l14.2 14.2",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z",
  percent: "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  rupee: "M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  layers: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  heart: "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu: "M4 6h16M4 12h16M4 18h16",
  building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4",
  sparkle: "M12 3l1.9 5.8L20 10.7l-5.8 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9zM19 3v4M21 5h-4",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M22 6l-10 7L2 6",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8m0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  facebook: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  x: "M18 6 6 18M6 6l12 12",
  sidebar: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M9 3v18",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof P | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.chat} />
    </svg>
  );
}

const TONE: Record<string, { bar: string; chip: string }> = {
  green: { bar: "bg-brand-500", chip: "bg-brand-500 text-white" },
  blue: { bar: "bg-sky-500", chip: "bg-sky-500 text-white" },
  violet: { bar: "bg-violet-500", chip: "bg-violet-500 text-white" },
  amber: { bar: "bg-amber-500", chip: "bg-amber-500 text-white" },
  red: { bar: "bg-red-500", chip: "bg-red-500 text-white" },
  orange: { bar: "bg-orange-500", chip: "bg-orange-500 text-white" },
  slate: { bar: "bg-slate-500", chip: "bg-navy-800 text-white" },
};

/** Light tile colours for icons beside page titles and section headings. */
export const TILE: Record<string, string> = {
  green: "bg-gradient-to-br from-emerald-400 to-brand-600 text-white",
  blue: "bg-gradient-to-br from-sky-400 to-blue-600 text-white",
  violet: "bg-gradient-to-br from-violet-400 to-purple-600 text-white",
  amber: "bg-gradient-to-br from-amber-400 to-orange-500 text-white",
  red: "bg-gradient-to-br from-rose-400 to-red-600 text-white",
  navy: "bg-gradient-to-br from-navy-700 to-navy-900 text-white",
};

/** Pill tabs (WhatsApp-module style). Active state is decided by the caller. */
export function PillTabs({ tabs, label }: { tabs: { href: string; label: React.ReactNode; icon?: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto border-b border-slate-200 px-1 pb-3 text-sm" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${t.active ? "border-transparent bg-brand-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700"}`}>
          {t.icon && <Icon name={t.icon} className="h-3.5 w-3.5" />}{t.label}
          {t.count !== undefined && <span className={`rounded-full px-1.5 text-[10px] ${t.active ? "bg-white/20" : "bg-slate-100"}`}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Kpi({ label, value, sub, icon, tone = "green", href, title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: string; tone?: string; href?: string; title?: string }) {
  const t = TONE[tone] ?? TONE.green;
  const body = (
    <div className="card relative h-full overflow-hidden p-4 pt-5 transition hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-bold text-navy-900">{value}</div>
          {sub && <div className="mt-1 truncate text-xs text-slate-500">{sub}</div>}
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.chip}`}><Icon name={icon} /></span>
      </div>
    </div>
  );
  return href ? <Link href={href} title={title} className="block h-full transition hover:-translate-y-0.5">{body}</Link> : body;
}

const PANEL_CHIP: Record<string, string> = {
  green: "bg-brand-50 text-brand-600", blue: "bg-sky-50 text-sky-600", violet: "bg-violet-50 text-violet-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600", slate: "bg-slate-100 text-navy-800",
};

export function Panel({ title, icon, actions, children, className = "", tone = "green", sub }: { title: string; icon?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; tone?: string; sub?: React.ReactNode }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          {icon && <span className={`grid h-7 w-7 place-items-center rounded-md ${PANEL_CHIP[tone] ?? PANEL_CHIP.green}`}><Icon name={icon} className="h-3.5 w-3.5" /></span>}
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        {sub && <p className="w-full text-xs text-slate-500">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-3 text-slate-300"><Icon name={icon} className="h-10 w-10" /></span>
      <div className="text-sm font-semibold text-navy-900">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "red" | "green" }) {
  const c = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "green" ? "border-brand-100 bg-brand-50 text-brand-700" : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${c}`}><Icon name="plug" className="mt-0.5 h-4 w-4 shrink-0" /><div>{children}</div></div>;
}

/** Simple dual/triple bar chart, no chart library. */
export function Bars({ rows, series, height = 140 }: { rows: { label: string; values: number[] }[]; series: { name: string; color: string }[]; height?: number }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height }}>
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-[18px] flex-1 flex-col items-center justify-end gap-1" title={`${r.label}: ${r.values.map((v, i) => `${series[i].name} ${v}`).join(", ")}`}>
            <div className="flex h-full w-full items-end justify-center gap-px">
              {r.values.map((v, i) => (
                <span key={i} className="w-full max-w-[10px] rounded-t" style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 100)}%`, background: v ? series[i].color : "#e2e8f0" }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {rows.map((r) => <span key={r.label} className="min-w-[18px] flex-1 text-center text-[10px] text-slate-400">{r.label}</span>)}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: React.ReactNode }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      {items.map((i) => <span key={i.name} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.name}{i.value !== undefined && <b className="text-navy-900">{i.value}</b>}</span>)}
    </span>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {empty && <div className="px-3 py-4 text-sm text-slate-500">{empty}</div>}
    </div>
  );
}

export const SERIES = { sent: "#22c55e", received: "#3b82f6", failed: "#dc2626" };

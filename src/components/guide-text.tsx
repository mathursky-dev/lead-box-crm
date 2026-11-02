import Link from "next/link";
import { Fragment } from "react";

// Renders guide / help-bot text: [Label](/path) becomes an in-app link, **text** bold, `code` monospace.
// Only relative links (starting with "/") are made clickable, so AI output can never link off-site.
export function Inline({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) {
          return link[2].startsWith("/") && !link[2].startsWith("//")
            ? <Link key={i} href={link[2]} onClick={onNavigate} className="font-semibold text-brand-700 hover:underline">{link[1]}</Link>
            : <Fragment key={i}>{link[1]}</Fragment>;
        }
        if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i} className="font-semibold text-navy-900">{p.slice(2, -2)}</b>;
        if (/^`[^`]+`$/.test(p)) return <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em]">{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Multi-line answer: numbered / bulleted lines become lists, the rest paragraphs. */
export function RichText({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks: { kind: "ol" | "ul" | "p"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^#+\s*/, "");
    if (!line) continue;
    const ol = line.match(/^\d+[.)]\s+(.*)$/), ul = line.match(/^[-*•]\s+(.*)$/);
    const kind = ol ? "ol" : ul ? "ul" : "p";
    const body = ol?.[1] ?? ul?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && kind !== "p") last.lines.push(body);
    else blocks.push({ kind, lines: [body] });
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "p" ? <p key={i}><Inline text={b.lines[0]} onNavigate={onNavigate} /></p>
        : b.kind === "ol" ? <ol key={i} className="list-decimal space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}><Inline text={l} onNavigate={onNavigate} /></li>)}</ol>
        : <ul key={i} className="list-disc space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}><Inline text={l} onNavigate={onNavigate} /></li>)}</ul>,
      )}
    </div>
  );
}

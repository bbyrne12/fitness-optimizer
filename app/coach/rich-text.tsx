import { Fragment, type ReactNode } from "react";

/**
 * The coach writes a little markdown: bold, the odd list, sometimes italics
 * or a code-styled number. Shown as plain text it arrives as asterisks, so
 * this renders that small subset and nothing more. It builds elements, never
 * HTML strings, so nothing the model writes can become markup on the page.
 */

// **bold**, `code`, *italic*. Italic needs a non-space just inside each
// asterisk, so arithmetic like "3 * 12" is left alone.
const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*(?=\S)[^*\n]+?(?<=\S)\*)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i} className="rounded bg-zinc-800 px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] };

export function RichText({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const last = blocks.at(-1);
    const b = raw.match(BULLET), n = raw.match(NUMBERED);
    if (b || n) {
      const kind = b ? "ul" : "ol";
      const item = (b ?? n)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (!raw.trim()) {
      blocks.push({ kind: "p", lines: [] });
    } else {
      // The coach is told not to use headings; if one slips through it reads
      // as a bold line rather than a row of hashes.
      const h = raw.match(HEADING);
      const line = h ? `**${h[1]}**` : raw;
      if (last && last.kind === "p" && last.lines.length) last.lines.push(line);
      else blocks.push({ kind: "p", lines: [line] });
    }
  }

  return (
    <>
      {blocks.map((blk, i) => {
        if (blk.kind === "p") {
          if (!blk.lines.length) return null;
          return (
            <p key={i}>
              {blk.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}
            </p>
          );
        }
        const List = blk.kind;
        return (
          <List key={i} className={`${blk.kind === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5 marker:text-zinc-500`}>
            {blk.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </List>
        );
      })}
    </>
  );
}

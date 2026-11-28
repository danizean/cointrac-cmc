"use client";

import type { ReactNode } from "react";

function normalizeVerbosePercent(segment: string): string {
  // Normalize noisy 3+ decimal percentages from raw LLM prose (e.g. -3.723759% -> -3.7%)
  return segment.replace(/([+-]?\d+\.\d{3,})%/g, (full, numStr: string) => {
    const parsed = Number(numStr);
    if (!Number.isFinite(parsed)) return full;
    const prefix = numStr.startsWith("+") && parsed > 0 ? "+" : "";
    return `${prefix}${parsed.toFixed(1)}%`;
  });
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const normalized = normalizeVerbosePercent(text);
  const parts = normalized.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      return (
        <em key={`${keyPrefix}-i-${idx}`} className="italic text-foreground/90">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const inner = part.slice(1, -1);
      return (
        <code
          key={`${keyPrefix}-c-${idx}`}
          className="rounded-[5px] border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-link"
        >
          {inner}
        </code>
      );
    }

    // Highlight standalone signed percentages in prose subtly for quick scanning
    const subParts = part.split(/([+-]\d+(?:\.\d+)?%)/g);
    if (subParts.length === 1) {
      return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
    }
    return subParts.map((seg, sIdx) => {
      if (/^\+\d+(?:\.\d+)?%$/.test(seg)) {
        return (
          <span
            key={`${keyPrefix}-pct-${idx}-${sIdx}`}
            className="font-mono font-medium text-positive"
          >
            {seg}
          </span>
        );
      }
      if (/^-\d+(?:\.\d+)?%$/.test(seg)) {
        return (
          <span
            key={`${keyPrefix}-pct-${idx}-${sIdx}`}
            className="font-mono font-medium text-destructive"
          >
            {seg}
          </span>
        );
      }
      return <span key={`${keyPrefix}-sub-${idx}-${sIdx}`}>{seg}</span>;
    });
  });
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed);
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function looksNumericCell(cell: string): boolean {
  return /^[+-]?[$€£¥₿]?[\d,.]+[%KMBT]?$/i.test(cell.replace(/\*\*/g, "").trim());
}

function cellToneClass(cell: string): string {
  const cleaned = cell.replace(/\*\*/g, "").trim();
  if (/^\+\d+(?:\.\d+)?%$/.test(cleaned)) return "text-positive font-semibold";
  if (/^-\d+(?:\.\d+)?%$/.test(cleaned)) return "text-destructive font-semibold";
  return "text-foreground";
}

type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "paragraph"; lines: string[] };

function parseMarkdownBlocks(raw: string): BlockNode[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // GFM table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableDivider(lines[i + 1] ?? "")
    ) {
      const headers = parseTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().includes("|")) {
        rows.push(parseTableCells(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2] });
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph until blank line or structural block
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (
        /^#{1,4}\s+/.test(curTrim) ||
        /^[-*_]{3,}$/.test(curTrim) ||
        curTrim.startsWith(">") ||
        /^[-*•]\s+/.test(curTrim) ||
        /^\d+\.\s+/.test(curTrim) ||
        (curTrim.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1] ?? ""))
      ) {
        break;
      }
      paraLines.push(curTrim);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  return blocks;
}

export function AiMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
      {blocks.map((block, bIdx) => {
        if (block.type === "hr") {
          return <hr key={`hr-${bIdx}`} className="border-border/70" />;
        }

        if (block.type === "heading") {
          const sizeClass =
            block.level === 1
              ? "text-base font-semibold text-foreground"
              : block.level === 2
                ? "pt-1 text-sm font-semibold text-foreground"
                : "pt-1 text-[12.5px] font-semibold uppercase tracking-wide text-link";
          return (
            <p key={`h-${bIdx}`} className={sizeClass}>
              {renderInline(block.text, `h-${bIdx}`)}
            </p>
          );
        }

        if (block.type === "table") {
          return (
            <div
              key={`tbl-${bIdx}`}
              className="overflow-x-auto rounded-[12px] border border-border bg-background/60"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/45 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    {block.headers.map((head, hIdx) => (
                      <th key={`th-${bIdx}-${hIdx}`} className="whitespace-nowrap px-3.5 py-2.5">
                        {renderInline(head, `th-${bIdx}-${hIdx}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/80">
                  {block.rows.map((row, rIdx) => (
                    <tr key={`tr-${bIdx}-${rIdx}`} className="hover:bg-muted/30">
                      {block.headers.map((_, cIdx) => {
                        const cell = row[cIdx] ?? "—";
                        const numeric = looksNumericCell(cell);
                        return (
                          <td
                            key={`td-${bIdx}-${rIdx}-${cIdx}`}
                            className={`whitespace-nowrap px-3.5 py-2 ${
                              numeric
                                ? `font-mono tabular-nums ${cellToneClass(cell)}`
                                : cellToneClass(cell)
                            }`}
                          >
                            {renderInline(cell, `td-${bIdx}-${rIdx}-${cIdx}`)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              key={`q-${bIdx}`}
              className="rounded-r-[10px] border-l-2 border-primary bg-primary/8 px-3.5 py-2 text-xs text-foreground"
            >
              {block.lines.map((line, lIdx) => (
                <p key={`ql-${bIdx}-${lIdx}`}>{renderInline(line, `ql-${bIdx}-${lIdx}`)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === "ul") {
          return (
            <ul key={`ul-${bIdx}`} className="space-y-1.5 pl-4">
              {block.items.map((item, lIdx) => (
                <li key={`uli-${bIdx}-${lIdx}`} className="list-disc marker:text-link">
                  {renderInline(item, `uli-${bIdx}-${lIdx}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={`ol-${bIdx}`} className="space-y-1.5 pl-5">
              {block.items.map((item, lIdx) => (
                <li key={`oli-${bIdx}-${lIdx}`} className="list-decimal marker:font-mono marker:text-link">
                  {renderInline(item, `oli-${bIdx}-${lIdx}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <div key={`p-${bIdx}`} className="space-y-1.5">
            {block.lines.map((line, lIdx) => (
              <p key={`pl-${bIdx}-${lIdx}`}>{renderInline(line, `pl-${bIdx}-${lIdx}`)}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

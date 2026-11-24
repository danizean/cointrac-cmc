"use client";

import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";

interface JsonViewerProps {
  value: unknown;
  title?: string;
  maxHeightClass?: string;
}

const TOKEN_REGEX =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJsonLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  TOKEN_REGEX.lastIndex = 0;
  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    let className = "text-foreground";
    if (token.startsWith('"') && token.endsWith(":")) {
      className = "text-primary";
    } else if (token.startsWith('"')) {
      className = "text-positive";
    } else if (token === "true" || token === "false") {
      className = "text-accent";
    } else if (token === "null") {
      className = "text-destructive";
    } else {
      className = "text-accent";
    }
    nodes.push(
      <span key={keyIdx++} className={className}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }
  return nodes;
}

export function JsonViewer({
  value,
  title = "EvidenceEnvelope JSON",
  maxHeightClass = "max-h-[560px]",
}: JsonViewerProps) {
  const formatted = JSON.stringify(value, null, 2) ?? "null";
  const lines = formatted.split("\n");

  return (
    <div className="tg-panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card-elevated/80 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/65" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/65" />
            <span className="h-2.5 w-2.5 rounded-full bg-positive/65" />
          </div>
          <span className="font-mono text-xs font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <CopyButton text={formatted} label="Copy JSON" />
      </div>
      <pre
        className={`${maxHeightClass} overflow-auto bg-code-bg p-4 font-mono text-xs leading-6 text-foreground`}
      >
        <code>
          {lines.map((line, index) => (
            <div key={index} className="flex gap-4">
              <span
                aria-hidden="true"
                className="w-7 shrink-0 select-none text-right text-[11px] text-muted-foreground/45"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre">
                {highlightJsonLine(line)}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

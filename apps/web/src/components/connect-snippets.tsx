"use client";

import { useState } from "react";
import { useAppPreferences } from "./app-preferences";
import { CopyButton } from "./copy-button";

interface ConnectSnippetsProps {
  mcpUrl: string;
  apiBaseUrl: string;
}

type SnippetTab = "cursor" | "claude" | "python" | "curl";

export function ConnectSnippets({ mcpUrl, apiBaseUrl }: ConnectSnippetsProps) {
  const { t } = useAppPreferences();
  const [activeTab, setActiveTab] = useState<SnippetTab>("cursor");

  const snippets: Record<
    SnippetTab,
    { label: string; filename: string; note: string; code: string }
  > = {
    cursor: {
      label: "Cursor MCP",
      filename: "examples/cursor_mcp_config.json",
      note: "Connect Cursor over authenticated Streamable HTTP MCP transport using a personal CoinTrac API key from /app/keys.",
      code: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: mcpUrl,
              headers: {
                Authorization: "Bearer <YOUR_COINTRAC_API_KEY>",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    claude: {
      label: "Claude Desktop",
      filename: "examples/claude_desktop_config.json",
      note: "Run CoinTrac locally over stdio for Claude Desktop (replace /ABSOLUTE/PATH/TO/REPO with your repo path).",
      code: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              command: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence/.venv/bin/python",
              args: ["-m", "app.mcp.stdio_entry"],
              cwd: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence",
              env: {
                PYTHONPATH: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    python: {
      label: "Python Bot",
      filename: "examples/python_rest_client.py",
      note: "Zero-dependency stdlib client calling the unified CoinTrac intelligence workflows with your personal API key.",
      code: `import json
import os
import urllib.request

BASE = "${apiBaseUrl}"
API_KEY = os.environ["COINTRAC_API_KEY"]


def post(path: str, payload: dict[str, object]) -> dict[str, object]:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        body = json.load(response)
    if not isinstance(body, dict):
        raise RuntimeError("CoinTrac returned a non-object response")
    return body


if __name__ == "__main__":
    envelope = post(
        "/v1/intelligence/compare-assets",
        {"symbols": ["SOL", "AVAX", "NEAR"]},
    )
    print(envelope["tool"], envelope["evidence"]["evidence_id"])`,
    },
    curl: {
      label: "cURL",
      filename: "terminal",
      note: "Pass Authorization: Bearer <YOUR_COINTRAC_API_KEY> and optional x-cmc-api-key (BYOK).",
      code: `curl -sf \\
  -H "Authorization: Bearer <YOUR_COINTRAC_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols": ["SOL", "AVAX", "NEAR"]}' \\
  "${apiBaseUrl}/v1/intelligence/compare-assets" | python -m json.tool`,
    },
  };

  const current = snippets[activeTab];

  return (
    <div className="tg-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card-elevated/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/65" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/65" />
            <span className="h-2.5 w-2.5 rounded-full bg-positive/65" />
          </div>

          <div
            role="tablist"
            aria-label="Client integration snippets"
            className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-background/70 p-1"
          >
            {(Object.keys(snippets) as SnippetTab[]).map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={`cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1 font-mono text-xs font-semibold transition-all duration-150 ${
                    active
                      ? "bg-foreground text-background shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {snippets[tab].label}
                </button>
              );
            })}
          </div>
        </div>
        <CopyButton text={current.code} label={t.connect.copySnippet} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card-elevated/45 px-5 py-2.5 text-xs text-muted-foreground">
        <span>{current.note}</span>
        <span className="font-mono text-[11px] text-primary">
          {current.filename}
        </span>
      </div>

      <pre className="overflow-x-auto bg-code-bg p-5 font-mono text-xs leading-6 text-foreground">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

"use client";

import { Terminal } from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "./app-preferences";
import { CopyButton } from "./copy-button";

interface ConnectSnippetsProps {
  mcpUrl: string;
  apiBaseUrl: string;
}

type SnippetTab = "chatgpt" | "claude" | "gemini" | "hermes" | "python" | "curl";

export function ConnectSnippets({ mcpUrl, apiBaseUrl }: ConnectSnippetsProps) {
  const { locale, t } = useAppPreferences();
  const [activeTab, setActiveTab] = useState<SnippetTab>("chatgpt");

  const snippets: Record<
    SnippetTab,
    { label: string; filename: string; note: string; code: string }
  > = {
    chatgpt: {
      label: "ChatGPT",
      filename: "remote-mcp-https.json",
      note:
        locale === "id"
          ? "Hubungkan ChatGPT via Streamable HTTP MCP menggunakan API key CoinTrac dari /app/keys."
          : "Connect ChatGPT over Streamable HTTP MCP using a CoinTrac API key from /app/keys.",
      code: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: mcpUrl,
              transport: "streamable_http",
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
      label: "Claude",
      filename: "claude_mcp_config.json",
      note:
        locale === "id"
          ? "Konfigurasi remote Streamable HTTP MCP untuk Claude dengan header x-cointrac-key."
          : "Remote Streamable HTTP MCP configuration for Claude using x-cointrac-key.",
      code: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: mcpUrl,
              headers: {
                "x-cointrac-key": "<YOUR_COINTRAC_API_KEY>",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    gemini: {
      label: "Gemini",
      filename: "oauth-pkce-mcp.json",
      note:
        locale === "id"
          ? "Gemini remote MCP memakai HTTPS dengan OAuth 2.1 + PKCE (discovery di api.cointrac.xyz)."
          : "Gemini remote MCP uses HTTPS with OAuth 2.1 + PKCE (discovery on api.cointrac.xyz).",
      code: JSON.stringify(
        {
          mcpServerUrl: mcpUrl,
          transport: "streamable_http",
          auth: {
            type: "oauth2",
            authorizationServerMetadata: `${apiBaseUrl}/.well-known/oauth-authorization-server`,
            protectedResourceMetadata: `${mcpUrl.replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource/mcp`,
            pkce: "S256",
            scope: "mcp:tools",
          },
        },
        null,
        2,
      ),
    },
    hermes: {
      label: "Hermes",
      filename: "hermes_mcp.json",
      note:
        locale === "id"
          ? "Hubungkan Hermes langsung ke endpoint HTTPS /mcp dengan x-cointrac-key atau Bearer token."
          : "Connect Hermes directly to the HTTPS /mcp endpoint with x-cointrac-key or Bearer auth.",
      code: JSON.stringify(
        {
          name: "cointrac",
          url: mcpUrl,
          transport: "streamable-http",
          headers: {
            "x-cointrac-key": "<YOUR_COINTRAC_API_KEY>",
          },
        },
        null,
        2,
      ),
    },
    python: {
      label: "Python",
      filename: "cointrac_rest_client.py",
      note:
        locale === "id"
          ? "Contoh klien Python tanpa library tambahan untuk memanggil REST API CoinTrac."
          : "Zero-dependency stdlib Python client calling the CoinTrac REST API.",
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
            "x-cointrac-key": API_KEY,
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
      note:
        locale === "id"
          ? "Kirim header x-cointrac-key (atau Authorization: Bearer) serta opsional x-cmc-api-key (BYOK)."
          : "Pass x-cointrac-key (or Authorization: Bearer) and optional x-cmc-api-key (BYOK).",
      code: `curl -sf \\
  -H "x-cointrac-key: <YOUR_COINTRAC_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols": ["SOL", "AVAX", "NEAR"]}' \\
  "${apiBaseUrl}/v1/intelligence/compare-assets" | python -m json.tool`,
    },
  };

  const current = snippets[activeTab];

  return (
    <div className="ct-surface-featured overflow-hidden rounded-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[#080B12] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Terminal className="hidden h-4 w-4 text-link sm:block" aria-hidden="true" />
          <div
            role="tablist"
            aria-label="Client integration snippets"
            className="inline-flex flex-wrap gap-1 rounded-[10px] border border-[#202A3A] bg-[#0D111B] p-1"
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
                  className={`cursor-pointer whitespace-nowrap rounded-[7px] px-3 py-1 font-mono text-xs font-medium transition-colors ${
                    active
                      ? "bg-primary text-white"
                      : "text-[#A6B1C2] hover:text-white"
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
        <span className="font-mono text-[11px] text-link">{current.filename}</span>
      </div>

      <pre
        key={activeTab}
        className="ct-code-swap overflow-x-auto bg-code-bg p-5 font-mono text-xs leading-6 text-foreground"
      >
        <code>{current.code}</code>
      </pre>
    </div>
  );
}

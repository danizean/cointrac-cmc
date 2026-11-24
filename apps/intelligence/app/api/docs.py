"""Custom CoinTrac Swagger UI matching the institutional terminal aesthetic."""

from fastapi.responses import HTMLResponse

SWAGGER_DOCS_HTML = """<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CoinTrac API Docs · OpenAPI 3.1</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
    rel="stylesheet"
  />
  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
  />
  <style>
    :root {
      --bg: #f4f7fb;
      --card: #ffffff;
      --elevated: #f8fafc;
      --fg: #0f172a;
      --muted: #475569;
      --border: rgba(15, 23, 42, 0.11);
      --primary: #0284c7;
      --accent: #d97706;
      --positive: #059669;
      --destructive: #e11d48;
      --code-bg: #f8fafc;
    }

    html.dark {
      --bg: #060911;
      --card: #0c1220;
      --elevated: #121b2f;
      --fg: #f1f5f9;
      --muted: #94a3b8;
      --border: rgba(148, 163, 184, 0.16);
      --primary: #38bdf8;
      --accent: #f59e0b;
      --positive: #10b981;
      --destructive: #f43f5e;
      --code-bg: #080d18;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .tg-topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      background: color-mix(in srgb, var(--card) 86%, transparent);
      border-bottom: 1px solid var(--border);
    }

    .tg-topbar-inner {
      max-width: 1240px;
      margin: 0 auto;
      padding: 12px 24px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .tg-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--fg);
    }

    .tg-mark {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--primary) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent);
      color: var(--primary);
      font-family: "JetBrains Mono", monospace;
      font-weight: 700;
      font-size: 13px;
    }

    .tg-brand-title { font-weight: 800; font-size: 15px; letter-spacing: -0.02em; }
    .tg-brand-sub {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .tg-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .tg-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      background: var(--elevated);
      color: var(--fg);
      border-radius: 999px;
      padding: 6px 12px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: border-color 150ms ease, background-color 150ms ease;
    }

    .tg-pill:hover { border-color: var(--primary); }
    .tg-pill-accent {
      background: var(--accent);
      color: #060911;
      border-color: transparent;
    }
    .tg-pill-accent:hover { opacity: 0.9; }

    .tg-banner {
      max-width: 1240px;
      margin: 20px auto 0;
      padding: 0 24px;
    }

    .tg-banner-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 18px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
    }

    .tg-banner-card code {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      background: var(--elevated);
      border: 1px solid var(--border);
      padding: 2px 8px;
      border-radius: 6px;
      color: var(--primary);
    }

    /* Swagger UI skin overrides */
    #swagger-ui {
      max-width: 1240px;
      margin: 0 auto 60px;
      padding: 8px 24px 0;
    }

    .swagger-ui { color: var(--fg); font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .wrapper { padding: 0; max-width: none; }
    .swagger-ui .info { margin: 20px 0 24px; }
    .swagger-ui .info .title {
      color: var(--fg);
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table { color: var(--muted); }
    .swagger-ui .info a { color: var(--primary); }
    .swagger-ui .scheme-container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: none;
      padding: 14px 18px;
      margin-bottom: 20px;
    }
    .swagger-ui .opblock-tag {
      color: var(--fg);
      border-bottom: 1px solid var(--border);
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      font-weight: 700;
    }
    .swagger-ui .opblock-tag small { color: var(--muted); font-weight: 400; }
    .swagger-ui .opblock {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: none;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .swagger-ui .opblock.opblock-get {
      border-color: color-mix(in srgb, var(--positive) 30%, var(--border));
      background: var(--card);
    }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: var(--positive); }
    .swagger-ui .opblock.opblock-post {
      border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
      background: var(--card);
    }
    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: var(--primary);
      color: #060911;
    }
    .swagger-ui .opblock .opblock-summary-path {
      color: var(--fg);
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
    }
    .swagger-ui .opblock .opblock-summary-description { color: var(--muted); font-size: 12.5px; }
    .swagger-ui .opblock-body,
    .swagger-ui .opblock-section-header {
      background: var(--elevated);
      color: var(--fg);
      border-color: var(--border);
    }
    .swagger-ui .opblock-section-header h4,
    .swagger-ui .opblock-description-wrapper p,
    .swagger-ui .parameter__name,
    .swagger-ui .response-col_status,
    .swagger-ui .response-col_description,
    .swagger-ui table thead tr th,
    .swagger-ui table thead tr td,
    .swagger-ui .tab li,
    .swagger-ui label,
    .swagger-ui h4,
    .swagger-ui h5 { color: var(--fg); }
    .swagger-ui .parameter__type,
    .swagger-ui .parameter__in,
    .swagger-ui .prop-format { color: var(--muted); font-family: "JetBrains Mono", monospace; }
    .swagger-ui input[type="text"],
    .swagger-ui input[type="password"],
    .swagger-ui textarea,
    .swagger-ui select {
      background: var(--code-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
    }
    .swagger-ui .btn {
      border-radius: 8px;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      box-shadow: none;
    }
    .swagger-ui .btn.authorize {
      color: var(--positive);
      border-color: var(--positive);
      background: color-mix(in srgb, var(--positive) 12%, transparent);
    }
    .swagger-ui .btn.authorize svg { fill: var(--positive); }
    .swagger-ui .btn.execute {
      background: var(--accent);
      border-color: var(--accent);
      color: #060911;
      font-weight: 700;
    }
    .swagger-ui .highlight-code,
    .swagger-ui .microlight,
    .swagger-ui pre {
      background: var(--code-bg) !important;
      color: var(--fg) !important;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-family: "JetBrains Mono", monospace !important;
      font-size: 12px;
    }
    .swagger-ui section.models {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
    }
    .swagger-ui section.models h4,
    .swagger-ui .model-title,
    .swagger-ui .model { color: var(--fg); }
    .swagger-ui .dialog-ux .modal-ux {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
    }
    .swagger-ui .dialog-ux .modal-ux-header h3,
    .swagger-ui .dialog-ux .modal-ux-content p,
    .swagger-ui .dialog-ux .modal-ux-content h4 { color: var(--fg); }
    .swagger-ui .filter-container .operation-filter-input {
      background: var(--card);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 12px;
    }
    html.dark .swagger-ui svg.arrow,
    html.dark .swagger-ui .expand-methods svg,
    html.dark .swagger-ui .expand-operation svg,
    html.dark .swagger-ui .authorization__btn svg { fill: var(--muted); }
  </style>
</head>
<body>
  <header class="tg-topbar">
    <div class="tg-topbar-inner">
      <a href="/docs" class="tg-brand">
        <span class="tg-mark">CT</span>
        <div>
          <div class="tg-brand-title">CoinTrac Intelligence API</div>
          <div class="tg-brand-sub">OpenAPI 3.1 · REST + MCP Server</div>
        </div>
      </a>
      <div class="tg-actions">
        <a href="/openapi.json" target="_blank" rel="noopener" class="tg-pill">
          openapi.json
        </a>
        <a href="/health" target="_blank" rel="noopener" class="tg-pill">
          /health
        </a>
        <a href="/v1/capabilities" target="_blank" rel="noopener" class="tg-pill">
          /v1/capabilities
        </a>
        <button type="button" id="theme-toggle-btn" class="tg-pill">
          Light Mode
        </button>
      </div>
    </div>
  </header>

  <div class="tg-banner">
    <div class="tg-banner-card">
      <div>
        <strong>Quick Auth:</strong> Click <strong>Authorize</strong> below and paste your personal
        CoinTrac API key (<code>&lt;YOUR_COINTRAC_API_KEY&gt;</code> from <code>/app/keys</code>)
        using <code>Authorization: Bearer</code> or <code>x-cointrac-key</code>
        (<code>CoinTracKey</code>). Optional BYOK CoinMarketCap key goes in
        <code>CoinMarketCapBYOK</code>.
      </div>
      <div>
        MCP Streamable HTTP: <code>/mcp</code>
      </div>
    </div>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    (function () {
      const html = document.documentElement;
      const themeBtn = document.getElementById("theme-toggle-btn");

      function applyTheme(theme) {
        const isDark = theme === "dark";
        html.classList.toggle("dark", isDark);
        themeBtn.textContent = isDark ? "Light Mode" : "Dark Mode";
        try { localStorage.setItem("ct_docs_theme", theme); } catch (_) {}
      }

      const saved = (() => {
        try {
          return (
            localStorage.getItem("ct_docs_theme") ||
            localStorage.getItem("tg_docs_theme") ||
            localStorage.getItem("tg_theme")
          );
        }
        catch (_) { return null; }
      })();
      applyTheme(saved === "light" ? "light" : "dark");

      themeBtn.addEventListener("click", () => {
        applyTheme(html.classList.contains("dark") ? "light" : "dark");
      });

      SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        filter: true,
        displayRequestDuration: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 0,
        docExpansion: "list",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      });
    })();
  </script>
</body>
</html>
"""


def render_swagger_docs() -> HTMLResponse:
    return HTMLResponse(content=SWAGGER_DOCS_HTML)

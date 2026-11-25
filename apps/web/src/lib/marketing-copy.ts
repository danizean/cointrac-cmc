import type { Locale } from "./i18n";

export interface MarketingCopy {
  home: {
    eyebrow: string;
    title: string;
    lede: string;
    primaryCta: string;
    secondaryCta: string;
    problemTitle: string;
    problemBody: string;
    valueTitle: string;
    values: { title: string; body: string }[];
    flowTitle: string;
    flowLede: string;
    flow: { title: string; body: string }[];
    flowNote: string;
    mcpTitle: string;
    mcpLede: string;
    channels: { title: string; body: string }[];
    mcpNote: string;
    previewTitle: string;
    previewLede: string;
    previewLink: string;
    principlesTitle: string;
    principles: { title: string; body: string }[];
    closingTitle: string;
    closingBody: string;
    stageLabel: string;
    stageCaption: string;
    stageLimitations: string;
    docsCta: string;
    audiencesTitle: string;
    audiences: { title: string; body: string }[];
    pricingTitle: string;
    pricingLede: string;
    plans: { title: string; body: string }[];
    pricingNote: string;
    faqTitle: string;
    faq: { question: string; answer: string }[];
  };
  capabilities: {
    eyebrow: string;
    title: string;
    lede: string;
    catalogNote: string;
    groups: { id: "market" | "risk" | "history"; title: string; body: string }[];
    availabilityTitle: string;
    availability: { label: string; body: string }[];
    modesTitle: string;
    nextIntegrations: string;
    nextDocs: string;
  };
  integrations: {
    eyebrow: string;
    title: string;
    lede: string;
    conceptTitle: string;
    conceptBody: string;
    localTitle: string;
    localBody: string;
    publicTitle: string;
    publicBody: string;
    connectCta: string;
    statusTitle: string;
    client: string;
    status: string;
    detail: string;
    rows: { name: string; status: string; detail: string }[];
  };
  docs: {
    eyebrow: string;
    title: string;
    lede: string;
    open: string;
    source: string;
    planned: string;
    apiIntro: string;
    sections: {
      title: string;
      body: string;
      links: { href: string; label: string }[];
      sources: string[];
    }[];
  };
}

const en: MarketingCopy = {
  home: {
    eyebrow: "Crypto Market API & MCP",
    title: "Structured crypto market data for your apps and AI tools.",
    lede: "CoinTrac turns CoinMarketCap feeds into 10 REST endpoints and 11 MCP tools. Every response includes its data source, freshness, and any missing fields—nothing is guessed.",
    primaryCta: "Create free account",
    secondaryCta: "Read API docs",
    problemTitle: "Clear numbers, honest gaps.",
    problemBody:
      "Upstream crypto data can be live, cached, or limited by your CoinMarketCap plan. CoinTrac keeps those states visible. If a price, volume, or return is missing, it stays null instead of turning into 0.",
    valueTitle: "What CoinTrac handles",
    values: [
      {
        title: "Market & asset analysis",
        body: "Market overview, regime classification, single-asset metrics, and sector performance calculated in Python with a 365-day annualization basis.",
      },
      {
        title: "Screening & risk context",
        body: "Scan market movers, spot volume or price anomalies, compare assets side by side, and view derivatives context when available.",
      },
      {
        title: "Saved response records",
        body: "Every call returns an EvidenceEnvelope[T] and saves an audit record tied to your account, including timestamps and limitations.",
      },
    ],
    flowTitle: "How a request works",
    flowLede: "One Python backend serves the web app, REST API, and MCP server. It does not use an LLM on the server and does not stream live ticks.",
    flow: [
      { title: "CoinMarketCap data", body: "Fetches market quotes and metadata, tracking plan limits and missing fields." },
      { title: "Python calculations", body: "Runs fixed quantitative formulas (365-day volatility, relative strength, regime rules)." },
      { title: "REST & MCP", body: "Exposes the same 10 tools over /v1/* HTTP routes and 11 tools over MCP." },
      { title: "Structured response", body: "Returns JSON with status, data mode, freshness, and a list of limitations." },
    ],
    flowNote: "Cached and snapshot responses are always labeled so you know how fresh the data is.",
    mcpTitle: "Built for both REST and MCP.",
    mcpLede: "Use standard HTTP JSON in your backend, or connect an MCP-compatible client to the same tools.",
    channels: [
      { title: "Web console", body: "Test tools in the Playground, inspect saved evidence, and manage your API keys." },
      { title: "View MCP integrations", body: "Connect MCP clients via Streamable HTTP using an API key or OAuth 2.1 + PKCE." },
      { title: "REST endpoints", body: "10 JSON endpoints with typed schemas, per-key rate limits, and saved evidence logs." },
    ],
    mcpNote: "Works with API keys (x-cointrac-key) and includes OAuth 2.1 + PKCE support.",
    previewTitle: "Available tools",
    previewLede: "Four examples from the catalog.",
    previewLink: "See all capabilities",
    principlesTitle: "How we handle data",
    principles: [
      { title: "Consistent envelope", body: "Every tool returns status, summary, data, methodology, evidence, and limitations." },
      { title: "Owner-only records", body: "Saved evidence records belong to your account and are not exposed to other users." },
      { title: "Account isolation", body: "Access is checked against your verified session or API key owner." },
      { title: "No fake zeros", body: "Restricted, partial, or missing data stays null and is listed in limitations." },
      { title: "Analysis only", body: "CoinTrac describes market data. It does not place trades or predict prices." },
    ],
    closingTitle: "Ready to test the API?",
    closingBody: "Create a free account to generate an API key, try the tools in the Playground, or check the integration guide.",
    stageLabel: "Response format",
    stageCaption:
      "Standard EvidenceEnvelope[T] format returned by all REST and MCP tools.",
    stageLimitations: "Recorded with the result",
    docsCta: "Read API docs",
    audiencesTitle: "Who uses CoinTrac",
    audiences: [
      {
        title: "App developers",
        body: "Call clean REST endpoints with predictable rate limits instead of parsing raw CoinMarketCap payloads yourself.",
      },
      {
        title: "AI & MCP builders",
        body: "Give your AI assistant structured market tools where missing data is clearly marked instead of hidden.",
      },
      {
        title: "Product teams",
        body: "Use the overview, movers, sector, and asset endpoints as a ready-made data layer for dashboards and monitors.",
      },
    ],
    pricingTitle: "Plans and limits",
    pricingLede: "Every new account starts on the Free plan with 5 active API keys and 60 requests per minute per key. Cache hits cost 0 CoinTrac credits.",
    plans: [
      {
        title: "Free Account",
        body: "Includes 5 active API keys, 60 requests/min per key, access to all 10 REST tools and 11 MCP tools, and saved evidence history.",
      },
      {
        title: "MCP Access",
        body: "Use your API key with the MCP server (/mcp) for Streamable HTTP tool calls, scoped to your account quota.",
      },
      {
        title: "Your CoinMarketCap Plan",
        body: "Historical OHLCV depends on your upstream CoinMarketCap tier (Basic/Startup plans return TIER_RESTRICTED). Cache hits save your upstream quota.",
      },
    ],
    pricingNote: "Currently free to use · No paid checkout required · Cache hits use 0 CoinTrac credits.",
    faqTitle: "Common questions",
    faq: [
      {
        question: "Does CoinTrac execute trades or give financial advice?",
        answer: "No. CoinTrac only formats and calculates market data. It does not place orders, manage funds, or predict future prices.",
      },
      {
        question: "What happens if market data is missing?",
        answer: "Missing prices, volumes, or returns stay null and are explained in the limitations field. They are never replaced with 0.",
      },
      {
        question: "How do I authenticate with REST and MCP?",
        answer: "Send your API key in the x-cointrac-key or Authorization: Bearer header. The backend also includes OAuth 2.1 + PKCE endpoints for remote MCP.",
      },
      {
        question: "How does the web dashboard call the API?",
        answer: "The browser sends requests through /api/cointrac/* on the Next.js server, so secret keys never touch the browser.",
      },
    ],
  },
  capabilities: {
    eyebrow: "Product Catalog",
    title: "10 REST endpoints. 11 MCP tools.",
    lede: "Every intelligence tool works identically over REST and MCP (plus get_capabilities for MCP discovery). Below is what each tool does and how status flags work.",
    catalogNote: "Tool summaries reflect the exact catalog definitions returned by the backend.",
    groups: [
      {
        id: "market",
        title: "Market & asset analysis",
        body: "Market overview, regime rules, single-asset fundamentals, and sector rotation.",
      },
      {
        id: "risk",
        title: "Screening & risk context",
        body: "Movers screening, asset comparison, momentum, anomaly detection, and derivatives context.",
      },
      {
        id: "history",
        title: "Historical performance (plan-dependent)",
        body: "Returns historical OHLCV performance when your CoinMarketCap plan includes it. Basic and Startup plans return TIER_RESTRICTED instead of partial guesses.",
      },
    ],
    availabilityTitle: "How to read response statuses",
    availability: [
      { label: "OK", body: "All required upstream series were available and the calculation completed." },
      { label: "PARTIAL", body: "Some fields are present while others are missing or proxied (for example, spot-stress proxy when derivatives pairs are unavailable)." },
      { label: "TIER_RESTRICTED", body: "Your upstream CoinMarketCap plan does not include the required series (common on Basic/Startup for historical OHLCV)." },
      { label: "INSUFFICIENT_DATA", body: "Not enough valid data points to compute the metric reliably, so the result stays marked rather than guessed." },
    ],
    modesTitle: "Data mode (LIVE, CACHED, VERIFIED_SNAPSHOT_FALLBACK) and freshness (FRESH, AGING, STALE) are always shown separately. Missing numbers stay null—never turned into 0.",
    nextIntegrations: "View MCP integrations",
    nextDocs: "Read API docs",
  },
  integrations: {
    eyebrow: "MCP Integrations",
    title: "Bring market tools to your AI agent.",
    lede: "CoinTrac provides one Streamable HTTP MCP server over HTTPS with 11 tools, 5 resources, and 3 prompts. Connect your AI client using an API key or OAuth 2.1.",
    conceptTitle: "Streamable HTTP over HTTPS",
    conceptBody:
      "Send MCP JSON-RPC requests directly to /mcp over TLS. Every tool returns the same EvidenceEnvelope[T] format as the REST API.",
    localTitle: "CoinTrac MCP Endpoint",
    localBody:
      "Copy this HTTPS URL when adding CoinTrac as a remote MCP server in your AI client.",
    publicTitle: "Authentication",
    publicBody:
      "Authenticate with x-cointrac-key or Authorization: Bearer <key>. OAuth 2.1 Authorization Code + PKCE is supported for remote OAuth clients.",
    connectCta: "Open MCP setup",
    statusTitle: "Supported clients",
    client: "Client",
    status: "Transport & Auth",
    detail: "Notes",
    rows: [
      {
        name: "ChatGPT",
        status: "Streamable HTTP · Bearer / API Key",
        detail: "Connects to https://mcp.cointrac.xyz/mcp via Streamable HTTP using your CoinTrac API key or Bearer token.",
      },
      {
        name: "Claude",
        status: "Streamable HTTP / stdio · API Key",
        detail: "Works with Claude remote MCP over HTTPS or local Claude Desktop configuration using your CoinTrac API key.",
      },
      {
        name: "Gemini",
        status: "Streamable HTTP · OAuth 2.1 + PKCE",
        detail: "Designed for Gemini remote MCP via HTTPS with OAuth 2.1 Authorization Code + PKCE and refresh token rotation.",
      },
      {
        name: "Hermes",
        status: "Streamable HTTP · API Key / Bearer",
        detail: "Connects directly to https://mcp.cointrac.xyz/mcp with x-cointrac-key or Bearer auth for all 11 MCP tools.",
      },
    ],
  },
  docs: {
    eyebrow: "API & MCP Documentation",
    title: "Everything you need to integrate CoinTrac.",
    lede: "Explore all 10 REST endpoints, authentication headers, and MCP client guides—or open the interactive OpenAPI reference at api.cointrac.xyz/docs.",
    open: "Open",
    source: "Endpoint / Route",
    planned: "Planned",
    apiIntro:
      "Send requests to https://api.cointrac.xyz with your API key in x-cointrac-key or Authorization: Bearer. Browser calls from this site are proxied via /api/cointrac/*.",
    sections: [
      {
        title: "Getting started",
        body: "Create an account, generate an API key in /app/keys, and test requests directly in the Playground or over cURL.",
        links: [
          { href: "/signup", label: "Create account" },
          { href: "/playground", label: "Open Playground" },
        ],
        sources: ["https://api.cointrac.xyz"],
      },
      {
        title: "MCP setup",
        body: "Connect ChatGPT, Claude, Gemini, or Hermes to https://mcp.cointrac.xyz/mcp over Streamable HTTP.",
        links: [
          { href: "/connect", label: "Connect MCP" },
          { href: "/integrations", label: "Supported clients" },
        ],
        sources: ["https://mcp.cointrac.xyz/mcp"],
      },
      {
        title: "Product catalog",
        body: "Browse all 10 REST endpoints and 11 MCP tools, including response statuses (OK, PARTIAL, TIER_RESTRICTED) and null-safety rules.",
        links: [{ href: "/product", label: "View Product catalog" }],
        sources: ["/product"],
      },
      {
        title: "Evidence & provenance",
        body: "Every tool response returns an EvidenceEnvelope[T] with timestamps, data mode, freshness, and limitations, scoped to your account.",
        links: [{ href: "/evidence", label: "Evidence inspector" }],
        sources: ["/evidence"],
      },
      {
        title: "Authentication",
        body: "Use x-cointrac-key or Authorization: Bearer for REST and MCP API-key clients. OAuth 2.1 + PKCE is supported for remote MCP clients.",
        links: [
          { href: "/login", label: "Sign in" },
          { href: "/app/keys", label: "Manage API keys" },
        ],
        sources: ["x-cointrac-key", "OAuth 2.1 + PKCE"],
      },
      {
        title: "OpenAPI & Swagger reference",
        body: "Inspect request schemas, Pydantic v2 models, and try live HTTP payloads in the hosted OpenAPI documentation.",
        links: [{ href: "/connect", label: "Python & cURL examples" }],
        sources: ["https://api.cointrac.xyz/docs"],
      },
    ],
  },
};

const id: MarketingCopy = {
  home: {
    eyebrow: "API & MCP Data Pasar Kripto",
    title: "Data pasar kripto terstruktur untuk aplikasi dan AI Anda.",
    lede: "CoinTrac mengolah data CoinMarketCap menjadi 10 endpoint REST dan 11 tool MCP. Setiap respons mencatat sumber data, kesegarannya, dan bagian yang tidak tersedia—tanpa menebak-nebak.",
    primaryCta: "Buat akun gratis",
    secondaryCta: "Baca dokumentasi",
    problemTitle: "Angka jelas, kekurangan data tetap jujur.",
    problemBody:
      "Data pasar dari sumber bisa live, tersimpan di cache, atau terbatas oleh paket CoinMarketCap. CoinTrac selalu menampilkan status itu. Jika harga, volume, atau return tidak ada, nilainya tetap null—tidak diubah menjadi 0.",
    valueTitle: "Yang dikerjakan CoinTrac",
    values: [
      {
        title: "Analisis pasar & aset",
        body: "Ringkasan pasar, pembacaan kondisi pasar (regime), metrik per aset, dan performa sektor dihitung di Python dengan basis 365 hari.",
      },
      {
        title: "Screening & konteks risiko",
        body: "Pantau penggerak pasar, deteksi anomali harga/volume, bandingkan beberapa aset, dan cek konteks derivatif saat datanya tersedia.",
      },
      {
        title: "Catatan bukti per permintaan",
        body: "Setiap pemanggilan menghasilkan EvidenceEnvelope[T] dan menyimpan catatan riwayat milik akun Anda beserta waktu sumber dan batasannya.",
      },
    ],
    flowTitle: "Cara kerja setiap permintaan",
    flowLede: "Satu backend Python melayani web, REST API, dan server MCP. Tidak ada AI/LLM di server yang mengarang hasil, dan bukan feed harga real-time per detik.",
    flow: [
      { title: "Data CoinMarketCap", body: "Mengambil data pasar dan mencatat batas paket maupun kolom yang kosong." },
      { title: "Hitungan Python", body: "Menjalankan rumus tetap (volatilitas 365 hari, kekuatan relatif, dan aturan kondisi pasar)." },
      { title: "REST & MCP", body: "Menyediakan 10 tool lewat rute HTTP /v1/* dan 11 tool lewat server MCP." },
      { title: "Respons terstruktur", body: "Mengembalikan JSON berisi status, mode data, kesegaran, dan daftar keterbatasan." },
    ],
    flowNote: "Data cache dan snapshot selalu diberi label agar Anda tahu seberapa baru datanya.",
    mcpTitle: "Siap untuk REST dan MCP.",
    mcpLede: "Pakai endpoint JSON biasa di backend Anda, atau hubungkan klien MCP ke mesin yang sama.",
    channels: [
      { title: "Konsol web", body: "Coba tool di Playground, lihat riwayat bukti, dan kelola API key akun Anda." },
      { title: "Lihat integrasi MCP", body: "Hubungkan klien MCP lewat Streamable HTTP menggunakan API key atau OAuth 2.1 + PKCE." },
      { title: "Endpoint REST", body: "10 endpoint JSON dengan skema rapi, batas request per key, dan log bukti otomatis." },
    ],
    mcpNote: "Mendukung API key (x-cointrac-key) serta OAuth 2.1 + PKCE.",
    previewTitle: "Tool yang tersedia",
    previewLede: "Empat contoh dari katalog saat ini.",
    previewLink: "Lihat semua kapabilitas",
    principlesTitle: "Aturan pengolahan data",
    principles: [
      { title: "Format seragam", body: "Setiap tool mengembalikan status, ringkasan, data, metodologi, bukti, dan batasan." },
      { title: "Khusus pemilik akun", body: "Catatan bukti yang tersimpan hanya bisa dibuka oleh akun pemiliknya." },
      { title: "Isolasi akun", body: "Akses dicek berdasarkan sesi login atau pemilik API key yang sah." },
      { title: "Tanpa angka nol palsu", body: "Data yang dibatasi atau kosong tetap null dan dicatat di bagian limitations." },
      { title: "Bukan alat trading", body: "CoinTrac hanya menyajikan data pasar, tidak melakukan transaksi atau menjamin profit." },
    ],
    closingTitle: "Siap mencoba API-nya?",
    closingBody: "Buat akun gratis untuk membuat API key, uji langsung di Playground, atau lihat panduan integrasinya.",
    stageLabel: "Format respons",
    stageCaption:
      "Format standar EvidenceEnvelope[T] yang dipakai seluruh endpoint REST dan MCP.",
    stageLimitations: "Tercatat bersama hasil",
    docsCta: "Baca dokumentasi",
    audiencesTitle: "Cocok untuk siapa",
    audiences: [
      {
        title: "Developer aplikasi",
        body: "Panggil endpoint REST yang sudah rapi tanpa harus mengolah mentah respons CoinMarketCap dari nol.",
      },
      {
        title: "Pembuat asisten AI & MCP",
        body: "Beri asisten AI Anda tool pasar yang jelas mana data yang ada dan mana yang kosong.",
      },
      {
        title: "Tim produk",
        body: "Gunakan data ringkasan pasar, movers, sektor, dan aset untuk dashboard atau monitor internal Anda.",
      },
    ],
    pricingTitle: "Paket dan batasan",
    pricingLede: "Setiap akun baru langsung mendapat paket Gratis dengan maksimal 5 API key aktif dan 60 request/menit per key. Cache hit memakai 0 kredit CoinTrac.",
    plans: [
      {
        title: "Akun Gratis",
        body: "Sudah termasuk 5 API key aktif, 60 request/menit per key, akses penuh ke 10 tool REST dan 11 tool MCP, serta riwayat bukti.",
      },
      {
        title: "Akses MCP",
        body: "Gunakan API key Anda di endpoint MCP (/mcp) via Streamable HTTP sesuai kuota akun Anda.",
      },
      {
        title: "Paket CoinMarketCap",
        body: "Data historis OHLCV bergantung pada paket CoinMarketCap yang dipakai (paket Basic/Startup mengembalikan TIER_RESTRICTED). Cache hit membantu menghemat kuota.",
      },
    ],
    pricingNote: "Gratis digunakan saat ini · Tidak ada pembayaran · Cache hit memakai 0 kredit CoinTrac.",
    faqTitle: "Pertanyaan umum",
    faq: [
      {
        question: "Apakah CoinTrac bisa trading atau memprediksi harga?",
        answer: "Tidak. CoinTrac hanya menghitung dan merapikan data pasar, bukan untuk eksekusi order atau nasihat investasi.",
      },
      {
        question: "Apa yang terjadi jika ada data pasar yang kosong?",
        answer: "Harga, volume, atau return yang tidak tersedia tetap bernilai null dan dijelaskan di field limitations—tidak pernah diganti menjadi 0.",
      },
      {
        question: "Bagaimana cara login / autentikasi ke REST dan MCP?",
        answer: "Kirim API key melalui header x-cointrac-key atau Authorization: Bearer. Tersedia juga endpoint OAuth 2.1 + PKCE untuk remote MCP.",
      },
      {
        question: "Bagaimana halaman web ini memanggil backend?",
        answer: "Browser memanggil /api/cointrac/* di server Next.js sehingga kunci rahasia dan service-role tidak pernah dikirim ke browser.",
      },
    ],
  },
  capabilities: {
    eyebrow: "Katalog Produk",
    title: "10 endpoint REST. 11 tool MCP.",
    lede: "Setiap tool bekerja dengan logika yang sama di REST dan MCP (ditambah get_capabilities di MCP). Di bawah ini daftar tool dan cara membaca status hasilnya.",
    catalogNote: "Ringkasan tiap tool mengikuti definisi katalog resmi yang dikembalikan oleh backend.",
    groups: [
      {
        id: "market",
        title: "Analisis pasar & aset",
        body: "Ringkasan pasar, aturan kondisi pasar (regime), fundamental per aset, dan rotasi sektor.",
      },
      {
        id: "risk",
        title: "Screening & konteks risiko",
        body: "Penyaringan penggerak pasar, perbandingan aset, momentum, deteksi anomali, dan konteks derivatif.",
      },
      {
        id: "history",
        title: "Performa historis (bergantung paket)",
        body: "Mengembalikan performa historis OHLCV jika paket CoinMarketCap Anda mendukungnya. Paket Basic dan Startup mengembalikan TIER_RESTRICTED tanpa mengarang angka.",
      },
    ],
    availabilityTitle: "Cara membaca status respons",
    availability: [
      { label: "OK", body: "Seluruh data sumber yang dibutuhkan tersedia dan perhitungan selesai penuh." },
      { label: "PARTIAL", body: "Sebagian data tersedia dan sebagian lain kosong atau memakai proksi (misalnya proksi tekanan spot saat data derivatif tidak tersedia)." },
      { label: "TIER_RESTRICTED", body: "Paket CoinMarketCap yang dipakai tidak mencakup data tersebut (umumnya terjadi pada OHLCV historis di paket Basic/Startup)." },
      { label: "INSUFFICIENT_DATA", body: "Jumlah sampel data belum cukup untuk dihitung dengan layak, sehingga status ditandai jelas tanpa menebak." },
    ],
    modesTitle: "Mode data (LIVE, CACHED, VERIFIED_SNAPSHOT_FALLBACK) dan kesegaran (FRESH, AGING, STALE) selalu ditampilkan terpisah. Angka yang kosong tetap null—tidak pernah diubah menjadi 0.",
    nextIntegrations: "Lihat integrasi MCP",
    nextDocs: "Baca dokumentasi API",
  },
  integrations: {
    eyebrow: "Integrasi MCP",
    title: "Hubungkan agen AI ke data CoinTrac.",
    lede: "CoinTrac menyediakan satu server MCP Streamable HTTP melalui HTTPS dengan 11 tool, 5 resource, dan 3 prompt. Hubungkan klien AI Anda menggunakan API key atau OAuth 2.1.",
    conceptTitle: "Streamable HTTP melalui HTTPS",
    conceptBody:
      "Kirim permintaan MCP JSON-RPC langsung ke /mcp melalui HTTPS. Setiap tool mengembalikan format EvidenceEnvelope[T] yang sama dengan REST API.",
    localTitle: "Endpoint MCP CoinTrac",
    localBody:
      "Salin URL HTTPS ini saat menambahkan CoinTrac sebagai remote MCP server di klien AI Anda.",
    publicTitle: "Autentikasi",
    publicBody:
      "Gunakan header x-cointrac-key atau Authorization: Bearer <key>. OAuth 2.1 Authorization Code + PKCE juga didukung untuk klien OAuth remote.",
    connectCta: "Buka panduan setup MCP",
    statusTitle: "Klien yang didukung",
    client: "Klien",
    status: "Transport & Auth",
    detail: "Catatan",
    rows: [
      {
        name: "ChatGPT",
        status: "Streamable HTTP · Bearer / API Key",
        detail: "Terhubung ke https://mcp.cointrac.xyz/mcp melalui Streamable HTTP menggunakan API key CoinTrac atau Bearer token.",
      },
      {
        name: "Claude",
        status: "Streamable HTTP / stdio · API Key",
        detail: "Mendukung Claude remote MCP melalui HTTPS maupun konfigurasi lokal Claude Desktop menggunakan API key CoinTrac.",
      },
      {
        name: "Gemini",
        status: "Streamable HTTP · OAuth 2.1 + PKCE",
        detail: "Dirancang untuk Gemini remote MCP melalui HTTPS dengan OAuth 2.1 Authorization Code + PKCE dan rotasi refresh token.",
      },
      {
        name: "Hermes",
        status: "Streamable HTTP · API Key / Bearer",
        detail: "Terhubung langsung ke https://mcp.cointrac.xyz/mcp dengan x-cointrac-key atau Bearer auth untuk seluruh 11 tool MCP.",
      },
    ],
  },
  docs: {
    eyebrow: "Dokumentasi API & MCP",
    title: "Semua panduan untuk mengintegrasikan CoinTrac.",
    lede: "Pelajari 10 endpoint REST, header autentikasi, dan panduan klien MCP—atau buka referensi OpenAPI interaktif di api.cointrac.xyz/docs.",
    open: "Buka",
    source: "Endpoint / Rute",
    planned: "Direncanakan",
    apiIntro:
      "Kirim permintaan ke https://api.cointrac.xyz menggunakan API key di header x-cointrac-key atau Authorization: Bearer. Permintaan dari browser diproxy melalui /api/cointrac/*.",
    sections: [
      {
        title: "Mulai cepat",
        body: "Buat akun, buat API key di /app/keys, lalu uji endpoint langsung di Playground atau melalui cURL.",
        links: [
          { href: "/signup", label: "Buat akun" },
          { href: "/playground", label: "Buka Playground" },
        ],
        sources: ["https://api.cointrac.xyz"],
      },
      {
        title: "Setup MCP",
        body: "Hubungkan ChatGPT, Claude, Gemini, atau Hermes ke https://mcp.cointrac.xyz/mcp melalui Streamable HTTP.",
        links: [
          { href: "/connect", label: "Connect MCP" },
          { href: "/integrations", label: "Klien didukung" },
        ],
        sources: ["https://mcp.cointrac.xyz/mcp"],
      },
      {
        title: "Katalog Produk",
        body: "Lihat seluruh 10 endpoint REST dan 11 tool MCP beserta arti status (OK, PARTIAL, TIER_RESTRICTED) dan aturan null-safe.",
        links: [{ href: "/product", label: "Lihat Katalog Produk" }],
        sources: ["/product"],
      },
      {
        title: "Bukti & provenance",
        body: "Setiap respons mengembalikan EvidenceEnvelope[T] berisi timestamp, mode data, kesegaran, dan batasan yang terisolasi per akun.",
        links: [{ href: "/evidence", label: "Inspektur bukti" }],
        sources: ["/evidence"],
      },
      {
        title: "Autentikasi",
        body: "Gunakan header x-cointrac-key atau Authorization: Bearer untuk REST dan MCP API-key. OAuth 2.1 + PKCE didukung untuk klien MCP remote.",
        links: [
          { href: "/login", label: "Masuk" },
          { href: "/app/keys", label: "Kelola API key" },
        ],
        sources: ["x-cointrac-key", "OAuth 2.1 + PKCE"],
      },
      {
        title: "Referensi OpenAPI & Swagger",
        body: "Periksa skema request, model Pydantic v2, dan uji payload HTTP langsung pada dokumentasi OpenAPI.",
        links: [{ href: "/connect", label: "Contoh Python & cURL" }],
        sources: ["https://api.cointrac.xyz/docs"],
      },
    ],
  },
};

export const MARKETING: Record<Locale, MarketingCopy> = { en, id };

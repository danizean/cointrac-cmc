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
    eyebrow: "Crypto market intelligence",
    title: "Market data your application can call, and your agent can use.",
    lede: "CoinTrac turns CoinMarketCap data into structured market intelligence. A REST API and an MCP server expose the same ten tools. Each result names its status, source time, freshness, and what the data plan did not include.",
    primaryCta: "Create an account",
    secondaryCta: "Read the API docs",
    problemTitle: "Your agent shouldn't guess prices. Give it evidence.",
    problemBody:
      "Market data can be current, delayed, cached, missing, or restricted by the data plan. CoinTrac keeps those states explicit. A missing price, volume, or return stays null. An unavailable series is not treated as a negative reading.",
    valueTitle: "What the platform separates",
    values: [
      {
        title: "Market intelligence",
        body: "Structured market overview, a deterministic market-regime classification, and asset and sector analysis from the same engine.",
      },
      {
        title: "Risk context",
        body: "Anomaly scans, derivatives context when the source provides it, and momentum and comparison across named assets.",
      },
      {
        title: "Evidence and traceability",
        body: "Each tool returns a structured evidence envelope. Saved evidence is readable only by the owning account. Shared public pages do not assign that record to a visitor.",
      },
    ],
    flowTitle: "How a request moves",
    flowLede: "One intelligence service answers the website, MCP clients, and direct API calls. The path does not promise a realtime feed.",
    flow: [
      { title: "Market data", body: "CoinMarketCap responses, including plan limits and missing fields." },
      { title: "Intelligence engine", body: "Deterministic Python analysis. No server-side language model writes the result." },
      { title: "MCP interface", body: "The same workflows are exposed as MCP tools and as REST routes." },
      { title: "Agent or developer", body: "A client reads the envelope, including status, data mode, freshness, and limitations." },
    ],
    flowNote: "Cached and fallback snapshots are labeled. They are not presented as a live tick.",
    mcpTitle: "MCP is the primary interface.",
    mcpLede: "The web application is a client of the same engine. It is not a second analysis product.",
    channels: [
      { title: "Web application", body: "Playground, evidence inspection, and this site call the existing API through the server proxy." },
      { title: "MCP clients", body: "A client that speaks Streamable HTTP can call the same ten tools when it has a key." },
      { title: "Developer workflows", body: "REST routes mirror the tools. Setup material stays on the Connect page." },
    ],
    mcpNote: "Antigravity is verified against the local MCP server. Other clients are not marked verified until they are tested.",
    previewTitle: "Capabilities in the current catalog",
    previewLede: "Four of the ten tools. Names and descriptions come from the product catalog.",
    previewLink: "See all capabilities",
    principlesTitle: "Engineering boundaries",
    principles: [
      { title: "Structured outputs", body: "Tools return an evidence envelope with status, summary, data, methodology, evidence, and limitations." },
      { title: "Evidence traceability", body: "A persisted record can be read back by its owner. The MCP evidence resource omits the raw excerpt." },
      { title: "Tenant isolation", body: "Ownership comes from a verified account or from the key’s stored owner. A client-supplied user id is not accepted as identity." },
      { title: "Explicit availability", body: "Restricted, partial, and insufficient-data results stay visible. Null is not replaced with zero." },
      { title: "Risk-aware reading", body: "The analysis describes market state. It does not guarantee a trading outcome." },
    ],
    closingTitle: "Read the catalog before you connect a client.",
    closingBody: "Start with the ten tools, then the integration status. Local MCP setup remains on the Connect page.",
    stageLabel: "Illustrative response shape",
    stageCaption:
      "This panel shows fields the engine returns. It is not a live market observation, and it is not evidence belonging to you.",
    stageLimitations: "Recorded with the result",
    docsCta: "Read the API docs",
    audiencesTitle: "Who it is for",
    audiences: [
      {
        title: "Developers",
        body: "Call the REST routes with an API key. The response is an evidence envelope, not an unstructured paragraph.",
      },
      {
        title: "Agent builders",
        body: "Point an MCP client at the local server. The same ten tools are available. Only Antigravity has a completed local test.",
      },
      {
        title: "Product teams",
        body: "Use the overview, movers, sectors, and asset tools as a data layer. CoinTrac does not place trades or give investment advice.",
      },
    ],
    pricingTitle: "What an account includes",
    pricingLede: "This repository configures one CoinTrac plan. There is no paid price and no checkout.",
    plans: [
      {
        title: "Free",
        body: "Signup provisions a free base plan. The server keeps every account on free. A user can hold 5 active API keys, and a new key allows 60 requests per minute.",
      },
      {
        title: "MCP",
        body: "MCP requires an API key. Tool calls use that key’s quota. A separate process-local frame limit is four times the key limit and does not replace the quota.",
      },
      {
        title: "CoinMarketCap",
        body: "The upstream key and its plan are separate. Historical OHLCV returns TIER_RESTRICTED on Basic and Startup plans. A cache hit records zero CoinTrac credit cost.",
      },
    ],
    pricingNote: "No paid CoinTrac upgrade is implemented. A public MCP hostname is not deployed.",
    faqTitle: "Questions",
    faq: [
      {
        question: "Does CoinTrac trade or predict prices?",
        answer: "No. It returns structured market intelligence. It does not execute orders, and it does not promise a forecast.",
      },
      {
        question: "What happens when a number is missing?",
        answer: "The field stays null and the limitation is listed. A missing price, volume, or return is not stored as zero.",
      },
      {
        question: "Which MCP clients are verified?",
        answer: "Antigravity IDE 2.7.0 was tested against the local server. Cursor and Claude have config examples and are not marked verified. ChatGPT and Gemini app sessions are not verified. The public HTTPS endpoint is not deployed.",
      },
      {
        question: "How does the website call the API?",
        answer: "The browser calls /api/cointrac on this site. That server route attaches the session. A direct client sends x-cointrac-key or a bearer token to the intelligence API. A key in the query string is rejected.",
      },
    ],
  },
  capabilities: {
    eyebrow: "Product catalog",
    title: "Ten tools, one engine.",
    lede: "Every MCP tool has a matching REST route. Descriptions below are the catalog text.",
    catalogNote: "Catalog descriptions are shown in their source English on every language setting.",
    groups: [
      {
        id: "market",
        title: "Market intelligence",
        body: "Overview, regime, single-asset analysis, and sector rotation.",
      },
      {
        id: "risk",
        title: "Risk context",
        body: "Screening, comparison, momentum, anomalies, and derivatives context.",
      },
      {
        id: "history",
        title: "Tier-restricted history",
        body: "Historical performance is implemented. On Basic and Startup CoinMarketCap plans it returns a tier restriction instead of a complete series.",
      },
    ],
    availabilityTitle: "How to read a result",
    availability: [
      { label: "OK", body: "The tool completed with the data the method requires." },
      { label: "PARTIAL", body: "Some fields are present and others are missing or proxied. Derivatives can return pair observations or a spot-stress proxy." },
      { label: "TIER_RESTRICTED", body: "The upstream plan does not include the series. Historical performance uses this status when OHLCV history is unavailable." },
      { label: "INSUFFICIENT_DATA", body: "The sample is too thin for the method. Sector rotation can mark a thin sector this way." },
    ],
    modesTitle: "Data mode is separate from the conclusion. LIVE, CACHED, and VERIFIED_SNAPSHOT_FALLBACK describe where the observation came from. Freshness is FRESH, AGING, or STALE. None of these modes turns a null into zero.",
    nextIntegrations: "View integrations",
    nextDocs: "Read the docs",
  },
  integrations: {
    eyebrow: "CoinTrac MCP clients",
    title: "Connect a client to the same engine.",
    lede: "MCP is a tool protocol. CoinTrac exposes one server. A page on this site is not itself a live connection.",
    conceptTitle: "What a connection is",
    conceptBody:
      "A client sends MCP requests to the intelligence service. Locally that service is the FastAPI app mounted at /mcp/. Authentication for MCP is an API key header. A verified local test used that header after OAuth discovery returned not found.",
    localTitle: "Local MCP",
    localBody:
      "The development server can serve MCP on this machine. The URL below is the configured local address, not a public endpoint.",
    publicTitle: "Public HTTPS endpoint",
    publicBody: "NOT DEPLOYED. There is no public DNS name or TLS endpoint for MCP in this repository.",
    connectCta: "Open MCP setup",
    statusTitle: "Compatibility from completed tests",
    client: "Client",
    status: "Status",
    detail: "What was observed",
    rows: [
      {
        name: "Antigravity",
        status: "VERIFIED — local MCP",
        detail: "Google Antigravity IDE 2.7.0 against http://127.0.0.1:8000/mcp/. Ten tools and three static resources. Direct template reads were partial because that client does not list resource templates.",
      },
      {
        name: "Antigravity prompt listing",
        status: "BLOCKED by client",
        detail: "The server registers three prompts. That Antigravity build has no prompt tool, so prompt listing was not completed.",
      },
      {
        name: "Cursor",
        status: "COMPATIBLE — NOT YET TESTED",
        detail: "A local config example exists. No completed Cursor session is recorded as verification.",
      },
      {
        name: "Claude",
        status: "COMPATIBLE — NOT YET TESTED",
        detail: "A local desktop config example exists. No completed Claude session is recorded as verification.",
      },
      {
        name: "ChatGPT",
        status: "PLANNED",
        detail: "No ChatGPT MCP session has been verified.",
      },
      {
        name: "Gemini",
        status: "PLANNED",
        detail: "No Gemini app session has been verified. Antigravity is a separate client.",
      },
      {
        name: "Public HTTPS MCP endpoint",
        status: "NOT DEPLOYED",
        detail: "Deployment is local. Do not use a placeholder domain as a connection URL.",
      },
    ],
  },
  docs: {
    eyebrow: "Documentation",
    title: "Start from the pages and files that exist.",
    lede: "Links below open routes in this application. Repository paths are citations, not hosted manuals.",
    open: "Open",
    source: "Repository source",
    planned: "Planned",
    apiIntro:
      "A direct client sends x-cointrac-key or a bearer token. The browser calls /api/cointrac. A key in the query string is rejected.",
    sections: [
      {
        title: "Getting started",
        body: "Sign in for account routes. MCP setup for a local client lives on Connect. The repository README describes the monorepo. Its deployment URL is still a placeholder.",
        links: [
          { href: "/login", label: "Sign in" },
          { href: "/connect", label: "MCP setup" },
        ],
        sources: ["README.md"],
      },
      {
        title: "MCP setup",
        body: "Use Connect for the local URL and client examples. This integrations page records which clients have actually been tested. Do not paste a live secret into a config.",
        links: [
          { href: "/connect", label: "Connect" },
          { href: "/integrations", label: "Compatibility" },
        ],
        sources: [
          "docs/ANTIGRAVITY_MCP_VERIFICATION.md",
          "docs/MCP_INTEGRATION_VERIFICATION.md",
          "docs/EXTERNAL_MCP_CLIENT_VERIFICATION.md",
          "examples/cursor_mcp_config.json",
          "examples/claude_desktop_config.json",
          "examples/python_rest_client.py",
        ],
      },
      {
        title: "Tool reference",
        body: "The capabilities page lists the ten tools, their REST paths, and the catalog descriptions, including the historical-performance restriction.",
        links: [{ href: "/capabilities", label: "Capabilities" }],
        sources: ["docs/MCP_CAPABILITY_AUDIT.md", "apps/web/src/lib/catalog.ts"],
      },
      {
        title: "Evidence and provenance",
        body: "Results use an evidence envelope. The inspector at /evidence calls the API with the signed-in session. Anonymous visitors are not shown another account’s records.",
        links: [{ href: "/evidence", label: "Evidence inspector" }],
        sources: ["docs/STAGE_5_2_1_IMPLEMENTATION_REPORT.md"],
      },
      {
        title: "Authentication",
        body: "The website uses Supabase sessions for account pages and for the API proxy. MCP clients use an API key. OAuth for remote MCP is not implemented.",
        links: [
          { href: "/login", label: "Sign in" },
          { href: "/signup", label: "Create an account" },
        ],
        sources: ["docs/STAGE_5_1_AUTH_IMPLEMENTATION_REPORT.md"],
      },
      {
        title: "API usage",
        body: "REST paths are listed beside each tool. When the intelligence process is running, its OpenAPI page is the local API reference. A public hosted API reference is not deployed.",
        links: [{ href: "/connect", label: "Routes and local API reference" }],
        sources: ["apps/intelligence/app/api/v1/router.py"],
      },
    ],
  },
};

const id: MarketingCopy = {
  home: {
    eyebrow: "Intelijen pasar kripto",
    title: "Data pasar yang bisa dipanggil aplikasi dan dipakai agen Anda.",
    lede: "CoinTrac mengubah data CoinMarketCap menjadi intelijen pasar terstruktur. API REST dan server MCP menyediakan sepuluh tool yang sama. Setiap hasil menyebut status, waktu sumber, kesegaran, dan apa yang tidak dicakup paket data.",
    primaryCta: "Buat akun",
    secondaryCta: "Baca dokumentasi API",
    problemTitle: "Agen Anda seharusnya tidak menebak harga. Beri bukti.",
    problemBody:
      "Data pasar bisa terkini, tertunda, tersimpan di cache, hilang, atau dibatasi paket data. CoinTrac mempertahankan status itu. Harga, volume, atau imbal hasil yang tidak ada tetap null. Deret yang tidak tersedia tidak dibaca sebagai sinyal negatif.",
    valueTitle: "Yang dipisahkan platform",
    values: [
      {
        title: "Intelijen pasar",
        body: "Ringkasan pasar terstruktur, klasifikasi rezim yang deterministik, serta analisis aset dan sektor dari mesin yang sama.",
      },
      {
        title: "Konteks risiko",
        body: "Pindai anomali, konteks derivatif saat sumber menyediakannya, serta momentum dan perbandingan antaraset yang disebutkan.",
      },
      {
        title: "Bukti dan ketertelusuran",
        body: "Setiap tool mengembalikan amplop bukti terstruktur. Bukti tersimpan hanya dapat dibaca pemiliknya. Halaman publik bersama tidak menautkan catatan itu ke pengunjung.",
      },
    ],
    flowTitle: "Jalur sebuah permintaan",
    flowLede: "Satu layanan intelijen menjawab situs, klien MCP, dan panggilan API langsung. Jalur ini tidak menjanjikan umpan realtime.",
    flow: [
      { title: "Data pasar", body: "Respons CoinMarketCap, termasuk batas paket dan kolom yang kosong." },
      { title: "Mesin intelijen", body: "Analisis Python yang deterministik. Tidak ada model bahasa di server yang menulis hasilnya." },
      { title: "Antarmuka MCP", body: "Alur yang sama tersedia sebagai tool MCP dan rute REST." },
      { title: "Agen atau developer", body: "Klien membaca amplop, termasuk status, mode data, kesegaran, dan keterbatasan." },
    ],
    flowNote: "Cuplikan cache dan fallback diberi label. Keduanya bukan tick langsung.",
    mcpTitle: "MCP adalah antarmuka utama.",
    mcpLede: "Aplikasi web adalah klien dari mesin yang sama. Ia bukan produk analisis kedua.",
    channels: [
      { title: "Aplikasi web", body: "Playground, inspeksi bukti, dan situs ini memanggil API yang ada melalui proxy server." },
      { title: "Klien MCP", body: "Klien Streamable HTTP dapat memanggil sepuluh tool yang sama bila memiliki kunci." },
      { title: "Alur developer", body: "Rute REST mencerminkan tool. Materi penyiapan tetap di halaman Connect." },
    ],
    mcpNote: "Antigravity terverifikasi terhadap server MCP lokal. Klien lain tidak ditandai terverifikasi sebelum diuji.",
    previewTitle: "Kapabilitas pada katalog saat ini",
    previewLede: "Empat dari sepuluh tool. Nama dan deskripsi berasal dari katalog produk.",
    previewLink: "Lihat semua kapabilitas",
    principlesTitle: "Batas rekayasa",
    principles: [
      { title: "Keluaran terstruktur", body: "Tool mengembalikan amplop bukti dengan status, ringkasan, data, metodologi, bukti, dan keterbatasan." },
      { title: "Jejak bukti", body: "Catatan yang tersimpan dapat dibaca kembali oleh pemiliknya. Resource bukti MCP tidak menyertakan cuplikan mentah." },
      { title: "Isolasi tenant", body: "Kepemilikan berasal dari akun terverifikasi atau pemilik yang tersimpan pada kunci. Id pengguna dari klien tidak diterima sebagai identitas." },
      { title: "Ketersediaan yang eksplisit", body: "Hasil terbatas, parsial, dan data tidak cukup tetap terlihat. Null tidak diganti nol." },
      { title: "Pembacaan yang sadar risiko", body: "Analisis menggambarkan keadaan pasar. Ia tidak menjamin hasil trading." },
    ],
    closingTitle: "Baca katalog sebelum menghubungkan klien.",
    closingBody: "Mulai dari sepuluh tool, lalu status integrasi. Penyiapan MCP lokal tetap di halaman Connect.",
    stageLabel: "Bentuk respons ilustratif",
    stageCaption:
      "Panel ini menampilkan kolom yang dikembalikan mesin. Ini bukan pengamatan pasar langsung, dan bukan bukti milik Anda.",
    stageLimitations: "Tercatat bersama hasil",
    docsCta: "Baca dokumentasi API",
    audiencesTitle: "Untuk siapa",
    audiences: [
      {
        title: "Developer",
        body: "Panggil rute REST dengan kunci API. Responsnya adalah amplop bukti, bukan paragraf bebas.",
      },
      {
        title: "Pembuat agen",
        body: "Arahkan klien MCP ke server lokal. Sepuluh tool yang sama tersedia. Hanya Antigravity yang memiliki uji lokal yang selesai.",
      },
      {
        title: "Tim produk",
        body: "Pakai ringkasan, penggerak, sektor, dan tool aset sebagai lapisan data. CoinTrac tidak mengeksekusi transaksi dan tidak memberi nasihat investasi.",
      },
    ],
    pricingTitle: "Yang termasuk dalam akun",
    pricingLede: "Repositori ini mengonfigurasi satu paket CoinTrac. Tidak ada harga berbayar dan tidak ada checkout.",
    plans: [
      {
        title: "Gratis",
        body: "Pendaftaran menyediakan paket dasar gratis. Server menahan setiap akun pada paket gratis. Satu pengguna dapat memiliki 5 kunci API aktif, dan kunci baru mengizinkan 60 permintaan per menit.",
      },
      {
        title: "MCP",
        body: "MCP membutuhkan kunci API. Panggilan tool memakai kuota kunci itu. Batas frame di proses sebesar empat kali batas kunci tidak menggantikan kuota.",
      },
      {
        title: "CoinMarketCap",
        body: "Kunci hulu dan paketnya terpisah. OHLCV historis mengembalikan TIER_RESTRICTED pada paket Basic dan Startup. Hit cache mencatat biaya kredit CoinTrac nol.",
      },
    ],
    pricingNote: "Peningkatan CoinTrac berbayar belum diimplementasikan. Nama host MCP publik belum diterapkan.",
    faqTitle: "Pertanyaan",
    faq: [
      {
        question: "Apakah CoinTrac berdagang atau memprediksi harga?",
        answer: "Tidak. Ia mengembalikan intelijen pasar terstruktur. Ia tidak mengeksekusi order dan tidak menjanjikan prakiraan.",
      },
      {
        question: "Apa yang terjadi jika sebuah angka tidak ada?",
        answer: "Kolom tetap null dan keterbatasannya dicantumkan. Harga, volume, atau imbal hasil yang hilang tidak disimpan sebagai nol.",
      },
      {
        question: "Klien MCP mana yang terverifikasi?",
        answer: "Antigravity IDE 2.7.0 diuji terhadap server lokal. Cursor dan Claude memiliki contoh konfigurasi dan belum ditandai terverifikasi. Sesi ChatGPT dan aplikasi Gemini belum terverifikasi. Endpoint HTTPS publik belum diterapkan.",
      },
      {
        question: "Bagaimana situs memanggil API?",
        answer: "Peramban memanggil /api/cointrac di situs ini. Rute server itu menambahkan sesi. Klien langsung mengirim x-cointrac-key atau token bearer ke API intelijen. Kunci di query string ditolak.",
      },
    ],
  },
  capabilities: {
    eyebrow: "Katalog produk",
    title: "Sepuluh tool, satu mesin.",
    lede: "Setiap tool MCP memiliki rute REST yang sepadan. Deskripsi di bawah adalah teks katalog.",
    catalogNote: "Deskripsi katalog ditampilkan dalam bahasa Inggris sumber pada semua pengaturan bahasa.",
    groups: [
      {
        id: "market",
        title: "Intelijen pasar",
        body: "Ringkasan, rezim, analisis satu aset, dan rotasi sektor.",
      },
      {
        id: "risk",
        title: "Konteks risiko",
        body: "Penyaringan, perbandingan, momentum, anomali, dan konteks derivatif.",
      },
      {
        id: "history",
        title: "Riwayat yang terbatas paket",
        body: "Kinerja historis sudah diimplementasikan. Pada paket Basic dan Startup CoinMarketCap, tool ini mengembalikan pembatasan paket, bukan deret yang lengkap.",
      },
    ],
    availabilityTitle: "Cara membaca hasil",
    availability: [
      { label: "OK", body: "Tool selesai dengan data yang dibutuhkan metodenya." },
      { label: "PARTIAL", body: "Sebagian kolom ada dan sebagian hilang atau memakai proksi. Derivatif dapat mengembalikan pengamatan pasangan atau proksi tekanan spot." },
      { label: "TIER_RESTRICTED", body: "Paket hulu tidak mencakup deret itu. Kinerja historis memakai status ini saat riwayat OHLCV tidak tersedia." },
      { label: "INSUFFICIENT_DATA", body: "Sampel terlalu tipis untuk metode tersebut. Rotasi sektor dapat menandai sektor yang tipis dengan status ini." },
    ],
    modesTitle: "Mode data terpisah dari kesimpulan. LIVE, CACHED, dan VERIFIED_SNAPSHOT_FALLBACK menjelaskan asal pengamatan. Kesegaran adalah FRESH, AGING, atau STALE. Tidak satu pun mode ini mengubah null menjadi nol.",
    nextIntegrations: "Lihat integrasi",
    nextDocs: "Baca dokumentasi",
  },
  integrations: {
    eyebrow: "Klien CoinTrac MCP",
    title: "Hubungkan klien ke mesin yang sama.",
    lede: "MCP adalah protokol tool. CoinTrac menyediakan satu server. Halaman di situs ini sendiri bukan koneksi yang sedang hidup.",
    conceptTitle: "Apa yang disebut koneksi",
    conceptBody:
      "Klien mengirim permintaan MCP ke layanan intelijen. Secara lokal layanan itu adalah aplikasi FastAPI pada /mcp/. Autentikasi MCP memakai header kunci API. Uji lokal yang terverifikasi memakai header itu setelah penemuan OAuth mengembalikan tidak ditemukan.",
    localTitle: "MCP lokal",
    localBody:
      "Server pengembangan dapat melayani MCP di mesin ini. URL di bawah adalah alamat lokal yang dikonfigurasi, bukan endpoint publik.",
    publicTitle: "Endpoint HTTPS publik",
    publicBody: "NOT DEPLOYED. Repositori ini tidak memiliki nama DNS publik atau endpoint TLS untuk MCP.",
    connectCta: "Buka penyiapan MCP",
    statusTitle: "Kompatibilitas dari pengujian yang selesai",
    client: "Klien",
    status: "Status",
    detail: "Yang diamati",
    rows: [
      {
        name: "Antigravity",
        status: "VERIFIED — local MCP",
        detail: "Google Antigravity IDE 2.7.0 terhadap http://127.0.0.1:8000/mcp/. Sepuluh tool dan tiga resource statis. Pembacaan template langsung bersifat parsial karena klien itu tidak mendaftarkan resource template.",
      },
      {
        name: "Antigravity prompt listing",
        status: "BLOCKED by client",
        detail: "Server mendaftarkan tiga prompt. Build Antigravity itu tidak memiliki tool prompt, sehingga pendaftaran prompt tidak selesai.",
      },
      {
        name: "Cursor",
        status: "COMPATIBLE — NOT YET TESTED",
        detail: "Contoh konfigurasi lokal ada. Tidak ada sesi Cursor yang selesai dan dicatat sebagai verifikasi.",
      },
      {
        name: "Claude",
        status: "COMPATIBLE — NOT YET TESTED",
        detail: "Contoh konfigurasi desktop lokal ada. Tidak ada sesi Claude yang selesai dan dicatat sebagai verifikasi.",
      },
      {
        name: "ChatGPT",
        status: "PLANNED",
        detail: "Tidak ada sesi MCP ChatGPT yang terverifikasi.",
      },
      {
        name: "Gemini",
        status: "PLANNED",
        detail: "Tidak ada sesi aplikasi Gemini yang terverifikasi. Antigravity adalah klien yang terpisah.",
      },
      {
        name: "Public HTTPS MCP endpoint",
        status: "NOT DEPLOYED",
        detail: "Penerapan masih lokal. Jangan memakai domain placeholder sebagai URL koneksi.",
      },
    ],
  },
  docs: {
    eyebrow: "Dokumentasi",
    title: "Mulai dari halaman dan berkas yang ada.",
    lede: "Tautan di bawah membuka rute aplikasi ini. Path repositori adalah sitasi, bukan manual yang di-host.",
    open: "Buka",
    source: "Sumber repositori",
    planned: "Direncanakan",
    apiIntro:
      "Klien langsung mengirim x-cointrac-key atau token bearer. Peramban memanggil /api/cointrac. Kunci di query string ditolak.",
    sections: [
      {
        title: "Mulai",
        body: "Masuk untuk rute akun. Penyiapan MCP untuk klien lokal ada di Connect. README repositori menjelaskan monorepo. URL penerapannya masih placeholder.",
        links: [
          { href: "/login", label: "Masuk" },
          { href: "/connect", label: "Penyiapan MCP" },
        ],
        sources: ["README.md"],
      },
      {
        title: "Penyiapan MCP",
        body: "Pakai Connect untuk URL lokal dan contoh klien. Halaman integrasi mencatat klien yang benar-benar sudah diuji. Jangan menempelkan rahasia yang masih aktif ke konfigurasi.",
        links: [
          { href: "/connect", label: "Connect" },
          { href: "/integrations", label: "Kompatibilitas" },
        ],
        sources: [
          "docs/ANTIGRAVITY_MCP_VERIFICATION.md",
          "docs/MCP_INTEGRATION_VERIFICATION.md",
          "docs/EXTERNAL_MCP_CLIENT_VERIFICATION.md",
          "examples/cursor_mcp_config.json",
          "examples/claude_desktop_config.json",
          "examples/python_rest_client.py",
        ],
      },
      {
        title: "Referensi tool",
        body: "Halaman kapabilitas memuat sepuluh tool, path REST, dan deskripsi katalog, termasuk pembatasan kinerja historis.",
        links: [{ href: "/capabilities", label: "Kapabilitas" }],
        sources: ["docs/MCP_CAPABILITY_AUDIT.md", "apps/web/src/lib/catalog.ts"],
      },
      {
        title: "Bukti dan provenance",
        body: "Hasil memakai amplop bukti. Inspektur di /evidence memanggil API dengan sesi yang sudah masuk. Pengunjung anonim tidak melihat catatan akun lain.",
        links: [{ href: "/evidence", label: "Inspektur bukti" }],
        sources: ["docs/STAGE_5_2_1_IMPLEMENTATION_REPORT.md"],
      },
      {
        title: "Autentikasi",
        body: "Situs memakai sesi Supabase untuk halaman akun dan proxy API. Klien MCP memakai kunci API. OAuth untuk MCP jarak jauh belum diimplementasikan.",
        links: [
          { href: "/login", label: "Masuk" },
          { href: "/signup", label: "Buat akun" },
        ],
        sources: ["docs/STAGE_5_1_AUTH_IMPLEMENTATION_REPORT.md"],
      },
      {
        title: "Pemakaian API",
        body: "Path REST tercantum di samping setiap tool. Saat proses intelijen berjalan, halaman OpenAPI-nya adalah referensi API lokal. Referensi API publik yang di-host belum diterapkan.",
        links: [{ href: "/connect", label: "Rute dan referensi API lokal" }],
        sources: ["apps/intelligence/app/api/v1/router.py"],
      },
    ],
  },
};

export const MARKETING: Record<Locale, MarketingCopy> = { en, id };

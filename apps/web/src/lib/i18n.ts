export type Locale = "en" | "id";

export const LOCALE_PREFERENCE_KEY = "tg_locale";

export function parseLocale(value: string | null | undefined): Locale {
  return value === "id" || value === "en" ? value : "en";
}

export interface Dictionary {
  nav: {
    overview: string;
    playground: string;
    evidence: string;
    connect: string;
    skipToContent: string;
    switchToLight: string;
    switchToDark: string;
    toggleMenu: string;
    toggleTheme: string;
    subtitle: string;
    capabilities: string;
    integrations: string;
    docs: string;
    pricing: string;
    explore: string;
    signIn: string;
  };
  footer: {
    engine: string;
    tagline: string;
    product: string;
    developers: string;
    trust: string;
    capabilities: string;
    integrations: string;
    docs: string;
    playground: string;
    connect: string;
    evidence: string;
    login: string;
    privacy: string;
    terms: string;
    status: string;
    contact: string;
    note: string;
  };
  common: {
    copy: string;
    copied: string;
    refresh: string;
    inspect: string;
    run: string;
    running: string;
    ready: string;
    close: string;
    allModes: string;
    unavailable: string;
    offline: string;
    apiOk: string;
    calls: string;
    credits: string;
  };
  overview: {
    badge: string;
    heroTitlePrefix: string;
    heroTitleAccent: string;
    heroDesc: string;
    ctaPlayground: string;
    ctaConnect: string;
    totalMarketCap: string;
    vol24h: string;
    btcEthDom: string;
    dataPipeline: string;
    cacheHit: string;
    avgLatency: string;
    telemetryCredits: string;
    regimeLabel: string;
    regimePending: string;
    regimeFallbackDesc: string;
    sentimentBreadth: string;
    top50Breadth: string;
    btcOutperforming: string;
    altsOutperforming: string;
    btcVsMedianMissing: string;
    topGainers: string;
    topLosers: string;
    spotUsd: string;
    sectorHeading: string;
    sectorDesc: string;
    colSector: string;
    colAssets: string;
    colMedian24h: string;
    colMedian7d: string;
    colCapWtd7d: string;
    colBreadth: string;
    colVolShare: string;
    colSignal: string;
    actionPlaygroundTitle: string;
    actionPlaygroundDesc: string;
    actionEvidenceTitle: string;
    actionEvidenceDesc: string;
    actionConnectTitle: string;
    actionConnectDesc: string;
    feedUnavailable: string;
    positive: string;
    rwaSpotlight: string;
    negative: string;
    rankedBy: string;
    topSector: string;
    noSectorData: string;
    autoRefreshOn: string;
    autoRefreshPaused: string;
    lastSynced: string;
    refreshing: string;
    smartCacheHint: string;
  };
  playground: {
    badge: string;
    title: string;
    desc: string;
    presetsHeading: string;
    presetsHint: string;
    toolRunnerLabel: string;
    quoteCurrency: string;
    symbolsLabel: string;
    assetSymbolLabel: string;
    dailyCandlesLabel: string;
    universeSizeLabel: string;
    minMcap: string;
    minVol: string;
    maxGain: string;
    minVolToMcap: string;
    minRs7d: string;
    limitLabel: string;
    rankByLabel: string;
    sectorsSelected: string;
    runTool: string;
    executing: string;
    byokTitle: string;
    byokInMemory: string;
    byokLabel: string;
    byokPlaceholder: string;
    byokHint: string;
    tabReport: string;
    tabJson: string;
    tabEvidence: string;
    emptyTitle: string;
    emptyDesc: string;
    runningBanner: string;
    limitationsTitle: string;
    openEvidence: string;
    endpointsCalled: string;
    sourceTimestamps: string;
    methodologyTitle: string;
    retrievedUtc: string;
    creditCost: string;
    servedFromCache: string;
    upstreamLiveCall: string;
    observationWindow: string;
    engineVersion: string;
    noMoversMatched: string;
  };
  evidence: {
    badge: string;
    title: string;
    desc: string;
    searchLabel: string;
    searchPlaceholder: string;
    lookupLabel: string;
    showingPrefix: string;
    of: string;
    recordsSuffix: string;
    emptyNoRecords: string;
    emptyNoMatch: string;
    emptyHint: string;
    colEvidenceId: string;
    colTool: string;
    colDataMode: string;
    colFreshness: string;
    colEndpoints: string;
    colCredits: string;
    colCreatedUtc: string;
    drawerSubtitle: string;
    createdUtc: string;
    canonicalIds: string;
    methodology: string;
    recordedLimitations: string;
    rawExcerpt: string;
    loadingRecord: string;
    copyId: string;
  };
  connect: {
    badge: string;
    title: string;
    descPrefix: string;
    descSuffix: string;
    openApiBtn: string;
    snippetsHeading: string;
    copySnippet: string;
    toolsHeading: string;
    toolsHint: string;
    colMcpTool: string;
    colRestEndpoint: string;
    colCapability: string;
    colRouting: string;
    resourcesHeading: string;
    promptsHeading: string;
    noArgs: string;
    argsPrefix: string;
  };
}

export const DICTIONARIES: Record<Locale, Dictionary> = {
  en: {
    nav: {
      overview: "Overview",
      playground: "Playground",
      evidence: "Evidence",
      connect: "Connect",
      skipToContent: "Skip to content",
      switchToLight: "Switch to light mode",
      switchToDark: "Switch to dark mode",
      toggleMenu: "Toggle navigation menu",
      toggleTheme: "Toggle color theme",
      subtitle: "Quant MCP",
      capabilities: "Product",
      integrations: "MCP",
      docs: "API",
      pricing: "Pricing",
      explore: "Get started",
      signIn: "Sign in",
    },
    footer: {
      engine: "365d Annualized Quant Engine",
      tagline: "Structured crypto market data for applications and MCP clients. Missing values stay empty.",
      product: "Product",
      developers: "Developers",
      trust: "Trust & Support",
      capabilities: "Product",
      integrations: "MCP",
      docs: "API",
      playground: "Playground",
      connect: "MCP setup",
      evidence: "Evidence inspector",
      login: "Sign in",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
      status: "API Health Status",
      contact: "support@cointrac.xyz",
      note: "© 2026 CoinTrac. All rights reserved.",
    },
    common: {
      copy: "Copy",
      copied: "Copied",
      refresh: "Refresh",
      inspect: "Inspect",
      run: "Run",
      running: "Running...",
      ready: "Ready · Select a preset or tool",
      close: "Close",
      allModes: "All Modes",
      unavailable: "Unavailable",
      offline: "OFFLINE",
      apiOk: "API OK",
      calls: "calls",
      credits: "credits",
    },
    overview: {
      badge: "Build with CMC · Deterministic Market Intelligence MCP",
      heroTitlePrefix: "Institutional crypto intelligence,",
      heroTitleAccent: "with proof on every figure.",
      heroDesc:
        "Real-time market regime detection, anti-chase momentum screening, and 7-sector rotation powered by CoinMarketCap APIs — built with fixed formulas in Python (no LLM in market calculations; CoinTrac AI Analyst is an optional separate chat layer).",
      ctaPlayground: "Launch MCP Playground",
      ctaConnect: "Connect Agent",
      totalMarketCap: "Total Crypto Market Cap",
      vol24h: "24h Vol",
      btcEthDom: "BTC / ETH Dominance",
      dataPipeline: "Data Pipeline",
      cacheHit: "Cache hit",
      avgLatency: "Avg",
      telemetryCredits: "Telemetry & Credits",
      regimeLabel: "Market Regime Classifier",
      regimePending: "Regime Pending",
      regimeFallbackDesc:
        "Deterministic 4-signal regime classification using CoinMarketCap global metrics, BTC dominance delta, Fear & Greed, and Top-50 breadth.",
      sentimentBreadth: "Sentiment & Breadth",
      top50Breadth: "Top-50 Positive Breadth",
      btcOutperforming: "BTC currently outperforming median altcoin",
      altsOutperforming: "Altcoins outperforming BTC median",
      btcVsMedianMissing: "BTC vs median altcoin: —",
      topGainers: "Top-50 Gainers (24h)",
      topLosers: "Top-50 Losers (24h)",
      spotUsd: "Spot USD",
      sectorHeading: "Sector Rotation & RWA Pulse",
      sectorDesc:
        "Median and cap-weighted performance across 7 canonical crypto narratives with Real World Assets highlighted.",
      colSector: "Sector",
      colAssets: "Assets",
      colMedian24h: "Median 24h",
      colMedian7d: "Median 7d",
      colCapWtd7d: "Cap-Wtd 7d",
      colBreadth: "Breadth",
      colVolShare: "Vol Share",
      colSignal: "Signal",
      actionPlaygroundTitle: "Interactive MCP Playground",
      actionPlaygroundDesc:
        "Execute 4 one-click judge presets or any of the 10 REST tools with JSON and evidence inspection.",
      actionEvidenceTitle: "CMC Evidence Inspector",
      actionEvidenceDesc:
        "Audit exact CoinMarketCap endpoints, UTC timestamps, credit spend, and sanitized excerpts.",
      actionConnectTitle: "Connect Claude, Cursor & Bots",
      actionConnectDesc:
        "Copy Streamable HTTP/stdio MCP configs, Python bot snippets, and full 11-tool documentation.",
      feedUnavailable: "Live intelligence feed unavailable",
      positive: "Positive",
      rwaSpotlight: "RWA Spotlight",
      negative: "Negative",
      rankedBy: "Ranked by",
      topSector: "Top sector",
      noSectorData: "No numeric figures returned for the selected sectors.",
      autoRefreshOn: "Auto 2m · Active Tab",
      autoRefreshPaused: "Auto Paused",
      lastSynced: "Synced",
      refreshing: "Refreshing...",
      smartCacheHint: "Shared Top-200 cache · 0 idle calls",
    },
    playground: {
      badge: "MCP tool studio",
      title: "Playground",
      desc: "Inspect the 10 REST tools and the four presets. A signed-in session is required to execute. The result is the evidence envelope returned by the engine.",
      presetsHeading: "Presets",
      presetsHint: "Execution uses your verified session.",
      toolRunnerLabel: "REST Tool Runner (10 tools)",
      quoteCurrency: "Quote Currency",
      symbolsLabel: "Symbols (comma-separated)",
      assetSymbolLabel: "Asset Symbol",
      dailyCandlesLabel: "Daily Candles (5–90)",
      universeSizeLabel: "Universe Size (10–200)",
      minMcap: "Min MCap ($)",
      minVol: "Min Vol 24h ($)",
      maxGain: "Max 24h Gain (%)",
      minVolToMcap: "Min Vol/MCap",
      minRs7d: "Min RS BTC 7d",
      limitLabel: "Limit (1–50)",
      rankByLabel: "Rank By",
      sectorsSelected: "Sectors",
      runTool: "Run",
      executing: "Executing",
      byokTitle: "Use Your Own CMC Key (BYOK)",
      byokInMemory: "In Memory",
      byokLabel: "x-cmc-api-key (Memory Only)",
      byokPlaceholder: "Optional CMC Pro API key",
      byokHint:
        "Held strictly in React component state (never written to localStorage or cookies). Forwarded in memory and stripped from logs and evidence rows.",
      tabReport: "Report",
      tabJson: "JSON",
      tabEvidence: "Evidence",
      emptyTitle: "Pick a preset or run a tool",
      emptyDesc:
        "Results show the formatted report, raw JSON, and evidence metadata. Missing values stay null.",
      runningBanner: "Running the selected tool...",
      limitationsTitle: "Data Limitations & Honest Disclosure",
      openEvidence: "Open in Evidence Inspector",
      endpointsCalled: "CMC Endpoints Called",
      sourceTimestamps: "Source Timestamps",
      methodologyTitle: "Methodology Formulas",
      retrievedUtc: "Retrieved UTC",
      creditCost: "CMC Credit Cost",
      servedFromCache: "Served from cache",
      upstreamLiveCall: "Upstream live call",
      observationWindow: "Observation Window",
      engineVersion: "Engine Version",
      noMoversMatched:
        "No assets satisfied all screening thresholds. Try widening max_24h_gain_pct or lowering liquidity floors.",
    },
    evidence: {
      badge: "Audit Provenance · Persisted in Supabase",
      title: "Evidence Inspector",
      desc: "Every MCP tool call and REST intelligence request persists an audit row in evidence_records. Click any row to verify upstream CoinMarketCap endpoints, UTC timestamps, credit cost, methodology, and sanitized excerpts.",
      searchLabel: "Search Audit Trail",
      searchPlaceholder: "evidence_id, tool name, or /v2/cryptocurrency/...",
      lookupLabel: "Direct ID Lookup",
      showingPrefix: "Showing",
      of: "of",
      recordsSuffix: "records",
      emptyNoRecords: "No persisted evidence records available yet",
      emptyNoMatch: "No records match the current filter",
      emptyHint:
        "Run a signed-in analysis in the Playground. The evidence id belongs to that account.",
      colEvidenceId: "Evidence ID",
      colTool: "Tool",
      colDataMode: "Data Mode",
      colFreshness: "Freshness",
      colEndpoints: "CMC Endpoints",
      colCredits: "Credits",
      colCreatedUtc: "Created UTC",
      drawerSubtitle: "Evidence Provenance Record",
      createdUtc: "Created UTC",
      canonicalIds: "Canonical CMC IDs",
      methodology: "Methodology",
      recordedLimitations: "Recorded Limitations",
      rawExcerpt: "Sanitized Raw CMC Excerpt",
      loadingRecord: "Loading evidence record...",
      copyId: "Copy ID",
    },
    connect: {
      badge: "Developer Connect Hub · Streamable HTTP + stdio + REST",
      title: "Connect CoinTrac to Your AI Agent",
      descPrefix: "Streamable HTTP MCP server mounted at",
      descSuffix:
        "sharing one single intelligence service layer with authenticated REST endpoints.",
      openApiBtn: "FastAPI OpenAPI /docs",
      snippetsHeading: "Quickstart Configs & Clients",
      copySnippet: "Copy snippet",
      toolsHeading: "14 MCP tools, 10+ REST routes",
      toolsHint: "Single source of truth · Canonical EvidenceEnvelope[T]",
      colMcpTool: "MCP Tool",
      colRestEndpoint: "REST Endpoint",
      colCapability: "Capability",
      colRouting: "Routing Boundary",
      resourcesHeading: "6 MCP Resources (application/json)",
      promptsHeading: "3 MCP Prompts (Evidence-Cited Workflows)",
      noArgs: "no arguments",
      argsPrefix: "args",
    },
  },
  id: {
    nav: {
      overview: "Ringkasan",
      playground: "Playground",
      evidence: "Bukti API",
      connect: "Koneksi",
      skipToContent: "Lompat ke konten utama",
      switchToLight: "Beralih ke mode terang",
      switchToDark: "Beralih ke mode gelap",
      toggleMenu: "Buka menu navigasi",
      toggleTheme: "Ubah tema warna",
      subtitle: "Quant MCP",
      capabilities: "Produk",
      integrations: "MCP",
      docs: "API",
      pricing: "Harga",
      explore: "Mulai",
      signIn: "Masuk",
    },
    footer: {
      engine: "Mesin Kuantitatif Tahunan 365h",
      tagline: "Data pasar kripto terstruktur untuk aplikasi dan klien MCP. Nilai yang tidak ada tetap kosong.",
      product: "Produk",
      developers: "Developer",
      trust: "Kepercayaan & Bantuan",
      capabilities: "Produk",
      integrations: "MCP",
      docs: "API",
      playground: "Playground",
      connect: "Penyiapan MCP",
      evidence: "Inspektur bukti",
      login: "Masuk",
      privacy: "Kebijakan Privasi",
      terms: "Ketentuan Layanan",
      status: "Status Kesehatan API",
      contact: "support@cointrac.xyz",
      note: "© 2026 CoinTrac. All rights reserved.",
    },
    common: {
      copy: "Salin",
      copied: "Tersalin",
      refresh: "Muat Ulang",
      inspect: "Periksa",
      run: "Jalankan",
      running: "Menjalankan...",
      ready: "Siap · Pilih preset atau tool",
      close: "Tutup",
      allModes: "Semua Mode",
      unavailable: "Tidak Tersedia",
      offline: "OFFLINE",
      apiOk: "API AKTIF",
      calls: "panggilan",
      credits: "kredit",
    },
    overview: {
      badge: "Build with CMC · Intelijen Pasar Kripto MCP Deterministik",
      heroTitlePrefix: "Intelijen kripto institusional,",
      heroTitleAccent: "dengan bukti di setiap angka.",
      heroDesc:
        "Klasifikasi rezim pasar real-time, penyaring momentum anti-kejar, dan rotasi 7 sektor berbasis API CoinMarketCap — menggunakan rumus Python deterministik (tanpa LLM pada kalkulasi pasar; CoinTrac AI Analyst adalah lapisan chat terpisah).",
      ctaPlayground: "Buka MCP Playground",
      ctaConnect: "Hubungkan Agen",
      totalMarketCap: "Total Kapitalisasi Pasar Kripto",
      vol24h: "Vol 24j",
      btcEthDom: "Dominasi BTC / ETH",
      dataPipeline: "Pipeline Data",
      cacheHit: "Cache hit",
      avgLatency: "Rata-rata",
      telemetryCredits: "Telemetri & Kredit",
      regimeLabel: "Klasifikasi Rezim Pasar",
      regimePending: "Menunggu Rezim",
      regimeFallbackDesc:
        "Klasifikasi rezim 4-sinyal deterministik memakai metrik global CoinMarketCap, perubahan dominasi BTC, Fear & Greed, dan breadth Top-50.",
      sentimentBreadth: "Sentimen & Breadth",
      top50Breadth: "Breadth Positif Top-50",
      btcOutperforming: "BTC saat ini mengungguli median altcoin",
      altsOutperforming: "Altcoin mengungguli median BTC",
      btcVsMedianMissing: "BTC vs median altcoin: —",
      topGainers: "Top-50 Penguatan (24j)",
      topLosers: "Top-50 Pelemahan (24j)",
      spotUsd: "Spot USD",
      sectorHeading: "Rotasi Sektor & Sorotan RWA",
      sectorDesc:
        "Performa median dan berbobot kapitalisasi lintas 7 narasi kripto utama dengan sorotan khusus pada Real World Assets (RWA).",
      colSector: "Sektor",
      colAssets: "Aset",
      colMedian24h: "Median 24j",
      colMedian7d: "Median 7h",
      colCapWtd7d: "Bobot Cap 7h",
      colBreadth: "Breadth",
      colVolShare: "Porsi Vol",
      colSignal: "Sinyal",
      actionPlaygroundTitle: "Interactive MCP Playground",
      actionPlaygroundDesc:
        "Jalankan 4 preset 1-klik atau pilih 10 tool REST dengan inspeksi JSON dan bukti API.",
      actionEvidenceTitle: "Inspektor Bukti CMC",
      actionEvidenceDesc:
        "Audit endpoint CoinMarketCap, timestamp UTC, biaya kredit, dan cuplikan data tersanitasi.",
      actionConnectTitle: "Hubungkan Claude, Cursor & Bot",
      actionConnectDesc:
        "Salin konfigurasi MCP Streamable HTTP/stdio, skrip bot Python, dan referensi 14 tool lengkap.",
      feedUnavailable: "Feed intelijen live tidak tersedia",
      positive: "Positif",
      rwaSpotlight: "Sorotan RWA",
      negative: "Negatif",
      rankedBy: "Diurutkan berdasarkan",
      topSector: "Sektor terkuat",
      noSectorData: "Tidak ada angka metrik untuk sektor yang dipilih.",
      autoRefreshOn: "Auto 2m · Tab Aktif",
      autoRefreshPaused: "Auto Dijeda",
      lastSynced: "Sinkron",
      refreshing: "Memperbarui...",
      smartCacheHint: "Cache Top-200 bersama · 0 panggilan idle",
    },
    playground: {
      badge: "Studio tool MCP",
      title: "Playground",
      desc: "Periksa 10 tool REST dan empat preset. Sesi yang sudah masuk diperlukan untuk menjalankan. Hasilnya adalah amplop bukti yang dikembalikan mesin.",
      presetsHeading: "Preset",
      presetsHint: "Eksekusi memakai sesi terverifikasi Anda.",
      toolRunnerLabel: "Eksekutor Tool REST (10 tool)",
      quoteCurrency: "Mata Uang Kuotasi",
      symbolsLabel: "Simbol Aset (pisah koma)",
      assetSymbolLabel: "Simbol Aset",
      dailyCandlesLabel: "Candle Harian (5–90)",
      universeSizeLabel: "Ukuran Semesta (10–200)",
      minMcap: "Min MCap ($)",
      minVol: "Min Vol 24j ($)",
      maxGain: "Maks Naik 24j (%)",
      minVolToMcap: "Min Vol/MCap",
      minRs7d: "Min RS BTC 7h",
      limitLabel: "Batas (1–50)",
      rankByLabel: "Urutkan Berdasarkan",
      sectorsSelected: "Sektor",
      runTool: "Jalankan",
      executing: "Menjalankan",
      byokTitle: "Pakai Kunci CMC Sendiri (BYOK)",
      byokInMemory: "Di Memori",
      byokLabel: "x-cmc-api-key (Hanya di Memori)",
      byokPlaceholder: "Kunci CMC Pro API opsional",
      byokHint:
        "Hanya disimpan di state React (tidak pernah ditulis ke localStorage atau cookie). Diteruskan di memori dan dihapus dari log maupun bukti.",
      tabReport: "Laporan",
      tabJson: "JSON",
      tabEvidence: "Bukti",
      emptyTitle: "Pilih preset atau jalankan tool",
      emptyDesc:
        "Hasil menampilkan laporan rapi, JSON mentah, dan metadata bukti. Data yang kosong tetap null.",
      runningBanner: "Menjalankan tool yang dipilih...",
      limitationsTitle: "Keterbatasan Data & Pengungkapan Jujur",
      openEvidence: "Buka di Inspektor Bukti",
      endpointsCalled: "Endpoint CMC yang Dipanggil",
      sourceTimestamps: "Timestamp Sumber",
      methodologyTitle: "Rumus Metodologi",
      retrievedUtc: "Diambil UTC",
      creditCost: "Biaya Kredit CMC",
      servedFromCache: "Dilayani dari cache",
      upstreamLiveCall: "Panggilan live upstream",
      observationWindow: "Jendela Observasi",
      engineVersion: "Versi Mesin",
      noMoversMatched:
        "Tidak ada aset yang memenuhi semua ambang penyaringan. Coba longgarkan max_24h_gain_pct atau batas likuiditas.",
    },
    evidence: {
      badge: "Jejak Audit · Tersimpan di Supabase",
      title: "Inspektor Bukti API",
      desc: "Setiap panggilan tool MCP dan REST menyimpan baris audit di evidence_records. Klik baris mana saja untuk memverifikasi endpoint CoinMarketCap, timestamp UTC, kredit, metodologi, dan cuplikan tersanitasi.",
      searchLabel: "Cari Jejak Audit",
      searchPlaceholder: "evidence_id, nama tool, atau /v2/cryptocurrency/...",
      lookupLabel: "Cari ID Langsung",
      showingPrefix: "Menampilkan",
      of: "dari",
      recordsSuffix: "catatan",
      emptyNoRecords: "Belum ada catatan bukti tersimpan",
      emptyNoMatch: "Tidak ada catatan yang cocok dengan filter",
      emptyHint:
        "Jalankan analisis setelah masuk di Playground. ID bukti itu milik akun tersebut.",
      colEvidenceId: "ID Bukti",
      colTool: "Tool",
      colDataMode: "Mode Data",
      colFreshness: "Kesegaran",
      colEndpoints: "Endpoint CMC",
      colCredits: "Kredit",
      colCreatedUtc: "Dibuat UTC",
      drawerSubtitle: "Catatan Provenance Bukti",
      createdUtc: "Dibuat UTC",
      canonicalIds: "CMC ID Kanonik",
      methodology: "Metodologi",
      recordedLimitations: "Keterbatasan Tercatat",
      rawExcerpt: "Cuplikan Mentah CMC Tersanitasi",
      loadingRecord: "Memuat catatan bukti...",
      copyId: "Salin ID",
    },
    connect: {
      badge: "Hub Koneksi Developer · Streamable HTTP + stdio + REST",
      title: "Hubungkan CoinTrac ke Agen AI Anda",
      descPrefix: "Server MCP Streamable HTTP aktif di",
      descSuffix:
        "berbagi satu lapisan layanan intelijen yang sama dengan endpoint REST terautentikasi.",
      openApiBtn: "FastAPI OpenAPI /docs",
      snippetsHeading: "Konfigurasi Cepat & Klien",
      copySnippet: "Salin kode",
      toolsHeading: "14 tool MCP, 10+ rute REST",
      toolsHint: "Satu sumber kebenaran · EvidenceEnvelope[T] Kanonik",
      colMcpTool: "Tool MCP",
      colRestEndpoint: "Endpoint REST",
      colCapability: "Kapabilitas",
      colRouting: "Batasan Routing",
      resourcesHeading: "6 Resource MCP (application/json)",
      promptsHeading: "3 Prompt MCP (Alur Berbasis Bukti)",
      noArgs: "tanpa argumen",
      argsPrefix: "argumen",
    },
  },
};

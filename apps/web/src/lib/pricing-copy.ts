import type { Locale } from "./i18n";

export interface PricingPlan {
  id: "free" | "pro" | "scale";
  name: string;
  badge: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
  comingSoon?: boolean;
}

export interface PricingFaqItem {
  question: string;
  answer: string;
}

export interface PricingCopy {
  eyebrow: string;
  title: string;
  lede: string;
  freeBanner: string;
  plansHeading: string;
  plans: PricingPlan[];
  byokEyebrow: string;
  byokTitle: string;
  byokBody: string;
  byokPlaygroundCta: string;
  byokDocsCta: string;
  faqTitle: string;
  faq: PricingFaqItem[];
}

export const PRICING_COPY: Record<Locale, PricingCopy> = {
  en: {
    eyebrow: "Transparent Pricing & Quotas",
    title: "Free while in beta. Clear limits and zero hidden credit traps.",
    lede: "Every verified account includes REST API keys, Streamable HTTP MCP access (14 tools, 6 resources, 3 prompts), and audited EvidenceEnvelope logs.",
    freeBanner:
      "Currently free to use — no paid checkout or credit card is required. Cached hits spend 0 CoinTrac credits.",
    plansHeading: "CoinTrac Plans",
    plans: [
      {
        id: "free",
        name: "Free Developer",
        badge: "Active Now",
        price: "$0",
        period: "/ month",
        description:
          "Full access to the deterministic intelligence engine and remote MCP server for personal apps, Claude, ChatGPT, and Gemini.",
        features: [
          "Up to 5 active API keys per account",
          "60 requests / minute per active key",
          "10 core intelligence REST endpoints + /v1/capabilities",
          "14 MCP tools, 6 resources (3 static + 3 templates), 3 prompts",
          "Hidden Gem Discovery scans & outcome checkpoints",
          "0 credits billed on CoinTrac response cache hits",
        ],
        ctaLabel: "Create free account",
        ctaHref: "/signup",
        highlighted: true,
        comingSoon: false,
      },
      {
        id: "pro",
        name: "Pro Team",
        badge: "Coming soon",
        price: "$49",
        period: "/ month (planned)",
        description:
          "Reserved for teams needing higher sustained burst throughput, longer audit retention, and priority Hidden Gem refresh intervals.",
        features: [
          "Higher active API key limits & workspace roles",
          "Dedicated rate limits above 60 req/min",
          "Extended historical evidence retention",
          "Priority scan scheduling queue",
        ],
        ctaLabel: "Planned — free tier covers beta",
        ctaHref: "/signup",
        comingSoon: true,
      },
      {
        id: "scale",
        name: "Scale / Dedicated",
        badge: "Coming soon",
        price: "$99",
        period: "/ month (planned)",
        description:
          "Reserved for production agent fleets requiring custom SLA, higher concurrency, and dedicated upstream CoinMarketCap quota routing.",
        features: [
          "Dedicated tenant isolation & custom throughput",
          "Custom retention and export webhooks",
          "Enterprise OAuth & audit log streaming",
          "Direct engineering support channel",
        ],
        ctaLabel: "Planned — contact support@cointrac.xyz",
        ctaHref: "/docs",
        comingSoon: true,
      },
    ],
    byokEyebrow: "Upstream CMC Limits & BYOK",
    byokTitle: "Need 365-day historical OHLCV, beta, or max drawdown?",
    byokBody:
      "CoinMarketCap restricts /v2/cryptocurrency/ohlcv/historical on Basic and Startup keys. On those upstream tiers, get_historical_performance returns TIER_RESTRICTED with null risk metrics instead of guessing. Pass your own higher-tier CoinMarketCap key in memory via the x-cmc-api-key header (BYOK) in the Playground or REST requests.",
    byokPlaygroundCta: "Test BYOK in Playground",
    byokDocsCta: "Read auth & tier docs",
    faqTitle: "Pricing & quota questions",
    faq: [
      {
        question: "Do I need a credit card to use CoinTrac right now?",
        answer:
          "No. CoinTrac is currently free to use with no paid checkout active. Sign up with your email to generate up to 5 active API keys.",
      },
      {
        question: "Do cached tool calls count against credits?",
        answer:
          "Response cache hits return cache_hit: true and spend 0 CoinTrac/CMC upstream credits, while still preserving source timestamps and freshness labels.",
      },
      {
        question: "Does CoinTrac include CoinTrac AI Analyst in the free tier?",
        answer:
          "Yes, verified accounts get an isolated daily request and token allowance for CoinTrac AI Analyst, separate from the deterministic Python calculation engine.",
      },
      {
        question: "Is my BYOK x-cmc-api-key stored or logged?",
        answer:
          "No. When supplied via Playground or REST headers, x-cmc-api-key stays strictly in memory for the upstream request and is stripped from evidence_records and logs.",
      },
    ],
  },
  id: {
    eyebrow: "Harga & Kuota Transparan",
    title: "Gratis selama beta. Batas jelas tanpa jebakan kredit tersembunyi.",
    lede: "Setiap akun terverifikasi mencakup API key REST, akses MCP Streamable HTTP (14 tool, 6 resource, 3 prompt), serta log audit EvidenceEnvelope.",
    freeBanner:
      "Saat ini gratis digunakan — tidak ada checkout berbayar atau kartu kredit yang dibutuhkan. Cache hit memakan 0 kredit CoinTrac.",
    plansHeading: "Paket CoinTrac",
    plans: [
      {
        id: "free",
        name: "Free Developer",
        badge: "Aktif Sekarang",
        price: "$0",
        period: "/ bulan",
        description:
          "Akses penuh ke mesin intelijen deterministik dan server MCP remote untuk aplikasi pribadi, Claude, ChatGPT, maupun Gemini.",
        features: [
          "Hingga 5 API key aktif per akun",
          "60 request / menit per kunci aktif",
          "10 endpoint REST intelijen inti + /v1/capabilities",
          "14 tool MCP, 6 resource (3 statis + 3 template), 3 prompt",
          "Scan Hidden Gem Discovery & checkpoint outcome",
          "0 kredit terpakai saat mengenai cache respons CoinTrac",
        ],
        ctaLabel: "Buat akun gratis",
        ctaHref: "/signup",
        highlighted: true,
        comingSoon: false,
      },
      {
        id: "pro",
        name: "Pro Team",
        badge: "Segera hadir",
        price: "$49",
        period: "/ bulan (rencana)",
        description:
          "Disiapkan untuk tim yang membutuhkan kapasitas burst lebih tinggi, retensi audit lebih panjang, dan antrean refresh Hidden Gem prioritas.",
        features: [
          "Batas kunci API aktif lebih besar & peran tim",
          "Batas laju khusus di atas 60 req/menit",
          "Retensi riwayat bukti lebih panjang",
          "Antrean penjadwalan scan prioritas",
        ],
        ctaLabel: "Segera hadir — paket gratis aktif saat beta",
        ctaHref: "/signup",
        comingSoon: true,
      },
      {
        id: "scale",
        name: "Scale / Dedicated",
        badge: "Segera hadir",
        price: "$99",
        period: "/ bulan (rencana)",
        description:
          "Disiapkan untuk armada agen produksi dengan kebutuhan SLA khusus, konkurensi tinggi, dan routing kuota CoinMarketCap terdedikasi.",
        features: [
          "Isolasi tenant terdedikasi & throughput kustom",
          "Retensi kustom dan webhook ekspor",
          "OAuth enterprise & streaming log audit",
          "Saluran dukungan engineering langsung",
        ],
        ctaLabel: "Segera hadir — hubungi support@cointrac.xyz",
        ctaHref: "/docs",
        comingSoon: true,
      },
    ],
    byokEyebrow: "Batas Tier CMC & BYOK",
    byokTitle: "Butuh data OHLCV historis 365 hari, beta, atau max drawdown?",
    byokBody:
      "CoinMarketCap membatasi endpoint /v2/cryptocurrency/ohlcv/historical pada tier Basic dan Startup. Pada tier tersebut, get_historical_performance mengembalikan TIER_RESTRICTED dengan metrik risiko null—tanpa menebak angka. Anda dapat mengirimkan kunci CMC tier lebih tinggi di memori melalui header x-cmc-api-key (BYOK) lewat Playground maupun request REST.",
    byokPlaygroundCta: "Uji BYOK di Playground",
    byokDocsCta: "Baca panduan auth & tier",
    faqTitle: "Pertanyaan soal harga & kuota",
    faq: [
      {
        question: "Apakah saya butuh kartu kredit untuk memakai CoinTrac sekarang?",
        answer:
          "Tidak. CoinTrac gratis digunakan saat ini dan tidak ada checkout berbayar yang aktif. Daftar dengan email Anda untuk membuat hingga 5 API key aktif.",
      },
      {
        question: "Apakah panggilan tool yang terkena cache memotong kredit?",
        answer:
          "Hit cache respons mengembalikan cache_hit: true dengan biaya 0 kredit CoinTrac/CMC, sekaligus tetap menyertakan timestamp sumber dan status kesegaran.",
      },
      {
        question: "Apakah CoinTrac AI Analyst termasuk di akun gratis?",
        answer:
          "Ya, akun terverifikasi mendapat kuota harian terisolasi untuk CoinTrac AI Analyst yang terpisah dari mesin kalkulasi Python deterministik.",
      },
      {
        question: "Apakah kunci BYOK x-cmc-api-key saya disimpan di server?",
        answer:
          "Tidak. Kunci x-cmc-api-key hanya dipakai di memori untuk panggilan upstream dan otomatis dihapus dari baris evidence_records maupun log.",
      },
    ],
  },
};

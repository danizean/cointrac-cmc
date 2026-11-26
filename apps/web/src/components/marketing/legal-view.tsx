"use client";

import { ArrowLeft, Mail, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useAppPreferences } from "../app-preferences";

interface LegalSection {
  title: string;
  body: string;
  items?: string[];
}

interface LegalContent {
  eyebrow: string;
  title: string;
  lede: string;
  updated: string;
  sections: LegalSection[];
}

const PRIVACY: Record<"en" | "id", LegalContent> = {
  en: {
    eyebrow: "Trust & Privacy",
    title: "Privacy Policy",
    lede: "How CoinTrac handles account credentials, API keys, BYOK upstream headers, and request telemetry.",
    updated: "Last updated: November 26, 2026",
    sections: [
      {
        title: "1. Account & Authentication Data",
        body: "When you sign up for CoinTrac, authentication and session state are managed through Supabase Auth using your email address and user UUID. OAuth 2.1 + PKCE authorizations for remote MCP clients bind strictly to your verified user session and HttpOnly cookies on api.cointrac.xyz.",
      },
      {
        title: "2. API Keys & BYOK Credentials",
        body: "CoinTrac API keys are stored using SHA-256 cryptographic hashes; plaintext keys are shown only once at creation time.",
        items: [
          "Optional CoinMarketCap BYOK headers (x-cmc-api-key) are forwarded in memory per request and are never stored in the database or browser bundle.",
          "Sanitized request audit records strip Authorization headers, API keys, and upstream credentials before persistence.",
        ],
      },
      {
        title: "3. Evidence Records & Request Logs",
        body: "Every intelligence call records an EvidenceEnvelope[T] audit entry (tool name, endpoints called, timestamps, credit count, and limitations) scoped to your user_id via PostgreSQL Row-Level Security so other accounts cannot access your evidence or usage logs.",
      },
      {
        title: "4. Infrastructure & Upstream Processors",
        body: "CoinTrac processes market analytics using Python on self-hosted API infrastructure (api.cointrac.xyz / mcp.cointrac.xyz), Next.js web hosting (cointrac.xyz), Supabase PostgreSQL, and CoinMarketCap API endpoints.",
      },
      {
        title: "5. Contact & Account Requests",
        body: "To request key revocation assistance, data export, or account deletion, contact support@cointrac.xyz from the email registered to your account.",
      },
    ],
  },
  id: {
    eyebrow: "Kepercayaan & Privasi",
    title: "Kebijakan Privasi",
    lede: "Bagaimana CoinTrac mengelola akun, API key, header BYOK CoinMarketCap, dan log bukti permintaan.",
    updated: "Diperbarui: 26 November 2026",
    sections: [
      {
        title: "1. Data Akun & Autentikasi",
        body: "Saat Anda mendaftar di CoinTrac, sesi login dan identitas dikelola melalui Supabase Auth memakai alamat email dan UUID pengguna. Persetujuan OAuth 2.1 + PKCE untuk klien MCP remote terikat pada sesi pengguna terverifikasi serta cookie HttpOnly di api.cointrac.xyz.",
      },
      {
        title: "2. API Key & Kredensial BYOK",
        body: "API key CoinTrac disimpan dalam bentuk hash SHA-256; key asli hanya ditampilkan satu kali saat dibuat.",
        items: [
          "Header BYOK CoinMarketCap opsional (x-cmc-api-key) hanya diteruskan di memori per permintaan dan tidak pernah disimpan ke database maupun dikirim ke bundle browser.",
          "Pencatatan bukti selalu melakukan sanitasi terhadap header Authorization, API key, dan kredensial lain sebelum disimpan.",
        ],
      },
      {
        title: "3. Catatan Bukti (Evidence) & Log Permintaan",
        body: "Setiap pemanggilan tool menyimpan catatan audit EvidenceEnvelope[T] (nama tool, endpoint upstream, timestamp, kredit CMC, dan limitations) yang terisolasi pada user_id Anda melalui PostgreSQL Row-Level Security agar tidak dapat diakses akun lain.",
      },
      {
        title: "4. Infrastruktur & Pemroses Pihak Ketiga",
        body: "CoinTrac menjalankan layanan analitik Python pada server API/MCP (api.cointrac.xyz / mcp.cointrac.xyz), frontend Next.js (cointrac.xyz), database PostgreSQL Supabase, serta data pasar CoinMarketCap.",
      },
      {
        title: "5. Kontak & Permintaan Data",
        body: "Untuk bantuan pencabutan akses, ekspor catatan bukti, atau penghapusan akun, hubungi support@cointrac.xyz dari email yang terdaftar.",
      },
    ],
  },
};

const TERMS: Record<"en" | "id", LegalContent> = {
  en: {
    eyebrow: "Terms & Disclosures",
    title: "Terms of Service",
    lede: "Scope of service, data accuracy disclosures, rate limits, and non-advisory rules for using CoinTrac.",
    updated: "Last updated: November 26, 2026",
    sections: [
      {
        title: "1. Read-Only Market Intelligence (No Financial Advice)",
        body: "CoinTrac provides deterministic quantitative formatting and market intelligence over CoinMarketCap data via REST and MCP. CoinTrac is not a broker, exchange, custodian, or investment advisor and never executes orders or manages funds.",
      },
      {
        title: "2. Honest Missing Data & Upstream Plan Limits",
        body: "Upstream metrics depend on CoinMarketCap availability and tier entitlements.",
        items: [
          "Missing prices, volumes, or historical volatility/drawdown series remain null and are documented in limitations rather than replaced with zero.",
          "Historical OHLCV metrics require a CoinMarketCap plan above Basic/Startup or a caller-supplied BYOK key.",
          "Derivatives open interest reflects sampled pairs reported by CoinMarketCap v5 and may reflect single-venue concentration.",
        ],
      },
      {
        title: "3. Quotas & Acceptable Use",
        body: "Standard free accounts include up to 5 active API keys and a shared rate limit of 60 requests per minute per tenant/key. Automated abuse, scraping beyond rate limits, or bypassing authentication controls is prohibited.",
      },
      {
        title: "4. Availability & Limitation of Liability",
        body: "CoinTrac is provided on an 'as-is' and 'as-available' basis. Check api.cointrac.xyz/health or the header status indicator for live API reachability. You remain solely responsible for any trading, research, or application decisions built on top of returned outputs.",
      },
      {
        title: "5. Support Contact",
        body: "Questions regarding service terms, incidents, or security disclosures can be sent to support@cointrac.xyz.",
      },
    ],
  },
  id: {
    eyebrow: "Ketentuan & Pengungkapan",
    title: "Ketentuan Layanan",
    lede: "Batasan layanan, transparansi keterbatasan data, kuota request, dan disclaimer non-nasihat keuangan CoinTrac.",
    updated: "Diperbarui: 26 November 2026",
    sections: [
      {
        title: "1. Intelijen Pasar Read-Only (Bukan Nasihat Keuangan)",
        body: "CoinTrac hanya menyajikan pemrosesan kuantitatif deterministik atas data CoinMarketCap melalui REST dan MCP. CoinTrac bukan bursa, pialang, kustodian, maupun penasihat investasi dan tidak mengeksekusi order apa pun.",
      },
      {
        title: "2. Keterbatasan Data & Paket CoinMarketCap",
        body: "Ketersediaan metrik bergantung pada respons upstream CoinMarketCap dan hak paket yang aktif.",
        items: [
          "Harga, volume, atau metrik volatilitas/drawdown yang tidak tersedia tetap bernilai null dan dijelaskan di field limitations—tidak pernah diganti angka 0.",
          "Data OHLCV historis membutuhkan paket CoinMarketCap di atas Basic/Startup atau key BYOK milik pengguna.",
          "Open interest derivatif mencerminkan sampel pasangan yang tersedia dari CoinMarketCap v5 dan dapat terpengaruh konsentrasi venue tertentu.",
        ],
      },
      {
        title: "3. Kuota & Penggunaan Wajar",
        body: "Akun gratis standar mencakup hingga 5 API key aktif dengan batas 60 request/menit per akun/key. Penyalahgunaan kuota, upaya melewati batas rate limit, atau akses tidak sah dilarang.",
      },
      {
        title: "4. Ketersediaan Layanan & Tanggung Jawab",
        body: "Layanan disediakan apa adanya ('as-is'). Anda dapat memantau status API secara langsung di api.cointrac.xyz/health atau indikator status di situs. Seluruh keputusan riset maupun trading sepenuhnya menjadi tanggung jawab pengguna.",
      },
      {
        title: "5. Kontak Dukungan",
        body: "Pertanyaan terkait ketentuan layanan, laporan insiden, atau pengungkapan keamanan dapat dikirim ke support@cointrac.xyz.",
      },
    ],
  },
};

export function LegalView({ kind }: { kind: "privacy" | "terms" }) {
  const { locale } = useAppPreferences();
  const content = (kind === "privacy" ? PRIVACY : TERMS)[locale];
  const Icon = kind === "privacy" ? ShieldCheck : Scale;

  return (
    <main id="content" className="relative overflow-x-clip">
      <div className="ct-hero-glow relative border-b border-border/80">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[320px]"
        />
        <div className="relative mx-auto w-full max-w-[960px] px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pt-16">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{locale === "id" ? "Kembali ke beranda" : "Back to home"}</span>
          </Link>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{content.eyebrow}</span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-5xl">
            {content.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {content.lede}
          </p>
          <p className="mt-3 font-mono text-xs text-subtle-foreground">{content.updated}</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[960px] space-y-5 px-4 py-12 sm:px-6 lg:px-8">
        {content.sections.map((section) => (
          <section key={section.title} className="ct-surface-card rounded-[16px] p-6">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {section.title}
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
            {section.items ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <div className="ct-surface-featured flex flex-wrap items-center justify-between gap-4 rounded-[16px] p-5">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-link" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">
              {locale === "id" ? "Kontak resmi CoinTrac:" : "Official CoinTrac contact:"}{" "}
              <a
                href="mailto:support@cointrac.xyz"
                className="font-mono font-semibold text-link hover:underline"
              >
                support@cointrac.xyz
              </a>
            </span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <Link
              href={kind === "privacy" ? "/terms" : "/privacy"}
              className="text-link hover:underline"
            >
              {kind === "privacy"
                ? locale === "id"
                  ? "Ketentuan Layanan"
                  : "Terms of Service"
                : locale === "id"
                  ? "Kebijakan Privasi"
                  : "Privacy Policy"}
            </Link>
            <a
              href="https://api.cointrac.xyz/health"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              API Health ↗
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

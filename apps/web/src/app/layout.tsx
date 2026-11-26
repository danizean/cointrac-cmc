import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppPreferencesProvider } from "@/components/app-preferences";
import { MarketingChrome } from "@/components/marketing-chrome";
import { ToastProvider } from "@/components/ui/toast";
import { parseLocale } from "@/lib/i18n";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const site = siteUrl();

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: site,
  alternates: { canonical: "/" },
  title: {
    default: "CoinTrac — Crypto Market Intelligence API & MCP Server",
    template: "%s · CoinTrac",
  },
  description:
    "CoinTrac turns CoinMarketCap feeds into deterministic REST endpoints, Hidden Gem Discovery, and 11 MCP tools with audited provenance and null-safe responses.",
  keywords: [
    "crypto market intelligence API",
    "CoinMarketCap MCP server",
    "Model Context Protocol crypto",
    "hidden gem crypto discovery",
    "deterministic crypto analytics",
    "OAuth 2.1 PKCE MCP",
    "EvidenceEnvelope",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "CoinTrac — Crypto Market Intelligence API & MCP Server",
    description:
      "Deterministic cryptocurrency market intelligence via REST and Streamable HTTP MCP. Audited timestamps, explicit tier limits, and null-safe fields.",
    siteName: "CoinTrac",
    type: "website",
    locale: "en_US",
    url: site,
    images: [
      {
        url: "/brand/cointrac-logo.png",
        alt: "CoinTrac Market Intelligence API & MCP Server",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CoinTrac — Crypto Market Intelligence API & MCP Server",
    description:
      "Deterministic crypto market intelligence via REST API, Hidden Gem Discovery, and 11 MCP tools.",
    images: ["/brand/cointrac-logo.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/cointrac-logo.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tg_theme');var isDark=t?t==='dark':true;document.documentElement.classList.toggle('dark',isDark);document.documentElement.style.colorScheme=isDark?'dark':'light';}catch(e){}})();`;

const LOCALE_SYNC_SCRIPT = `(function(){try{var k='tg_locale';var s=localStorage.getItem(k);if(s!=='en'&&s!=='id')return;var m=document.cookie.match(/(?:^|; )tg_locale=([^;]*)/);var c=m?decodeURIComponent(m[1]):'';if(c===s)return;document.cookie=k+'='+s+'; Path=/; Max-Age=31536000; SameSite=Lax';if(document.documentElement.lang===s)return;var guard='tg_locale_sync';if(sessionStorage.getItem(guard)===s)return;sessionStorage.setItem(guard,s);location.replace(location.href);}catch(e){}})();`;

export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const initialLocale = parseLocale(cookieStore.get("tg_locale")?.value);

  return (
    <html
      lang={initialLocale}
      suppressHydrationWarning
      className={`dark ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_SYNC_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="tg-canvas relative flex min-h-full flex-col bg-background font-sans text-foreground selection:bg-primary/25 selection:text-foreground">
        <AppPreferencesProvider initialLocale={initialLocale}>
          <ToastProvider>
            <MarketingChrome>{children}</MarketingChrome>
          </ToastProvider>
        </AppPreferencesProvider>
      </body>
    </html>
  );
}

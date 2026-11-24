"use client";

import Image from "next/image";
import Link from "next/link";
import { useAppPreferences } from "./app-preferences";

export function SiteFooter() {
  const { t } = useAppPreferences();

  const product = [
    { href: "/capabilities", label: t.footer.capabilities },
    { href: "/integrations", label: t.footer.integrations },
    { href: "/docs", label: t.footer.docs },
    { href: "/#pricing", label: t.nav.pricing },
  ];
  const developers = [
    { href: "/signup", label: t.nav.explore },
    { href: "/playground", label: t.footer.playground },
    { href: "/connect", label: t.footer.connect },
    { href: "/evidence", label: t.footer.evidence },
    { href: "/login", label: t.footer.login },
  ];

  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.7fr))] lg:px-8">
        <div className="max-w-sm">
          <div className="flex items-center">
            <span className="inline-flex items-center rounded-[10px] bg-[#080B12] px-2.5 py-1.5">
              <Image
                src="/brand/cointrac-wordmark.png"
                alt="CoinTrac"
                width={150}
                height={28}
                className="h-7 w-auto object-contain"
              />
            </span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t.footer.tagline}</p>
        </div>
        <nav aria-label={t.footer.product}>
          <h2 className="text-sm font-semibold text-foreground">{t.footer.product}</h2>
          <ul className="mt-3 space-y-2">
            {product.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.developers}>
          <h2 className="text-sm font-semibold text-foreground">{t.footer.developers}</h2>
          <ul className="mt-3 space-y-2">
            {developers.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-[1120px] px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6 lg:px-8">
          {t.footer.note}
        </p>
      </div>
    </footer>
  );
}

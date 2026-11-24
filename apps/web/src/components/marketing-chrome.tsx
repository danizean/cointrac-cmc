"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function MarketingChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const workspace = pathname === "/app" || pathname.startsWith("/app/");

  if (workspace) {
    return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
  }

  return (
    <>
      <Suspense fallback={<div className="tg-glass-header sticky top-0 z-30 h-16 border-b border-border" />}>
        <SiteHeader />
      </Suspense>
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}

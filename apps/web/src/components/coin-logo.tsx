"use client";

import Image from "next/image";
import { useState } from "react";

interface CoinLogoProps {
  cmcId?: number | null;
  symbol: string;
  name?: string | null;
  size?: "sm" | "md" | "lg";
}

const SIZE_MAP = {
  sm: { px: 20, box: "h-5 w-5", text: "text-[9px]" },
  md: { px: 28, box: "h-7 w-7", text: "text-[10px]" },
  lg: { px: 34, box: "h-8.5 w-8.5", text: "text-[11px]" },
} as const;

export function CoinLogo({
  cmcId,
  symbol,
  name,
  size = "md",
}: CoinLogoProps) {
  const [failedId, setFailedId] = useState<number | null>(null);
  const spec = SIZE_MAP[size];
  const validId =
    typeof cmcId === "number" && Number.isInteger(cmcId) && cmcId > 0
      ? cmcId
      : null;
  const showImage = validId !== null && failedId !== validId;

  if (!showImage) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex ${spec.box} shrink-0 items-center justify-center rounded-full border border-border bg-card-elevated font-mono ${spec.text} font-bold uppercase text-foreground`}
      >
        {symbol.slice(0, 3)}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex ${spec.box} shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-card shadow-xs`}
    >
      <Image
        src={`https://s2.coinmarketcap.com/static/img/coins/64x64/${validId}.png`}
        alt={`${name ?? symbol} (${symbol}) logo`}
        width={spec.px}
        height={spec.px}
        unoptimized
        loading="lazy"
        onError={() => setFailedId(validId)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

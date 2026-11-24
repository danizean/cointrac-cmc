import type { Metadata } from "next";
import { UsageConsole } from "@/components/workspace/usage-console";

export const metadata: Metadata = {
  title: "Usage & Limits",
  description:
    "Monitor CoinTrac tool consumption and upstream CoinMarketCap API credit usage separately.",
};

export default function AppUsagePage() {
  return <UsageConsole />;
}

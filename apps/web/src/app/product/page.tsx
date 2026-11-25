import type { Metadata } from "next";
import { CapabilitiesView } from "@/components/marketing/capabilities-view";

export const metadata: Metadata = {
  title: "Product",
  alternates: { canonical: "/product" },
  description:
    "The ten CoinTrac tools, their REST routes, and how restricted or missing market data is reported.",
};

export default function ProductPage() {
  return <CapabilitiesView />;
}

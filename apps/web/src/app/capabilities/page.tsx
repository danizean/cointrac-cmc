import type { Metadata } from "next";
import { CapabilitiesView } from "@/components/marketing/capabilities-view";

export const metadata: Metadata = {
  title: "Product",
  description:
    "The ten CoinTrac tools, their REST routes, and how restricted or missing market data is reported.",
};

export default function CapabilitiesPage() {
  return <CapabilitiesView />;
}

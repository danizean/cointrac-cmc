import type { Metadata } from "next";
import { IntegrationsView } from "@/components/marketing/integrations-view";

export const metadata: Metadata = {
  title: "MCP",
  description:
    "CoinTrac MCP tools, resources, and prompts. Client compatibility is not marked verified on this page.",
};

export default function IntegrationsPage() {
  return <IntegrationsView />;
}

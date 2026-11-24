import type { Metadata } from "next";
import { IntegrationsView } from "@/components/marketing/integrations-view";

export const metadata: Metadata = {
  title: "MCP",
  description:
    "CoinTrac MCP tools, resources, and prompts. Antigravity is verified locally. Public HTTPS MCP is not deployed.",
};

export default function IntegrationsPage() {
  return <IntegrationsView />;
}

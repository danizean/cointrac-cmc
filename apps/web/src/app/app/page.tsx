import type { Metadata } from "next";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "CoinTrac workspace readiness, quickstart onboarding, real evidence activity, and direct access to Market Intelligence, API Keys, and MCP Connections.",
};

export default function AppHomePage() {
  return <WorkspaceOverview />;
}

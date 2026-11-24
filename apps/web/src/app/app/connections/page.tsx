import type { Metadata } from "next";
import { ConnectionsConsole } from "@/components/workspace/connections-console";

export const metadata: Metadata = {
  title: "MCP Connections",
  description: "Connect AI clients and MCP applications to CoinTrac.",
};

export default function AppConnectionsPage() {
  return <ConnectionsConsole />;
}

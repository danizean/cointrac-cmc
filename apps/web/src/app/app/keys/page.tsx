import type { Metadata } from "next";
import { KeysConsole } from "@/components/workspace/keys-console";

export const metadata: Metadata = {
  title: "API Keys",
  description: "Manage personal CoinTrac API keys for MCP and REST integrations.",
};

export default function AppKeysPage() {
  return <KeysConsole />;
}

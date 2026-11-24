import type { Metadata } from "next";
import { ConnectView } from "@/components/connect-view";
import { publicMcpUrl, publicOpenApiDocsUrl } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Connect MCP",
  description:
    "Connect Claude Desktop, Cursor, Python bots, or cURL to CoinTrac MCP (10 Tools, 5 Resources, 3 Prompts).",
};

export default function ConnectPage() {
  const mcpUrl = publicMcpUrl();
  const docsUrl = publicOpenApiDocsUrl();
  const apiBaseUrl = docsUrl.replace(/\/docs$/, "");

  return (
    <ConnectView mcpUrl={mcpUrl} docsUrl={docsUrl} apiBaseUrl={apiBaseUrl} />
  );
}

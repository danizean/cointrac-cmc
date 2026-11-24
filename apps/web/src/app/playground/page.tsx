import type { Metadata } from "next";
import { PlaygroundHero } from "@/components/page-hero";
import { PlaygroundConsole } from "@/components/playground-console";

export const metadata: Metadata = {
  title: "MCP Playground",
  description:
    "Inspect all ten CoinTrac tools and four presets. Execution requires a signed-in session.",
};

export default function PlaygroundPage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      <PlaygroundHero />
      <PlaygroundConsole />
    </main>
  );
}

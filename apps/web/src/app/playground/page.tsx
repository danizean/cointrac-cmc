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
    <main id="content" className="relative overflow-x-clip">
      <PlaygroundHero />
      <div className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6 lg:px-8">
        <PlaygroundConsole />
      </div>
    </main>
  );
}

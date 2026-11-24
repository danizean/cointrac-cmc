import type { Metadata } from "next";
import { AssetDesk } from "@/components/workspace/asset-desk";

export const metadata: Metadata = {
  title: "Asset analysis",
  description: "Asset profile, momentum, and comparison from the existing intelligence tools.",
};

export default function AssetsPage() {
  return <AssetDesk />;
}

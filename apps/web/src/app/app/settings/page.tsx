import type { Metadata } from "next";
import { SettingsConsole } from "@/components/workspace/settings-console";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your CoinTrac account and profile.",
};

export default function AppSettingsPage() {
  return <SettingsConsole />;
}

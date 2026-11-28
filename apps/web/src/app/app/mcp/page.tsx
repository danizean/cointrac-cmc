import { redirect } from "next/navigation";

export default function LegacyMcpRouteRedirect() {
  redirect("/app/connections");
}

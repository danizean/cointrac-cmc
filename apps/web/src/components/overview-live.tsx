import {
  serverFetchHealth,
  serverFetchMarketOverview,
  serverFetchMarketRegime,
  serverFetchSectorRotation,
  serverFetchTelemetrySummary,
} from "@/lib/server-api";
import { OverviewView } from "./overview-view";

export function OverviewSkeleton() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-label="Loading live market intelligence"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="tg-panel h-28 animate-pulse rounded-2xl p-5"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="tg-panel h-72 animate-pulse rounded-2xl lg:col-span-8" />
        <div className="tg-panel h-72 animate-pulse rounded-2xl lg:col-span-4" />
      </div>
      <div className="tg-panel h-80 animate-pulse rounded-2xl" />
    </div>
  );
}

export async function OverviewLiveSections() {
  const [healthRes, regimeRes, overviewRes, sectorRes, telemetryRes] =
    await Promise.all([
      serverFetchHealth(),
      serverFetchMarketRegime(),
      serverFetchMarketOverview(),
      serverFetchSectorRotation(),
      serverFetchTelemetrySummary(),
    ]);

  return (
    <OverviewView
      healthRes={healthRes}
      regimeRes={regimeRes}
      overviewRes={overviewRes}
      sectorRes={sectorRes}
      telemetryRes={telemetryRes}
    />
  );
}

import type { ToolName } from "./types";

export function symbolList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function validateToolInput(
  tool: ToolName,
  params: Record<string, unknown>,
): string | null {
  if (tool === "compare_assets") {
    const symbols = Array.isArray(params.symbols) ? params.symbols : [];
    if (symbols.length < 2 || symbols.length > 8) {
      return "Provide between 2 and 8 unique ticker symbols.";
    }
  }
  if (tool === "analyze_momentum") {
    const symbols = Array.isArray(params.symbols) ? params.symbols : [];
    if (symbols.length < 1 || symbols.length > 20) {
      return "Provide between 1 and 20 unique ticker symbols.";
    }
  }
  if (
    tool === "analyze_asset" ||
    tool === "analyze_derivatives" ||
    tool === "get_historical_performance"
  ) {
    const symbol = typeof params.symbol === "string" ? params.symbol.trim() : "";
    if (!symbol) return "Enter an asset symbol.";
  }
  if (tool === "analyze_sector_rotation" && Array.isArray(params.sectors) && params.sectors.length === 0) {
    return "Select at least one sector.";
  }
  return null;
}

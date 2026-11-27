import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breadcrumbsForWorkspacePath,
  buildWorkspaceCommands,
  computeOnboardingSteps,
  derivePrimaryNextAction,
  filterWorkspaceCommands,
  isMarketIntelligencePath,
  isMarketIntelligenceTool,
  isWorkspaceNavActive,
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  MARKET_SUB_ROUTES,
  WORKSPACE_GROUPS,
  WORKSPACE_NAV_ITEMS,
} from "./workspace-navigation.ts";

describe("sidebar collapse preference", () => {
  it("reads only the collapsed flag and fails closed", () => {
    assert.equal(readSidebarCollapsed(() => "1"), true);
    assert.equal(readSidebarCollapsed(() => "0"), false);
    assert.equal(readSidebarCollapsed(() => null), false);
    assert.equal(
      readSidebarCollapsed(() => {
        throw new Error("storage blocked");
      }),
      false,
    );
    assert.equal(SIDEBAR_COLLAPSED_KEY, "ct_sidebar_collapsed");
  });
});

describe("R3 Workspace Navigation Architecture", () => {
  it("exposes exactly 8 top-level navigation items across 3 groups with unique routes", () => {
    assert.equal(WORKSPACE_GROUPS.length, 3);
    assert.equal(WORKSPACE_NAV_ITEMS.length, 8);
    assert.deepEqual(
      WORKSPACE_NAV_ITEMS.map((item) => item.href),
      [
        "/app",
        "/app/ai",
        "/app/market",
        "/app/keys",
        "/app/connections",
        "/app/usage",
        "/app/evidence",
        "/app/settings",
      ],
    );
    assert.equal(MARKET_SUB_ROUTES.length, 8);
  });

  it("highlights Market Intelligence active for all 8 intelligence desk sub-routes", () => {
    const overview = WORKSPACE_NAV_ITEMS[0];
    const market = WORKSPACE_NAV_ITEMS[2];
    const keys = WORKSPACE_NAV_ITEMS[3];

    assert.equal(isWorkspaceNavActive(overview, "/app"), true);
    assert.equal(isWorkspaceNavActive(overview, "/app/market"), false);

    for (const sub of MARKET_SUB_ROUTES) {
      assert.equal(isMarketIntelligencePath(sub.href), true);
      assert.equal(isWorkspaceNavActive(market, sub.href), true);
      assert.equal(isWorkspaceNavActive(keys, sub.href), false);
    }
    assert.equal(isWorkspaceNavActive(keys, "/app/keys"), true);
  });

  it("generates accurate breadcrumbs for Overview, Market sub-desks, and Control Plane", () => {
    assert.deepEqual(breadcrumbsForWorkspacePath("/app", "en"), [
      { label: "Workspace" },
      { label: "Overview" },
    ]);
    assert.deepEqual(breadcrumbsForWorkspacePath("/app/assets", "en"), [
      { label: "Workspace", href: "/app" },
      { label: "Market Intelligence", href: "/app/market" },
      { label: "Assets & Compare" },
    ]);
    assert.deepEqual(breadcrumbsForWorkspacePath("/app/keys", "id"), [
      { label: "Ruang Kerja", href: "/app" },
      { label: "Kunci API" },
    ]);
  });
});

describe("R3 Command Search", () => {
  it("filters real workspace, intelligence, and documentation destinations accurately", () => {
    const commands = buildWorkspaceCommands("en");
    assert.ok(commands.length >= 15);
    assert.ok(commands.every((cmd) => cmd.href.startsWith("/") && cmd.href !== "#"));

    const mcpHits = filterWorkspaceCommands(commands, "mcp");
    assert.ok(mcpHits.some((cmd) => cmd.href === "/app/connections"));

    const zScoreHits = filterWorkspaceCommands(commands, "z-score");
    assert.deepEqual(
      zScoreHits.map((cmd) => cmd.href),
      ["/app/anomalies"],
    );

    const assetHits = filterWorkspaceCommands(commands, "ondo");
    assert.ok(assetHits.some((cmd) => cmd.href === "/app/assets?symbol=ONDO"));

    const btcHits = filterWorkspaceCommands(commands, "bitcoin");
    assert.ok(btcHits.some((cmd) => cmd.href === "/app/assets?symbol=BTC"));

    const noHits = filterWorkspaceCommands(commands, "nonexistent-feature-xyz");
    assert.equal(noHits.length, 0);
  });
});

describe("R3 Truthful Onboarding & Data-State Matrix", () => {
  it("Scenario 1: new user with no API keys and no activity", () => {
    const steps = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 0,
      revokedKeyCount: 0,
      verifiedKeyCount: 0,
      usageLoaded: true,
      callsLast30d: 0,
      mcpCalls: 0,
      successfulMcpCalls: 0,
      failedMcpCalls: 0,
      successfulMarketUsageQueries: 0,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.deepEqual(
      steps.map((s) => s.status),
      ["action_required", "unverified", "action_required"],
    );
    assert.equal(steps[0].badgeLabel, "NOT CONFIGURED");
    assert.ok(steps[1].statusNote.includes("Not deployed"));
    assert.deepEqual(derivePrimaryNextAction(steps), {
      label: "Create API key",
      href: "/app/keys",
    });
  });

  it("Scenario 2: user with active API key not yet used distinguishes CONFIGURED from VERIFIED auth", () => {
    const steps = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 1,
      revokedKeyCount: 0,
      verifiedKeyCount: 0,
      usageLoaded: true,
      callsLast30d: 0,
      mcpCalls: 0,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.equal(steps[0].status, "configured");
    assert.equal(steps[0].badgeLabel, "CONFIGURED");
    assert.ok(steps[0].statusNote.toLowerCase().includes("unverified"));
  });

  it("Scenario 3: user with revoked API keys only requires creating a new active key", () => {
    const steps = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 0,
      revokedKeyCount: 3,
      verifiedKeyCount: 0,
      usageLoaded: true,
      callsLast30d: 0,
      mcpCalls: 0,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.equal(steps[0].status, "action_required");
    assert.ok(steps[0].statusNote.includes("3 revoked keys only"));
  });

  it("Scenario 4 & 5: actual successful MCP usage vs failed-only MCP traffic while preserving Not deployed", () => {
    const verifiedMcp = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 1,
      verifiedKeyCount: 1,
      usageLoaded: true,
      callsLast30d: 4,
      mcpCalls: 2,
      successfulMcpCalls: 2,
      failedMcpCalls: 0,
      successfulMarketUsageQueries: 2,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 2,
    });
    assert.deepEqual(
      verifiedMcp.map((s) => s.status),
      ["verified", "verified", "verified"],
    );
    assert.equal(verifiedMcp[1].badgeLabel, "USAGE OBSERVED");
    assert.ok(verifiedMcp[1].statusNote.includes("Not deployed"));
    assert.ok(verifiedMcp[1].statusNote.includes("user-managed"));

    const failedOnlyMcp = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 1,
      verifiedKeyCount: 0,
      usageLoaded: true,
      callsLast30d: 2,
      mcpCalls: 2,
      successfulMcpCalls: 0,
      failedMcpCalls: 2,
      successfulMarketUsageQueries: 0,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.equal(failedOnlyMcp[1].status, "unverified");
    assert.equal(failedOnlyMcp[2].status, "action_required");
  });

  it("Scenario 6: unrelated or failed calls do NOT mark Step 3 (Market Intelligence query) complete", () => {
    assert.equal(isMarketIntelligenceTool("get_market_overview"), true);
    assert.equal(isMarketIntelligenceTool("resource:evidence"), false);
    assert.equal(isMarketIntelligenceTool("health"), false);

    const unrelatedOnly = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 1,
      verifiedKeyCount: 1,
      usageLoaded: true,
      callsLast30d: 12,
      mcpCalls: 0,
      successfulMarketUsageQueries: 0,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.equal(unrelatedOnly[2].status, "action_required");
    assert.ok(unrelatedOnly[2].statusNote.includes("do not complete this step"));
  });

  it("Scenario 7: partial API failures (usage failure or keys failure) never fabricate completion", () => {
    const usageFailed = computeOnboardingSteps({
      keysLoaded: true,
      activeKeyCount: 1,
      verifiedKeyCount: 0,
      usageLoaded: false,
      callsLast30d: null,
      mcpCalls: null,
      mcpStatusLoaded: true,
      remoteMcpDeployed: false,
      evidenceLoaded: true,
      verifiedMarketEvidenceCount: 0,
    });
    assert.deepEqual(
      usageFailed.map((s) => s.status),
      ["configured", "unverified", "unverified"],
    );
    assert.ok(usageFailed[1].statusNote.includes("Usage telemetry unavailable"));
    assert.ok(usageFailed[1].statusNote.includes("Not deployed"));

    const allFailed = computeOnboardingSteps({
      keysLoaded: false,
      activeKeyCount: null,
      usageLoaded: false,
      callsLast30d: null,
      mcpCalls: null,
      mcpStatusLoaded: false,
      remoteMcpDeployed: false,
      evidenceLoaded: false,
      verifiedMarketEvidenceCount: 0,
    });
    assert.deepEqual(
      allFailed.map((s) => s.status),
      ["unverified", "unverified", "unverified"],
    );
  });

  it("Scenario 8: loading state shows CHECKING instead of prematurely showing UNVERIFIED errors", () => {
    const loading = computeOnboardingSteps({
      keysLoading: true,
      keysLoaded: false,
      activeKeyCount: null,
      usageLoading: true,
      usageLoaded: false,
      callsLast30d: null,
      mcpCalls: null,
      mcpStatusLoading: true,
      mcpStatusLoaded: false,
      remoteMcpDeployed: false,
      evidenceLoading: true,
      evidenceLoaded: false,
      verifiedMarketEvidenceCount: 0,
    });
    assert.deepEqual(
      loading.map((s) => s.status),
      ["loading", "loading", "loading"],
    );
    assert.deepEqual(
      loading.map((s) => s.badgeLabel),
      ["CHECKING", "CHECKING", "CHECKING"],
    );
    assert.deepEqual(derivePrimaryNextAction(loading), {
      label: "Open Market Intelligence",
      href: "/app/market",
    });
  });
});

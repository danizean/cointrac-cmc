import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_GROUPS,
  ADMIN_NAV_ITEMS,
  ADMIN_SIDEBAR_COLLAPSED_KEY,
  breadcrumbsForAdminPath,
  buildAdminCommands,
  filterAdminCommands,
  isAdminNavActive,
  isAdminRoutePath,
  readAdminSidebarCollapsed,
} from "./admin-navigation.ts";

describe("Super Admin navigation architecture", () => {
  it("reads collapsed sidebar preference safely", () => {
    assert.equal(ADMIN_SIDEBAR_COLLAPSED_KEY, "ct_admin_sidebar_collapsed");
    assert.equal(readAdminSidebarCollapsed(() => "1"), true);
    assert.equal(readAdminSidebarCollapsed(() => null), false);
    assert.equal(
      readAdminSidebarCollapsed(() => {
        throw new Error("blocked");
      }),
      false,
    );
  });

  it("defines 5 admin-only destinations across 2 control groups without user dashboard routes", () => {
    assert.equal(ADMIN_GROUPS.length, 2);
    assert.equal(ADMIN_NAV_ITEMS.length, 5);
    assert.deepEqual(
      ADMIN_NAV_ITEMS.map((item) => item.href),
      [
        "/app/admin",
        "/app/admin/users",
        "/app/admin/runtime",
        "/app/admin/sandbox",
        "/app/admin/audit",
      ],
    );
    assert.ok(ADMIN_NAV_ITEMS.every((item) => isAdminRoutePath(item.href)));
    assert.equal(isAdminRoutePath("/app"), false);
    assert.equal(isAdminRoutePath("/app/market"), false);
  });

  it("activates exact overview route and nested governance sub-routes accurately", () => {
    const overview = ADMIN_NAV_ITEMS[0];
    const users = ADMIN_NAV_ITEMS[1];
    assert.equal(isAdminNavActive(overview, "/app/admin"), true);
    assert.equal(isAdminNavActive(overview, "/app/admin/users"), false);
    assert.equal(isAdminNavActive(users, "/app/admin/users"), true);
    assert.equal(isAdminNavActive(users, "/app/admin"), false);
  });

  it("generates Super Admin breadcrumbs in English and Indonesian", () => {
    assert.deepEqual(breadcrumbsForAdminPath("/app/admin", "en"), [
      { label: "Super Admin" },
      { label: "Executive Overview" },
    ]);
    assert.deepEqual(breadcrumbsForAdminPath("/app/admin/runtime", "id"), [
      { label: "Super Admin", href: "/app/admin" },
      { label: "Mesin AI & Kebijakan" },
    ]);
  });

  it("scopes command palette strictly to admin workflows", () => {
    const commands = buildAdminCommands("en");
    assert.ok(commands.every((cmd) => cmd.href.startsWith("/app/admin")));
    const matches = filterAdminCommands(commands, "kill switch");
    assert.ok(matches.some((cmd) => cmd.href === "/app/admin/runtime"));
  });
});

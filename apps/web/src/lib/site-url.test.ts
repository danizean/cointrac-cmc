import assert from "node:assert/strict";
import test from "node:test";

import { siteUrl } from "./site-url.ts";

test("site url stays local unless production or an explicit site is configured", () => {
  const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
  const previousVercel = process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_ENV;

  assert.equal(siteUrl().origin, "http://localhost:3000");

  process.env.VERCEL_ENV = "production";
  assert.equal(siteUrl().origin, "https://cointrac.xyz");

  process.env.NEXT_PUBLIC_SITE_URL = "https://cointrac.xyz";
  assert.equal(siteUrl().href, "https://cointrac.xyz/");

  if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
  if (previousVercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousVercel;
});

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppVersionService } from "../service/app-version-service";

describe("AppVersionService", () => {
  const previous = process.env.EMAIL_PLUGIN_BUILD_VERSION;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EMAIL_PLUGIN_BUILD_VERSION;
    } else {
      process.env.EMAIL_PLUGIN_BUILD_VERSION = previous;
    }
  });

  it("derives a bounded version from static assets", () => {
    delete process.env.EMAIL_PLUGIN_BUILD_VERSION;
    const root = join(tmpdir(), `email-version-${Date.now()}`);
    try {
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "index.html"), '<script src="/assets/index-abc.js"></script>', "utf8");
      writeFileSync(join(root, "assets", "index-abc.js"), "console.log('v1')", "utf8");

      const version = new AppVersionService(root, () => new Date("2026-06-02T00:00:00.000Z")).current();

      expect(version).toMatchObject({ checkedAt: "2026-06-02T00:00:00.000Z" });
      expect(version.version).toMatch(/^v-[a-f0-9]+$/);
      expect(JSON.stringify(version)).not.toContain("assets/index-abc.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows deployment to provide an explicit build version", () => {
    process.env.EMAIL_PLUGIN_BUILD_VERSION = "build-test-1";
    expect(new AppVersionService("missing").current().version).toBe("build-test-1");
  });
});

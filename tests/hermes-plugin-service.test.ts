import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { HermesPluginService } from "../service/hermes-plugin-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("HermesPluginService", () => {
  it("returns a non-secret manifest with provisioning endpoints", () => {
    const db = openMailDatabase();
    runMigrations(db);
    const manifest = new HermesPluginService(db, { port: 5175 }).manifest();
    expect(manifest).toMatchObject({
      schema_version: 1,
      id: "email",
      kind: "embedded_app",
      program_api: {
        workspace_registration: "/api/v1/hermes/plugin/workspaces",
        plugin_launch: "/api/v1/hermes/plugin/launch"
      },
      owner_binding: {
        raw_key_returned_by_email: false
      }
    });
    expect(JSON.stringify(manifest)).not.toContain("access_token");
    expect(JSON.stringify(manifest)).not.toContain("refresh_token");
    expect(JSON.stringify(manifest)).not.toContain("secret");
  });

  it("registers a workspace with owner key, writes local config/key, and does not return the raw key", () => {
    const root = mkdtempSync(join(tmpdir(), "email-hermes-"));
    try {
      const ownerKeyFile = join(root, "owner-key.txt");
      writeFileSync(ownerKeyFile, "owner-test-key\n", "utf8");
      const workspaceRoot = join(root, "workspace");
      const db = openMailDatabase();
      runMigrations(db);
      const service = new HermesPluginService(db, { port: 5175, ownerKeyFile });

      const denied = service.registerWorkspace({ workspace_id: "ws-1", workspace_root: workspaceRoot }, "wrong-key");
      expect(denied.statusCode).toBe(403);

      const registered = service.registerWorkspace({
        workspace_id: "ws-1",
        workspace_name: "Workspace One",
        display_name: "工作区一",
        workspace_root: workspaceRoot
      }, "owner-test-key");
      expect(registered.statusCode).toBe(200);
      expect(registered.payload).toMatchObject({
        ok: true,
        workspace_id: "ws-1",
        status: "active",
        config_file: ".hermes-email/config.json",
        access_key_file: ".hermes-email/access-key.txt"
      });
      const payloadText = JSON.stringify(registered.payload);
      const workspaceKey = readFileSync(join(workspaceRoot, ".hermes-email", "access-key.txt"), "utf8").trim();
      expect(workspaceKey).toMatch(/^email-ws-/);
      expect(payloadText).not.toContain(workspaceKey);
      expect(readFileSync(join(workspaceRoot, ".hermes-email", "config.json"), "utf8")).toContain("\"workspace_id\": \"ws-1\"");

      const launchDenied = service.launch({ workspace_id: "ws-1" }, "owner-test-key");
      expect(launchDenied.statusCode).toBe(403);

      const launch = service.launch({ workspace_id: "ws-1", appearance: { theme: "dark", fontSize: "default" } }, workspaceKey);
      expect(launch.statusCode).toBe(200);
      expect(launch.payload).toMatchObject({
        token_type: "Bearer",
        expires_in: 300,
        workspace_id: "ws-1"
      });
      const launchText = JSON.stringify(launch.payload);
      expect(launchText).not.toContain(workspaceKey);
      expect(launchText).toContain("pluginTheme=dark");
      expect(launchText).toContain("pluginFontSize=default");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("provider proxy boundary", () => {
  it("keeps fetch proxy setup in connector-owned provider clients", () => {
    for (const relativePath of [
      "connectors/gmail/gmail-api-client.ts",
      "connectors/outlook-graph/microsoft-graph-client.ts"
    ]) {
      const source = readFileSync(join(root, relativePath), "utf8");
      expect(source).toContain("../http/provider-fetch-proxy");
      expect(source).toContain("configureProviderFetchProxyFromEnv();");
    }
  });

  it("keeps UI, MCP, and Hermes service layers out of provider proxy wiring", () => {
    for (const relativePath of [
      "web/src/ui/App.tsx",
      "mcp/read-tools.ts",
      "service/hermes-plugin-service.ts",
      "server/email-http-server.ts"
    ]) {
      const source = readFileSync(join(root, relativePath), "utf8");
      expect(source).not.toContain("provider-fetch-proxy");
      expect(source).not.toContain("ProxyAgent");
      expect(source).not.toContain("setGlobalDispatcher");
    }
  });
});

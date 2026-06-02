import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("architecture boundaries", () => {
  it("keeps MCP read tools as glue that delegates to services", () => {
    const source = readFileSync(join(root, "mcp/read-tools.ts"), "utf8");
    expect(source).toContain("MessageQueryService");
    expect(source).not.toContain("SELECT ");
    expect(source.length).toBeLessThan(2500);
  });

  it("keeps UI from importing SQLite or provider connector modules", () => {
    const files = listFiles(join(root, "web/src")).filter((file) => /\.(ts|tsx)$/.test(file));
    const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(combined).not.toContain("node:sqlite");
    expect(combined).not.toContain("connectors/outlook-graph");
    expect(combined).not.toContain("connectors/gmail");
    expect(combined).not.toContain("provider-fetch-proxy");
  });

  it("keeps Hermes plugin glue from importing provider credentials or HTTP proxy runtime", () => {
    const source = readFileSync(join(root, "service/hermes-plugin-service.ts"), "utf8");
    expect(source).not.toContain("gmail-config");
    expect(source).not.toContain("outlook-config");
    expect(source).not.toContain("alimail-config");
    expect(source).not.toContain("provider-fetch-proxy");
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

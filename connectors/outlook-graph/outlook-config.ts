import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OUTLOOK_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Mail.Read"];
export const OUTLOOK_ACCOUNT_ID = "outlook-hotmail-primary";

export interface OutlookRuntimeConfig {
  clientId: string;
  tenant: "consumers" | "common" | "organizations";
  tokenFile: string;
  pendingDeviceFile: string;
  databasePath: string;
}

export function loadOutlookRuntimeConfig(): OutlookRuntimeConfig {
  const runtimeRoot = process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
  const clientId = process.env.EMAIL_MS_GRAPH_CLIENT_ID || process.env.MS_GRAPH_CLIENT_ID || readClientIdFromLocalConfig(runtimeRoot);
  return {
    clientId: clientId || "",
    tenant: (process.env.EMAIL_MS_GRAPH_TENANT as OutlookRuntimeConfig["tenant"]) || "consumers",
    tokenFile: process.env.EMAIL_OUTLOOK_TOKEN_FILE || join(runtimeRoot, "secrets", "outlook-graph", "token.json"),
    pendingDeviceFile: process.env.EMAIL_OUTLOOK_PENDING_DEVICE_FILE || join(runtimeRoot, "secrets", "outlook-graph", "device-login.json"),
    databasePath: process.env.EMAIL_PLUGIN_DB || join(runtimeRoot, "data", "mail.sqlite")
  };
}

export function assertOutlookClientId(config: OutlookRuntimeConfig): void {
  if (!config.clientId) {
    throw new Error(
      "EMAIL_MS_GRAPH_CLIENT_ID is not configured. Set it in the shell or create runtime/config/outlook-graph.json with {\"clientId\":\"...\"}."
    );
  }
}

export function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

function readClientIdFromLocalConfig(runtimeRoot: string): string {
  const path = join(runtimeRoot, "config", "outlook-graph.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { clientId?: string };
    return parsed.clientId || "";
  } catch {
    return "";
  }
}


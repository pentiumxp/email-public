import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const GMAIL_ACCOUNT_ID = "gmail-primary";
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export interface GmailRuntimeConfig {
  accountId: string;
  accountLabel: string;
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  clientSecretFile: string;
  pendingDeviceFile: string;
  databasePath: string;
  configFile: string;
}

interface GmailPublicConfig {
  provider: "gmail";
  accountLabel: string;
  clientId: string;
}

export function ensureGmailConfigFiles(): { configFile: string; createdConfig: boolean } {
  const runtimeRoot = process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
  const configFile = process.env.EMAIL_GMAIL_CONFIG_FILE || join(runtimeRoot, "config", "gmail.json");
  let createdConfig = false;
  if (!existsSync(configFile)) {
    writeJson(configFile, { provider: "gmail", accountLabel: "Gmail", clientId: "" } satisfies GmailPublicConfig);
    createdConfig = true;
  }
  return { configFile, createdConfig };
}

export function loadGmailRuntimeConfig(): GmailRuntimeConfig {
  const runtimeRoot = process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
  const configFile = process.env.EMAIL_GMAIL_CONFIG_FILE || join(runtimeRoot, "config", "gmail.json");
  const clientSecretFile = process.env.EMAIL_GMAIL_CLIENT_SECRET_FILE || join(runtimeRoot, "secrets", "gmail", "client-secret.json");
  const publicConfig = readJson<GmailPublicConfig>(configFile, { provider: "gmail", accountLabel: "Gmail", clientId: "" });
  const secretConfig = readJson<{ clientSecret?: string }>(clientSecretFile, {});
  return {
    accountId: process.env.EMAIL_GMAIL_ACCOUNT_ID || GMAIL_ACCOUNT_ID,
    accountLabel: process.env.EMAIL_GMAIL_ACCOUNT_LABEL || publicConfig.accountLabel || "Gmail",
    clientId: process.env.EMAIL_GOOGLE_CLIENT_ID || publicConfig.clientId || "",
    clientSecret: process.env.EMAIL_GOOGLE_CLIENT_SECRET || secretConfig.clientSecret || "",
    tokenFile: process.env.EMAIL_GMAIL_TOKEN_FILE || join(runtimeRoot, "secrets", "gmail", "token.json"),
    clientSecretFile,
    pendingDeviceFile: process.env.EMAIL_GMAIL_PENDING_DEVICE_FILE || join(runtimeRoot, "secrets", "gmail", "device-login.json"),
    databasePath: process.env.EMAIL_PLUGIN_DB || join(runtimeRoot, "data", "mail.sqlite"),
    configFile
  };
}

export function assertGmailClientId(config: GmailRuntimeConfig): void {
  if (!config.clientId) {
    throw new Error("EMAIL_GOOGLE_CLIENT_ID is not configured. Set it in the shell or create runtime/config/gmail.json with {\"clientId\":\"...\"}.");
  }
}

export function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

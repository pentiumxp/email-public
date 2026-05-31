import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ALIMAIL_ACCOUNT_ID = "alimail-qifan-primary";

export interface AliMailRuntimeConfig {
  accountId: string;
  accountLabel: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  databasePath: string;
  configFile: string;
  credentialsFile: string;
}

interface AliMailPublicConfig {
  provider: "alimail";
  accountLabel: string;
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean; enabled: false };
}

export function ensureAliMailConfigFiles(): { configFile: string; credentialsFile: string; createdConfig: boolean; createdCredentialsTemplate: boolean } {
  const runtimeRoot = process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
  const configFile = process.env.EMAIL_ALIMAIL_CONFIG_FILE || join(runtimeRoot, "config", "alimail.json");
  const credentialsFile = process.env.EMAIL_ALIMAIL_CREDENTIALS_FILE || join(runtimeRoot, "secrets", "alimail", "credentials.json");
  let createdConfig = false;
  let createdCredentialsTemplate = false;
  if (!existsSync(configFile)) {
    writeJson(configFile, defaultPublicConfig());
    createdConfig = true;
  }
  if (!existsSync(credentialsFile)) {
    writeJson(credentialsFile, { username: "", password: "" });
    createdCredentialsTemplate = true;
  }
  return { configFile, credentialsFile, createdConfig, createdCredentialsTemplate };
}

export function loadAliMailRuntimeConfig(): AliMailRuntimeConfig {
  const runtimeRoot = process.env.EMAIL_PLUGIN_RUNTIME_DIR || join(process.cwd(), "runtime");
  const configFile = process.env.EMAIL_ALIMAIL_CONFIG_FILE || join(runtimeRoot, "config", "alimail.json");
  const credentialsFile = process.env.EMAIL_ALIMAIL_CREDENTIALS_FILE || join(runtimeRoot, "secrets", "alimail", "credentials.json");
  const publicConfig = readJson<AliMailPublicConfig>(configFile, defaultPublicConfig());
  const credentials = readJson<{ username?: string; password?: string }>(credentialsFile, {});
  return {
    accountId: process.env.EMAIL_ALIMAIL_ACCOUNT_ID || ALIMAIL_ACCOUNT_ID,
    accountLabel: publicConfig.accountLabel || "Qifan work mail",
    host: process.env.EMAIL_ALIMAIL_IMAP_HOST || publicConfig.imap.host,
    port: Number(process.env.EMAIL_ALIMAIL_IMAP_PORT || publicConfig.imap.port || 993),
    secure: process.env.EMAIL_ALIMAIL_IMAP_TLS ? process.env.EMAIL_ALIMAIL_IMAP_TLS !== "false" : publicConfig.imap.tls !== false,
    username: process.env.EMAIL_ALIMAIL_USERNAME || credentials.username || "",
    password: process.env.EMAIL_ALIMAIL_PASSWORD || credentials.password || "",
    databasePath: process.env.EMAIL_PLUGIN_DB || join(runtimeRoot, "data", "mail.sqlite"),
    configFile,
    credentialsFile
  };
}

export function assertAliMailCredentials(config: AliMailRuntimeConfig): void {
  if (!config.username || !config.password) {
    throw new Error("ALIMAIL_CREDENTIALS_MISSING");
  }
}

function defaultPublicConfig(): AliMailPublicConfig {
  return {
    provider: "alimail",
    accountLabel: "Qifan work mail",
    imap: { host: "imap.qiye.aliyun.com", port: 993, tls: true },
    smtp: { host: "smtp.qiye.aliyun.com", port: 465, tls: true, enabled: false }
  };
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

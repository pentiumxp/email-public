import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { AuthorizationService, type LaunchInput } from "./authorization-service";
import { HermesWorkspaceRepository, UserMailAccountRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";

export type ProvisioningStatus = "not_supported" | "manual_required" | "pending" | "active" | "provisioning_failed";

export interface WorkspaceRegistrationInput {
  workspace_id: string;
  workspace_name?: string;
  display_name?: string;
  workspace_root: string;
}

export interface LaunchRequestInput {
  workspace_id: string;
  appearance?: {
    theme?: string;
    fontSize?: string;
  };
}

export class HermesPluginService {
  private readonly workspaces: HermesWorkspaceRepository;
  private readonly authorization: AuthorizationService;
  private readonly userAccounts: UserMailAccountRepository;

  constructor(db: SqliteDatabase, private readonly options: { port: number; ownerKeyFile?: string }) {
    this.workspaces = new HermesWorkspaceRepository(db);
    this.authorization = new AuthorizationService(db);
    this.userAccounts = new UserMailAccountRepository(db);
  }

  manifest() {
    const baseUrl = `http://127.0.0.1:${this.options.port}`;
    return {
      schema_version: 1,
      id: "email",
      title: "邮箱",
      description: "Local multi-account email workspace for Hermes Mobile.",
      kind: "embedded_app",
      version: "local-dev",
      entry: {
        type: "web",
        url: `${baseUrl}/?embed=hermes`,
        frame_policy: "allow_configured_hermes_origins"
      },
      navigation: {
        state_event: "email.plugin.navigation",
        back_event: "hermes.plugin.back",
        back_result_event: "email.plugin.back_result",
        refresh_required_event: "email.plugin.refresh_required",
        preserve_iframe_state: true,
        message_version: 1
      },
      appearance_sync: {
        theme: ["dark", "light"],
        fontSize: ["small", "default", "large", "xlarge", "xxlarge"],
        launch_field: "appearance",
        entry_query: { theme: "pluginTheme", fontSize: "pluginFontSize" }
      },
      embedding: {
        frame_ancestors: ["'self'", "http://127.0.0.1:*", "http://localhost:*"],
        registration_endpoint: "/api/v1/hermes/plugin/frame-ancestors"
      },
      mcp: {
        server: "email-mcp",
        toolset: "email",
        required_tools: [
          "email.search_messages",
          "email.get_message",
          "email.list_mailboxes",
          "email.get_digest",
          "email.sync_account"
        ]
      },
      program_api: {
        base_url: baseUrl,
        plugin_manifest: "/api/v1/hermes/plugin/manifest",
        workspace_registration: "/api/v1/hermes/plugin/workspaces",
        plugin_launch: "/api/v1/hermes/plugin/launch",
        sync_schema_version: 1
      },
      owner_binding: {
        strategy: "workspace_generated_access_key",
        config_file: ".hermes-email/config.json",
        access_key_file: ".hermes-email/access-key.txt",
        cache_dir: ".hermes-cache",
        raw_key_returned_by_email: false
      },
      permissions: {
        register_workspace_requires: ["owners:write", "admin:*"],
        owner_token_scopes: ["mail:read", "mail:write", "accounts:write", "sync:read"]
      }
    };
  }

  registerWorkspace(input: WorkspaceRegistrationInput, bearerToken?: string | null) {
    if (!this.verifyOwnerKey(bearerToken)) {
      return { ok: false, statusCode: 403, payload: { ok: false, error: "email_workspace_registration_denied" } };
    }
    if (!input.workspace_id || !input.workspace_root) {
      return { ok: false, statusCode: 400, payload: { ok: false, error: "invalid_workspace_registration" } };
    }

    const secret = `email-ws-${randomBytes(32).toString("base64url")}`;
    const keyHash = hashSecret(secret);
    const metadataDir = join(input.workspace_root, ".hermes-email");
    const configPath = join(metadataDir, "config.json");
    const accessKeyPath = join(metadataDir, "access-key.txt");
    mkdirSync(metadataDir, { recursive: true });
    writeJson(configPath, {
      workspace_id: input.workspace_id,
      plugin_id: "email",
      base_url: `http://127.0.0.1:${this.options.port}`,
      plugin_manifest: "/api/v1/hermes/plugin/manifest",
      plugin_launch: "/api/v1/hermes/plugin/launch",
      status: "active"
    });
    writeFileSync(accessKeyPath, `${secret}\n`, "utf8");

    const result = this.workspaces.upsert({
      id: input.workspace_id,
      workspaceName: input.workspace_name || input.workspace_id,
      displayName: input.display_name || input.workspace_name || input.workspace_id,
      workspaceRoot: input.workspace_root,
      status: "active",
      keyHash,
      configFile: ".hermes-email/config.json",
      accessKeyFile: ".hermes-email/access-key.txt"
    });
    const userId = `workspace-${input.workspace_id}`;
    this.authorization.createLaunchSession({
      workspaceId: input.workspace_id,
      userId,
      role: "member",
      allowedAccountIds: [],
      ttlSeconds: 60
    });

    return {
      ok: true,
      statusCode: 200,
      payload: {
        ok: true,
        workspace_id: input.workspace_id,
        status: "active" satisfies ProvisioningStatus,
        created: result.created,
        config_file: ".hermes-email/config.json",
        access_key_file: ".hermes-email/access-key.txt"
      }
    };
  }

  launch(input: LaunchRequestInput, bearerToken?: string | null) {
    const workspace = bearerToken ? this.workspaces.findByKeyHash(hashSecret(bearerToken)) : null;
    if (!workspace || workspace.id !== input.workspace_id) {
      return { ok: false, statusCode: 403, payload: { ok: false, error: "email_launch_denied" } };
    }
    const userId = `workspace-${workspace.id}`;
    const existingAllowed = this.userAccounts.listAccountIdsForUser(`user-${workspace.id}-${userId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160));
    const launchInput: LaunchInput = {
      workspaceId: workspace.id,
      userId,
      role: "member",
      displayName: workspace.displayName,
      allowedAccountIds: existingAllowed,
      ttlSeconds: 300
    };
    const launch = this.authorization.createLaunchSession(launchInput);
    return {
      ok: true,
      statusCode: 200,
      payload: {
        launch_token: launch.token,
        token_type: "Bearer",
        expires_in: 300,
        workspace_id: workspace.id,
        entry_path: appendAppearance(launch.entryPath, input.appearance)
      }
    };
  }

  private verifyOwnerKey(token?: string | null): boolean {
    const ownerKey = loadOwnerKey(this.options.ownerKeyFile);
    return Boolean(ownerKey && token && safeEqualHash(ownerKey, token));
  }
}

export function bearerToken(header?: string | string[]): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function appendAppearance(entryPath: string, appearance?: LaunchRequestInput["appearance"]): string {
  const params = new URLSearchParams();
  if (appearance?.theme) params.set("pluginTheme", appearance.theme);
  if (appearance?.fontSize) params.set("pluginFontSize", appearance.fontSize);
  const suffix = params.toString();
  return suffix ? `${entryPath}&${suffix}` : entryPath;
}

function loadOwnerKey(path?: string): string {
  const ownerKeyFile = path || process.env.EMAIL_HERMES_OWNER_KEY_FILE || join(process.cwd(), "runtime", "secrets", "hermes", "owner-key.txt");
  if (existsSync(ownerKeyFile)) {
    return readFileSync(ownerKeyFile, "utf8").trim();
  }
  return process.env.EMAIL_HERMES_OWNER_KEY || "";
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqualHash(a: string, b: string): boolean {
  return hashSecret(a) === hashSecret(b);
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

export function boundedPath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

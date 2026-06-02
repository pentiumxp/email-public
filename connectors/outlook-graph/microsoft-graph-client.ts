import { existsSync, readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { configureProviderFetchProxyFromEnv } from "../http/provider-fetch-proxy";
import { assertOutlookClientId, OUTLOOK_SCOPES, type OutlookRuntimeConfig, writeJsonFile } from "./outlook-config";
import type { GraphAttachment, GraphAuthStatus, GraphFolder, GraphMessageDeltaPage, GraphMessagePage } from "./types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface TokenState {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  account?: string;
}

interface PendingDeviceState {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_at: number;
  interval: number;
  message?: string;
}

export class MicrosoftGraphClient {
  constructor(private readonly config: OutlookRuntimeConfig) {
    configureProviderFetchProxyFromEnv();
  }

  authStatus(): GraphAuthStatus {
    const token = this.loadTokenState();
    if (!token.refresh_token) {
      return { connected: false, errorCode: "NO_TOKEN" };
    }
    return {
      connected: true,
      account: token.account,
      expiresAt: token.expires_at
    };
  }

  clearAuth(): void {
    for (const path of [this.config.tokenFile, this.config.pendingDeviceFile]) {
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  }

  async startDeviceLogin(): Promise<PendingDeviceState> {
    assertOutlookClientId(this.config);
    const response = await fetch(this.deviceCodeUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        scope: OUTLOOK_SCOPES.join(" ")
      })
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`DEVICE_CODE_START_FAILED:${String(payload.error || response.status)}`);
    }
    const pending: PendingDeviceState = {
      device_code: String(payload.device_code),
      user_code: String(payload.user_code),
      verification_uri: String(payload.verification_uri),
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 900),
      interval: Number(payload.interval || 5),
      message: payload.message ? String(payload.message) : undefined
    };
    writeJsonFile(this.config.pendingDeviceFile, pending);
    return pending;
  }

  async finishDeviceLogin(): Promise<GraphAuthStatus> {
    assertOutlookClientId(this.config);
    const pending = this.loadPendingDevice();
    while (Math.floor(Date.now() / 1000) < pending.expires_at) {
      const response = await fetch(this.tokenUrl(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: this.config.clientId,
          device_code: pending.device_code
        })
      });
      const payload = await response.json() as Record<string, unknown>;
      if (response.ok) {
        await this.saveTokenPayload(payload);
        rmSync(this.config.pendingDeviceFile, { force: true });
        return this.authStatus();
      }
      const error = String(payload.error || response.status);
      if (error !== "authorization_pending") {
        throw new Error(`DEVICE_CODE_FINISH_FAILED:${error}`);
      }
      await sleep(pending.interval * 1000);
    }
    throw new Error("DEVICE_CODE_EXPIRED");
  }

  async getMe(): Promise<{ mail: string; userPrincipalName: string; displayName: string }> {
    const payload = await this.graphGet("/me", { $select: "mail,userPrincipalName,displayName" });
    return {
      mail: String(payload.mail || ""),
      userPrincipalName: String(payload.userPrincipalName || ""),
      displayName: String(payload.displayName || "")
    };
  }

  async listFolders(): Promise<GraphFolder[]> {
    const folders: GraphFolder[] = [];
    let next: string | null = `${GRAPH_BASE}/me/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount`;
    while (next) {
      const payload = await this.graphGetUrl(next);
      folders.push(...((payload.value || []) as GraphFolder[]));
      next = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null;
    }
    return folders;
  }

  async listMessagesPage(folderId: string, nextLink?: string | null): Promise<GraphMessagePage> {
    const url = nextLink || `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages?${new URLSearchParams({
      $top: "50",
      $orderby: "receivedDateTime desc",
      $select: "id,conversationId,parentFolderId,subject,from,receivedDateTime,isRead,hasAttachments,body"
    }).toString()}`;
    const payload = await this.graphGetUrl(url);
    return {
      messages: (payload.value || []) as GraphMessagePage["messages"],
      nextLink: typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null
    };
  }

  async listMessagesDeltaPage(folderId: string, cursor?: string | null): Promise<GraphMessageDeltaPage> {
    const url = cursor || `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?${new URLSearchParams({
      $top: "50",
      $select: "id,conversationId,parentFolderId,subject,from,receivedDateTime,isRead,hasAttachments,body"
    }).toString()}`;
    const payload = await this.graphGetUrl(url);
    return {
      messages: (payload.value || []) as GraphMessageDeltaPage["messages"],
      nextLink: typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null,
      deltaLink: typeof payload["@odata.deltaLink"] === "string" ? payload["@odata.deltaLink"] : null
    };
  }

  async listAttachmentMetadata(messageId: string): Promise<GraphAttachment[]> {
    const payload = await this.graphGet(`/me/messages/${encodeURIComponent(messageId)}/attachments`, {
      $top: "100",
      $select: "id,name,contentType,size"
    });
    return (payload.value || []) as GraphAttachment[];
  }

  private async graphGet(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return this.graphGetUrl(`${GRAPH_BASE}${path}${query}`);
  }

  private async graphGetUrl(url: string): Promise<Record<string, unknown>> {
    const accessToken = await this.ensureAccessToken();
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`GRAPH_GET_FAILED:${String(payload.error ? "provider_error" : response.status)}`);
    }
    return payload;
  }

  private async ensureAccessToken(): Promise<string> {
    const token = this.loadTokenState();
    if (token.access_token && token.expires_at && token.expires_at > Math.floor(Date.now() / 1000) + 120) {
      return token.access_token;
    }
    if (!token.refresh_token) {
      throw new Error("NO_REFRESH_TOKEN");
    }
    return this.refreshAccessToken(token);
  }

  private async refreshAccessToken(token: TokenState): Promise<string> {
    assertOutlookClientId(this.config);
    const response = await fetch(this.tokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.config.clientId,
        refresh_token: token.refresh_token || "",
        scope: OUTLOOK_SCOPES.join(" ")
      })
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`TOKEN_REFRESH_FAILED:${String(payload.error || response.status)}`);
    }
    const next = await this.saveTokenPayload(payload, token.account);
    return next.access_token || "";
  }

  private async saveTokenPayload(payload: Record<string, unknown>, account?: string): Promise<TokenState> {
    const token: TokenState = {
      access_token: String(payload.access_token || ""),
      refresh_token: String(payload.refresh_token || ""),
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600) - 60,
      scope: payload.scope ? String(payload.scope) : OUTLOOK_SCOPES.join(" "),
      account
    };
    writeJsonFile(this.config.tokenFile, token);
    try {
      const me = await this.getMe();
      token.account = me.mail || me.userPrincipalName;
      writeJsonFile(this.config.tokenFile, token);
    } catch {
      // Account lookup is best-effort after token save; sync will surface auth errors later.
    }
    return token;
  }

  private loadTokenState(): TokenState {
    try {
      return JSON.parse(readFileSync(this.config.tokenFile, "utf8")) as TokenState;
    } catch {
      return {};
    }
  }

  private loadPendingDevice(): PendingDeviceState {
    try {
      return JSON.parse(readFileSync(this.config.pendingDeviceFile, "utf8")) as PendingDeviceState;
    } catch {
      throw new Error("NO_PENDING_DEVICE_LOGIN");
    }
  }

  private authBase(): string {
    return `https://login.microsoftonline.com/${this.config.tenant}/oauth2/v2.0`;
  }

  private tokenUrl(): string {
    return `${this.authBase()}/token`;
  }

  private deviceCodeUrl(): string {
    return `${this.authBase()}/devicecode`;
  }
}

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { assertGmailClientId, GMAIL_SCOPES, type GmailRuntimeConfig, writeJsonFile } from "./gmail-config";
import type { GmailAuthStatus, GmailLabel, GmailMessage, GmailMessageListPage, GmailProfile } from "./types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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
  verification_url: string;
  expires_at: number;
  interval: number;
}

export class GmailApiClient {
  constructor(private readonly config: GmailRuntimeConfig) {}

  authStatus(): GmailAuthStatus {
    const token = this.loadTokenState();
    if (!token.refresh_token) {
      return { connected: false, errorCode: "NO_TOKEN" };
    }
    return { connected: true, account: token.account, expiresAt: token.expires_at };
  }

  hasRefreshToken(): boolean {
    return Boolean(this.loadTokenState().refresh_token);
  }

  clearAuth(): void {
    for (const path of [this.config.tokenFile, this.config.pendingDeviceFile]) {
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  }

  async startDeviceLogin(openBrowser = true): Promise<PendingDeviceState> {
    assertGmailClientId(this.config);
    const response = await fetch(GOOGLE_DEVICE_CODE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        scope: GMAIL_SCOPES.join(" ")
      })
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`GMAIL_DEVICE_CODE_START_FAILED:${String(payload.error || response.status)}`);
    }
    const pending: PendingDeviceState = {
      device_code: String(payload.device_code),
      user_code: String(payload.user_code),
      verification_url: String(payload.verification_url || payload.verification_uri || "https://www.google.com/device"),
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 900),
      interval: Number(payload.interval || 5)
    };
    writeJsonFile(this.config.pendingDeviceFile, pending);
    if (openBrowser) {
      openUrlBestEffort(pending.verification_url);
    }
    return pending;
  }

  async finishDeviceLogin(): Promise<GmailAuthStatus> {
    assertGmailClientId(this.config);
    const pending = this.loadPendingDevice();
    while (Math.floor(Date.now() / 1000) < pending.expires_at) {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          device_code: pending.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      const payload = await response.json() as Record<string, unknown>;
      if (response.ok) {
        await this.saveTokenPayload(payload);
        rmSync(this.config.pendingDeviceFile, { force: true });
        return this.authStatus();
      }
      const error = String(payload.error || response.status);
      if (error !== "authorization_pending" && error !== "slow_down") {
        throw new Error(`GMAIL_DEVICE_CODE_FINISH_FAILED:${error}`);
      }
      await sleep((error === "slow_down" ? pending.interval + 5 : pending.interval) * 1000);
    }
    throw new Error("GMAIL_DEVICE_CODE_EXPIRED");
  }

  async runBrowserLogin(port = 53682): Promise<GmailAuthStatus> {
    assertGmailClientId(this.config);
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const state = randomBytes(18).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = await waitForAuthCode({
      port,
      state,
      authUrl: `${GOOGLE_AUTH_URL}?${new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GMAIL_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state
      }).toString()}`
    });
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(withOptionalClientSecret({
        client_id: this.config.clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      }, this.config.clientSecret))
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const description = payload.error_description ? `:${String(payload.error_description).slice(0, 160)}` : "";
      throw new Error(`GMAIL_BROWSER_TOKEN_FAILED:${String(payload.error || response.status)}${description}`);
    }
    await this.saveTokenPayload(payload);
    return this.authStatus();
  }

  async getProfile(): Promise<GmailProfile> {
    return await this.gmailGet("/users/me/profile") as unknown as GmailProfile;
  }

  async listLabels(): Promise<GmailLabel[]> {
    const payload = await this.gmailGet("/users/me/labels");
    return (payload.labels || []) as GmailLabel[];
  }

  async getLabel(labelId: string): Promise<GmailLabel> {
    return await this.gmailGet(`/users/me/labels/${encodeURIComponent(labelId)}`) as unknown as GmailLabel;
  }

  async listMessagesPage(labelId: string, pageToken?: string | null, maxResults = 50): Promise<GmailMessageListPage> {
    const params: Record<string, string> = {
      labelIds: labelId,
      maxResults: String(maxResults)
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }
    const payload = await this.gmailGet("/users/me/messages", params);
    return {
      messages: (payload.messages || []) as GmailMessageListPage["messages"],
      nextPageToken: typeof payload.nextPageToken === "string" ? payload.nextPageToken : null
    };
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    return await this.gmailGet(`/users/me/messages/${encodeURIComponent(messageId)}`, { format: "full" }) as unknown as GmailMessage;
  }

  private async gmailGet(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    const accessToken = await this.ensureAccessToken();
    const response = await fetch(`${GMAIL_BASE}${path}${query}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`GMAIL_GET_FAILED:${String(payload.error ? "provider_error" : response.status)}`);
    }
    return payload;
  }

  private async ensureAccessToken(): Promise<string> {
    const token = this.loadTokenState();
    if (token.access_token && token.expires_at && token.expires_at > Math.floor(Date.now() / 1000) + 120) {
      return token.access_token;
    }
    if (!token.refresh_token) {
      throw new Error("GMAIL_NO_REFRESH_TOKEN");
    }
    return this.refreshAccessToken(token);
  }

  private async refreshAccessToken(token: TokenState): Promise<string> {
    assertGmailClientId(this.config);
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(withOptionalClientSecret({
        client_id: this.config.clientId,
        refresh_token: token.refresh_token || "",
        grant_type: "refresh_token"
      }, this.config.clientSecret))
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`GMAIL_TOKEN_REFRESH_FAILED:${String(payload.error || response.status)}`);
    }
    const next = await this.saveTokenPayload(payload, token.account);
    return next.access_token || "";
  }

  private async saveTokenPayload(payload: Record<string, unknown>, account?: string): Promise<TokenState> {
    const current = this.loadTokenState();
    const token: TokenState = {
      access_token: String(payload.access_token || ""),
      refresh_token: String(payload.refresh_token || current.refresh_token || ""),
      expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600) - 60,
      scope: payload.scope ? String(payload.scope) : GMAIL_SCOPES.join(" "),
      account
    };
    writeJsonFile(this.config.tokenFile, token);
    try {
      const profile = await this.getProfile();
      token.account = profile.emailAddress;
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
      throw new Error("GMAIL_NO_PENDING_DEVICE_LOGIN");
    }
  }
}

function openUrlBestEffort(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    execFile("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [url], { windowsHide: true }, (error) => {
      if (error) {
        execFile("cmd", ["/c", "start", "", url], { windowsHide: true }, () => undefined);
      }
    });
    return;
  }
  const command = platform === "darwin" ? "open" : "xdg-open";
  execFile(command, [url], { windowsHide: true }, () => undefined);
}

function withOptionalClientSecret(params: Record<string, string>, clientSecret: string): Record<string, string> {
  return clientSecret ? { ...params, client_secret: clientSecret } : params;
}

function waitForAuthCode(input: { port: number; state: string; authUrl: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url || "/", `http://127.0.0.1:${input.port}`);
        if (url.pathname !== "/oauth2callback") {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (error) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Gmail authorization failed. You can close this tab.");
          reject(new Error(`GMAIL_BROWSER_AUTH_FAILED:${error}`));
          server.close();
          return;
        }
        if (!code || state !== input.state) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Invalid Gmail authorization response. You can close this tab.");
          reject(new Error("GMAIL_BROWSER_AUTH_INVALID_RESPONSE"));
          server.close();
          return;
        }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("Gmail authorization complete. You can close this tab.");
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => openUrlBestEffort(input.authUrl));
  });
}

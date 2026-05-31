import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { MailboxReadService } from "../service/mailbox-read-service";
import { MailboxActionService } from "../service/mailbox-action-service";
import { AuthorizationService, type AuthContext } from "../service/authorization-service";
import { bearerToken, HermesPluginService, type LaunchRequestInput, type WorkspaceRegistrationInput } from "../service/hermes-plugin-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

export interface EmailHttpServerOptions {
  databasePath: string;
  staticRoot: string;
  host?: string;
  port?: number;
}

export function createEmailHttpServer(options: EmailHttpServerOptions) {
  const db = openMailDatabase(options.databasePath);
  runMigrations(db);
  const readService = new MailboxReadService(db);
  const actionService = new MailboxActionService(db);
  const authorizationService = new AuthorizationService(db);
  const hermesPluginService = new HermesPluginService(db, { port: options.port || Number(process.env.EMAIL_SERVICE_PORT || 5175) });

  return createServer((request, response) => {
    void handleRequest(request, response, readService, actionService, authorizationService, hermesPluginService, options.staticRoot);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  readService: MailboxReadService,
  actionService: MailboxActionService,
  authorizationService: AuthorizationService,
  hermesPluginService: HermesPluginService,
  staticRoot: string
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/v1/hermes/plugin/manifest") {
      return sendJson(response, hermesPluginService.manifest());
    }
    if (request.method === "POST" && url.pathname === "/api/v1/hermes/plugin/workspaces") {
      const body = await readJsonBody<WorkspaceRegistrationInput>(request);
      const result = hermesPluginService.registerWorkspace(body, bearerToken(request.headers.authorization));
      return sendJson(response, result.payload, result.statusCode);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/hermes/plugin/launch") {
      const body = await readJsonBody<LaunchRequestInput>(request);
      const result = hermesPluginService.launch(body, bearerToken(request.headers.authorization));
      return sendJson(response, result.payload, result.statusCode);
    }
    const context = authContextFromRequest(request, url, authorizationService);
    if (request.method === "GET" && url.pathname === "/api/accounts") {
      return sendJson(response, { accounts: readService.listAccounts(context) }, 200, launchCookieHeaders(url));
    }
    if (request.method === "GET" && url.pathname === "/api/folders") {
      const accountId = url.searchParams.get("accountId");
      if (!accountId) {
        return sendJson(response, { error: "accountId_required" }, 400);
      }
      return sendJson(response, { folders: readService.listFolders(context, accountId) });
    }
    if (request.method === "GET" && url.pathname === "/api/messages") {
      return sendJson(response, {
        messages: readService.listMessages(context, {
          folderId: url.searchParams.get("folderId") || undefined,
          query: url.searchParams.get("query") || undefined,
          limit: Number(url.searchParams.get("limit") || 100)
        })
      });
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/messages/")) {
      const messageId = decodeURIComponent(url.pathname.slice("/api/messages/".length));
      const message = readService.getMessage(context, messageId);
      if (!message) {
        return sendJson(response, { error: "message_not_found" }, 404);
      }
      return sendJson(response, { message });
    }
    if (request.method === "PATCH" && url.pathname.match(/^\/api\/messages\/[^/]+\/read$/)) {
      const messageId = decodeURIComponent(url.pathname.replace(/^\/api\/messages\//, "").replace(/\/read$/, ""));
      const body = await readJsonBody<{ accountId?: string; isRead?: boolean }>(request);
      if (!body.accountId || typeof body.isRead !== "boolean") {
        return sendJson(response, { error: "invalid_read_request" }, 400);
      }
      const result = actionService.setReadState(context, { accountId: body.accountId, messageId, isRead: body.isRead });
      return sendJson(response, result, result.error === "account_forbidden" ? 403 : result.error ? 404 : 200);
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/messages/")) {
      const messageId = decodeURIComponent(url.pathname.slice("/api/messages/".length));
      const body = await readJsonBody<{ accountId?: string }>(request);
      if (!body.accountId) {
        return sendJson(response, { error: "accountId_required" }, 400);
      }
      const result = actionService.deleteLocal(context, { accountId: body.accountId, messageId });
      return sendJson(response, result, result.error === "account_forbidden" ? 403 : result.error ? 404 : 200);
    }
    return serveStatic(response, staticRoot, url.pathname, launchCookieHeaders(url));
  } catch (error) {
    return sendJson(response, { error: error instanceof Error ? error.message.split(":")[0] : "internal_error" }, 500);
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(response: ServerResponse, payload: unknown, status = 200, extraHeaders: Record<string, string | string[]> = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  response.end(body);
}

function serveStatic(response: ServerResponse, staticRoot: string, pathname: string, extraHeaders: Record<string, string | string[]> = {}) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = normalize(join(staticRoot, relative));
  const root = normalize(staticRoot);
  const file = resolved.startsWith(root) && existsSync(resolved) && statSync(resolved).isFile()
    ? resolved
    : join(staticRoot, "index.html");
  response.writeHead(200, {
    "content-type": contentType(file),
    "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    ...extraHeaders
  });
  createReadStream(file).pipe(response);
}

function authContextFromRequest(request: IncomingMessage, url: URL, authorizationService: AuthorizationService): AuthContext {
  const token = url.searchParams.get("launch") || request.headers["x-email-session"]?.toString() || cookieValue(request.headers.cookie || "", "email_session");
  return authorizationService.contextFromSessionToken(token) || authorizationService.ensureBootstrapAdmin();
}

function launchCookieHeaders(url: URL): Record<string, string> {
  const launch = url.searchParams.get("launch");
  if (!launch) {
    return {};
  }
  return {
    "set-cookie": `email_session=${encodeURIComponent(launch)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
  };
}

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}


function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

import { randomBytes } from "node:crypto";
import {
  AccountRepository,
  FolderRepository,
  MessageRepository,
  PluginSessionRepository,
  PluginUserRepository,
  UserMailAccountRepository,
  type PluginUserRecord
} from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: PluginUserRecord["role"];
  allowedAccountIds: string[];
  mode: "bootstrap-admin" | "launch-session";
}

export interface LaunchInput {
  workspaceId: string;
  userId: string;
  role?: PluginUserRecord["role"];
  displayName?: string;
  allowedAccountIds?: string[];
  ttlSeconds?: number;
}

export class AuthorizationService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly users: PluginUserRepository;
  private readonly userAccounts: UserMailAccountRepository;
  private readonly sessions: PluginSessionRepository;

  constructor(db: SqliteDatabase) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.users = new PluginUserRepository(db);
    this.userAccounts = new UserMailAccountRepository(db);
    this.sessions = new PluginSessionRepository(db);
  }

  ensureBootstrapAdmin(): AuthContext {
    const user = {
      id: "local-admin",
      externalUserId: "local-admin",
      workspaceId: "local",
      displayName: "Local administrator",
      role: "admin" as const
    };
    this.users.upsert(user);
    this.userAccounts.bindUnownedAccountsToUser(user.id);
    return {
      userId: user.id,
      workspaceId: user.workspaceId,
      role: user.role,
      allowedAccountIds: this.accounts.list().map((account) => account.id),
      mode: "bootstrap-admin"
    };
  }

  createLaunchSession(input: LaunchInput): { token: string; entryPath: string; expiresAt: string; context: AuthContext } {
    const role = input.role || "member";
    const userId = localUserId(input.workspaceId, input.userId);
    this.users.upsert({
      id: userId,
      externalUserId: input.userId,
      workspaceId: input.workspaceId,
      displayName: input.displayName || null,
      role
    });

    const existingAllowed = this.userAccounts.listAccountIdsForUser(userId);
    const requested = input.allowedAccountIds || existingAllowed;
    const existingAccountIds = new Set(this.accounts.list().map((account) => account.id));
    const allowed = requested.filter((accountId) => existingAccountIds.has(accountId));
    if (role === "admin" || role === "owner") {
      for (const accountId of allowed) {
        this.userAccounts.grant({ userId, accountId, accessRole: role === "owner" ? "owner" : "admin" });
      }
    }

    const token = `sess-${randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + Math.max(input.ttlSeconds || 3600, 60) * 1000).toISOString();
    this.sessions.create({ id: token, userId, workspaceId: input.workspaceId, role, allowedAccountIds: allowed, expiresAt });
    return {
      token,
      entryPath: `/?embed=hermes&launch=${encodeURIComponent(token)}`,
      expiresAt,
      context: { userId, workspaceId: input.workspaceId, role, allowedAccountIds: allowed, mode: "launch-session" }
    };
  }

  contextFromSessionToken(token?: string | null): AuthContext | null {
    if (!token) {
      return null;
    }
    const session = this.sessions.getValid(token);
    if (!session) {
      return null;
    }
    return {
      userId: session.userId,
      workspaceId: session.workspaceId,
      role: session.role,
      allowedAccountIds: session.allowedAccountIds,
      mode: "launch-session"
    };
  }

  canAccessAccount(context: AuthContext, accountId: string): boolean {
    return context.allowedAccountIds.includes(accountId);
  }

  canAccessFolder(context: AuthContext, folderId: string): boolean {
    const folder = this.folders.get(folderId);
    return Boolean(folder && this.canAccessAccount(context, folder.accountId));
  }

  canAccessMessage(context: AuthContext, messageId: string): boolean {
    const message = this.messages.get(messageId);
    return Boolean(message && this.canAccessAccount(context, message.accountId));
  }
}

function localUserId(workspaceId: string, externalUserId: string): string {
  return `user-${workspaceId}-${externalUserId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
}

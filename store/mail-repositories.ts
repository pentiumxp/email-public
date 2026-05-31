import type { SqliteDatabase } from "./sqlite-store";

export type AccountStatus = "connected" | "needs-auth" | "error" | "disabled";

export interface MailAccountRecord {
  id: string;
  provider: "outlook" | "gmail" | "alimail" | "imap";
  displayAddress: string;
  accountLabel: string;
  status: AccountStatus;
  lastSyncAt?: string | null;
  lastErrorCode?: string | null;
}

export interface MailFolderRecord {
  id: string;
  accountId: string;
  providerFolderId: string;
  displayName: string;
  folderType?: string;
  messageCount?: number;
  unreadCount?: number;
}

export interface MailMessageRecord {
  id: string;
  accountId: string;
  folderId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId?: string | null;
  subject: string;
  senderDisplay?: string | null;
  senderAddressBounded?: string | null;
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  attachmentCount: number;
  bodyState?: string;
  isDeleted?: boolean;
}

export interface MailMessageBodyRecord {
  messageId: string;
  sanitizedExcerpt: string;
  indexedText: string;
  contentSource?: string;
}

export interface MailMessageDetailRecord extends MailMessageRecord {
  sanitizedExcerpt: string | null;
  indexedText: string | null;
  contentSource: string | null;
}

export interface MailAttachmentRecord {
  id: string;
  messageId: string;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  availabilityState?: string;
}

export interface SyncCursorRecord {
  accountId: string;
  folderId: string;
  cursor: string | null;
  cursorType?: string;
}

export interface PluginUserRecord {
  id: string;
  externalUserId: string;
  workspaceId: string;
  displayName?: string | null;
  role: "owner" | "admin" | "member";
}

export interface PluginSessionRecord {
  id: string;
  userId: string;
  workspaceId: string;
  role: PluginUserRecord["role"];
  allowedAccountIds: string[];
  expiresAt: string;
}

export interface HermesWorkspaceRecord {
  id: string;
  workspaceName: string;
  displayName: string;
  workspaceRoot: string;
  status: "manual_required" | "pending" | "active" | "provisioning_failed";
  keyHash: string;
  configFile: string;
  accessKeyFile: string;
}

export class AccountRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(account: MailAccountRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO mail_accounts (
        id, provider, display_address, account_label, status, last_sync_at, last_error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        display_address = excluded.display_address,
        account_label = excluded.account_label,
        status = excluded.status,
        last_sync_at = excluded.last_sync_at,
        last_error_code = excluded.last_error_code,
        updated_at = excluded.updated_at`
    ).run(
      account.id,
      account.provider,
      account.displayAddress,
      account.accountLabel,
      account.status,
      account.lastSyncAt ?? null,
      account.lastErrorCode ?? null,
      now,
      now
    );
  }

  list(): MailAccountRecord[] {
    return this.db.prepare("SELECT * FROM mail_accounts ORDER BY account_label").all().map((row) => ({
      id: String(row.id),
      provider: row.provider as MailAccountRecord["provider"],
      displayAddress: String(row.display_address),
      accountLabel: String(row.account_label),
      status: row.status as AccountStatus,
      lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
      lastErrorCode: row.last_error_code ? String(row.last_error_code) : null
    }));
  }

  listByIds(accountIds: string[]): MailAccountRecord[] {
    if (accountIds.length === 0) {
      return [];
    }
    const placeholders = accountIds.map(() => "?").join(",");
    return this.db.prepare(`SELECT * FROM mail_accounts WHERE id IN (${placeholders}) ORDER BY account_label`).all(...accountIds).map((row) => ({
      id: String(row.id),
      provider: row.provider as MailAccountRecord["provider"],
      displayAddress: String(row.display_address),
      accountLabel: String(row.account_label),
      status: row.status as AccountStatus,
      lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
      lastErrorCode: row.last_error_code ? String(row.last_error_code) : null
    }));
  }
}

export class FolderRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(folder: MailFolderRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO mail_folders (
        id, account_id, provider_folder_id, display_name, folder_type, message_count, unread_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, provider_folder_id) DO UPDATE SET
        display_name = excluded.display_name,
        folder_type = excluded.folder_type,
        message_count = excluded.message_count,
        unread_count = excluded.unread_count,
        updated_at = excluded.updated_at`
    ).run(
      folder.id,
      folder.accountId,
      folder.providerFolderId,
      folder.displayName,
      folder.folderType ?? "custom",
      folder.messageCount ?? 0,
      folder.unreadCount ?? 0,
      now
    );
  }

  listByAccount(accountId: string): MailFolderRecord[] {
    return this.db.prepare("SELECT * FROM mail_folders WHERE account_id = ? ORDER BY folder_type, display_name").all(accountId).map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      providerFolderId: String(row.provider_folder_id),
      displayName: String(row.display_name),
      folderType: String(row.folder_type),
      messageCount: Number(row.message_count),
      unreadCount: Number(row.unread_count)
    }));
  }

  get(folderId: string): MailFolderRecord | null {
    const row = this.db.prepare("SELECT * FROM mail_folders WHERE id = ?").get(folderId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      providerFolderId: String(row.provider_folder_id),
      displayName: String(row.display_name),
      folderType: String(row.folder_type),
      messageCount: Number(row.message_count),
      unreadCount: Number(row.unread_count)
    };
  }
}

export class MessageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(message: MailMessageRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO mail_messages (
        id, account_id, folder_id, provider, provider_message_id, provider_thread_id, subject,
        sender_display, sender_address_bounded, received_at, is_read, has_attachments,
        attachment_count, body_state, is_deleted, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, provider_message_id) DO UPDATE SET
        folder_id = excluded.folder_id,
        provider_thread_id = excluded.provider_thread_id,
        subject = excluded.subject,
        sender_display = excluded.sender_display,
        sender_address_bounded = excluded.sender_address_bounded,
        received_at = excluded.received_at,
        is_read = excluded.is_read,
        has_attachments = excluded.has_attachments,
        attachment_count = excluded.attachment_count,
        body_state = excluded.body_state,
        is_deleted = excluded.is_deleted,
        sync_version = mail_messages.sync_version + 1,
        updated_at = excluded.updated_at`
    ).run(
      message.id,
      message.accountId,
      message.folderId,
      message.provider,
      message.providerMessageId,
      message.providerThreadId ?? null,
      message.subject,
      message.senderDisplay ?? null,
      message.senderAddressBounded ?? null,
      message.receivedAt,
      message.isRead ? 1 : 0,
      message.hasAttachments ? 1 : 0,
      message.attachmentCount,
      message.bodyState ?? "metadata-only",
      message.isDeleted ? 1 : 0,
      now
    );
  }

  listRecent(limit = 50): MailMessageRecord[] {
    return this.db.prepare(
      `SELECT * FROM mail_messages
       WHERE is_deleted = 0
       ORDER BY received_at DESC
       LIMIT ?`
    ).all(limit).map(mapMessageRow);
  }

  listByFolder(folderId: string, limit = 100): MailMessageRecord[] {
    return this.db.prepare(
      `SELECT * FROM mail_messages
       WHERE is_deleted = 0 AND folder_id = ?
       ORDER BY received_at DESC
       LIMIT ?`
    ).all(folderId, limit).map(mapMessageRow);
  }

  search(query: string, limit = 50): MailMessageRecord[] {
    const pattern = `%${query}%`;
    return this.db.prepare(
      `SELECT * FROM mail_messages
       WHERE is_deleted = 0
         AND (subject LIKE ? OR sender_display LIKE ? OR sender_address_bounded LIKE ?)
       ORDER BY received_at DESC
       LIMIT ?`
    ).all(pattern, pattern, pattern, limit).map(mapMessageRow);
  }

  listRecentForAccounts(accountIds: string[], limit = 50): MailMessageRecord[] {
    if (accountIds.length === 0) {
      return [];
    }
    const placeholders = accountIds.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT * FROM mail_messages
       WHERE is_deleted = 0 AND account_id IN (${placeholders})
       ORDER BY received_at DESC
       LIMIT ?`
    ).all(...accountIds, limit).map(mapMessageRow);
  }

  searchForAccounts(accountIds: string[], query: string, limit = 50): MailMessageRecord[] {
    if (accountIds.length === 0) {
      return [];
    }
    const placeholders = accountIds.map(() => "?").join(",");
    const pattern = `%${query}%`;
    return this.db.prepare(
      `SELECT * FROM mail_messages
       WHERE is_deleted = 0
         AND account_id IN (${placeholders})
         AND (subject LIKE ? OR sender_display LIKE ? OR sender_address_bounded LIKE ?)
       ORDER BY received_at DESC
       LIMIT ?`
    ).all(...accountIds, pattern, pattern, pattern, limit).map(mapMessageRow);
  }

  countByFolder(folderId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE folder_id = ?").get(folderId) as { count: number };
    return Number(row.count);
  }

  markDeletedByProviderMessageId(accountId: string, providerMessageId: string): boolean {
    const result = this.db.prepare(
      `UPDATE mail_messages
       SET is_deleted = 1, sync_version = sync_version + 1, updated_at = ?
       WHERE account_id = ? AND provider_message_id = ?`
    ).run(new Date().toISOString(), accountId, providerMessageId) as { changes: number };
    return Number(result.changes) > 0;
  }

  setReadState(messageId: string, isRead: boolean): boolean {
    const result = this.db.prepare(
      `UPDATE mail_messages
       SET is_read = ?, sync_version = sync_version + 1, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).run(isRead ? 1 : 0, new Date().toISOString(), messageId) as { changes: number };
    return Number(result.changes) > 0;
  }

  markDeleted(messageId: string): boolean {
    const result = this.db.prepare(
      `UPDATE mail_messages
       SET is_deleted = 1, sync_version = sync_version + 1, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).run(new Date().toISOString(), messageId) as { changes: number };
    return Number(result.changes) > 0;
  }

  getDetail(messageId: string): MailMessageDetailRecord | null {
    const row = this.db.prepare(
      `SELECT m.*, b.sanitized_excerpt, b.indexed_text, b.content_source
       FROM mail_messages m
       LEFT JOIN mail_message_bodies b ON b.message_id = m.id
       WHERE m.id = ? AND m.is_deleted = 0`
    ).get(messageId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      ...mapMessageRow(row),
      sanitizedExcerpt: row.sanitized_excerpt ? String(row.sanitized_excerpt) : null,
      indexedText: row.indexed_text ? String(row.indexed_text) : null,
      contentSource: row.content_source ? String(row.content_source) : null
    };
  }

  get(messageId: string): MailMessageRecord | null {
    const row = this.db.prepare("SELECT * FROM mail_messages WHERE id = ? AND is_deleted = 0").get(messageId) as Record<string, unknown> | undefined;
    return row ? mapMessageRow(row) : null;
  }
}

export class MessageBodyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(body: MailMessageBodyRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO mail_message_bodies (
        message_id, sanitized_excerpt, indexed_text, content_source, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        sanitized_excerpt = excluded.sanitized_excerpt,
        indexed_text = excluded.indexed_text,
        content_source = excluded.content_source,
        updated_at = excluded.updated_at`
    ).run(body.messageId, body.sanitizedExcerpt, body.indexedText, body.contentSource ?? "provider-body-text", now);
  }
}

export class AttachmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  replaceForMessage(messageId: string, attachments: MailAttachmentRecord[]): void {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM mail_attachments WHERE message_id = ?").run(messageId);
    const insert = this.db.prepare(
      `INSERT INTO mail_attachments (
        id, message_id, filename, content_type, size_bytes, availability_state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const attachment of attachments) {
      insert.run(
        attachment.id,
        messageId,
        attachment.filename,
        attachment.contentType ?? null,
        attachment.sizeBytes ?? null,
        attachment.availabilityState ?? "metadata-only",
        now
      );
    }
  }

  listByMessage(messageId: string): MailAttachmentRecord[] {
    return this.db.prepare(
      `SELECT id, message_id, filename, content_type, size_bytes, availability_state
       FROM mail_attachments
       WHERE message_id = ?
       ORDER BY filename`
    ).all(messageId).map((row) => ({
      id: String(row.id),
      messageId: String(row.message_id),
      filename: String(row.filename),
      contentType: row.content_type ? String(row.content_type) : null,
      sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
      availabilityState: String(row.availability_state)
    }));
  }
}

export class SyncCursorRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(cursor: SyncCursorRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO mail_sync_cursors (
        account_id, folder_id, cursor, cursor_type, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, folder_id) DO UPDATE SET
        cursor = excluded.cursor,
        cursor_type = excluded.cursor_type,
        updated_at = excluded.updated_at`
    ).run(cursor.accountId, cursor.folderId, cursor.cursor, cursor.cursorType ?? "graph-nextlink", now);
  }

  get(accountId: string, folderId: string): SyncCursorRecord | null {
    const row = this.db.prepare(
      "SELECT account_id, folder_id, cursor, cursor_type FROM mail_sync_cursors WHERE account_id = ? AND folder_id = ?"
    ).get(accountId, folderId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      accountId: String(row.account_id),
      folderId: String(row.folder_id),
      cursor: row.cursor ? String(row.cursor) : null,
      cursorType: row.cursor_type ? String(row.cursor_type) : "graph-nextlink"
    };
  }
}

export class ActionAuditRepository {
  constructor(private readonly db: SqliteDatabase) {}

  record(input: { accountId: string; messageId?: string | null; actionType: string; status: string; providerResultCode?: string | null }): string {
    const now = new Date().toISOString();
    const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.db.prepare(
      `INSERT INTO mail_actions (
        id, account_id, message_id, action_type, status, provider_result_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.accountId, input.messageId ?? null, input.actionType, input.status, input.providerResultCode ?? null, now, now);
    return id;
  }
}

export class PluginUserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(user: PluginUserRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO plugin_users (id, external_user_id, workspace_id, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(external_user_id, workspace_id) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         updated_at = excluded.updated_at`
    ).run(user.id, user.externalUserId, user.workspaceId, user.displayName ?? null, user.role, now, now);
  }

  get(id: string): PluginUserRecord | null {
    const row = this.db.prepare("SELECT * FROM plugin_users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapPluginUserRow(row) : null;
  }
}

export class UserMailAccountRepository {
  constructor(private readonly db: SqliteDatabase) {}

  grant(input: { userId: string; accountId: string; accessRole?: string }): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO user_mail_accounts (user_id, account_id, access_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, account_id) DO UPDATE SET
         access_role = excluded.access_role,
         updated_at = excluded.updated_at`
    ).run(input.userId, input.accountId, input.accessRole ?? "owner", now, now);
  }

  listAccountIdsForUser(userId: string): string[] {
    return this.db.prepare("SELECT account_id FROM user_mail_accounts WHERE user_id = ? ORDER BY account_id").all(userId).map((row) => String(row.account_id));
  }

  bindUnownedAccountsToUser(userId: string): number {
    const accounts = this.db.prepare(
      `SELECT id FROM mail_accounts
       WHERE id NOT IN (SELECT account_id FROM user_mail_accounts)`
    ).all();
    for (const account of accounts) {
      this.grant({ userId, accountId: String(account.id), accessRole: "owner" });
    }
    return accounts.length;
  }
}

export class PluginSessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(session: PluginSessionRecord): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO plugin_sessions (id, user_id, workspace_id, role, allowed_account_ids, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(session.id, session.userId, session.workspaceId, session.role, JSON.stringify(session.allowedAccountIds), session.expiresAt, now);
  }

  getValid(id: string, now = new Date()): PluginSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM plugin_sessions WHERE id = ? AND expires_at > ?").get(id, now.toISOString()) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      workspaceId: String(row.workspace_id),
      role: row.role as PluginSessionRecord["role"],
      allowedAccountIds: parseStringArray(row.allowed_account_ids),
      expiresAt: String(row.expires_at)
    };
  }
}

export class HermesWorkspaceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(workspace: HermesWorkspaceRecord): { created: boolean } {
    const now = new Date().toISOString();
    const existing = this.get(workspace.id);
    this.db.prepare(
      `INSERT INTO hermes_workspaces (
        id, workspace_name, display_name, workspace_root, status, key_hash, config_file, access_key_file, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_name = excluded.workspace_name,
        display_name = excluded.display_name,
        workspace_root = excluded.workspace_root,
        status = excluded.status,
        key_hash = excluded.key_hash,
        config_file = excluded.config_file,
        access_key_file = excluded.access_key_file,
        updated_at = excluded.updated_at`
    ).run(
      workspace.id,
      workspace.workspaceName,
      workspace.displayName,
      workspace.workspaceRoot,
      workspace.status,
      workspace.keyHash,
      workspace.configFile,
      workspace.accessKeyFile,
      now,
      now
    );
    return { created: !existing };
  }

  get(id: string): HermesWorkspaceRecord | null {
    const row = this.db.prepare("SELECT * FROM hermes_workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapHermesWorkspaceRow(row) : null;
  }

  findByKeyHash(keyHash: string): HermesWorkspaceRecord | null {
    const row = this.db.prepare("SELECT * FROM hermes_workspaces WHERE key_hash = ?").get(keyHash) as Record<string, unknown> | undefined;
    return row ? mapHermesWorkspaceRow(row) : null;
  }
}

function mapMessageRow(row: Record<string, unknown>): MailMessageRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    folderId: String(row.folder_id),
    provider: String(row.provider),
    providerMessageId: String(row.provider_message_id),
    providerThreadId: row.provider_thread_id ? String(row.provider_thread_id) : null,
    subject: String(row.subject),
    senderDisplay: row.sender_display ? String(row.sender_display) : null,
    senderAddressBounded: row.sender_address_bounded ? String(row.sender_address_bounded) : null,
    receivedAt: String(row.received_at),
    isRead: Number(row.is_read) === 1,
    hasAttachments: Number(row.has_attachments) === 1,
    attachmentCount: Number(row.attachment_count),
    bodyState: String(row.body_state),
    isDeleted: Number(row.is_deleted) === 1
  };
}

function mapPluginUserRow(row: Record<string, unknown>): PluginUserRecord {
  return {
    id: String(row.id),
    externalUserId: String(row.external_user_id),
    workspaceId: String(row.workspace_id),
    displayName: row.display_name ? String(row.display_name) : null,
    role: row.role as PluginUserRecord["role"]
  };
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapHermesWorkspaceRow(row: Record<string, unknown>): HermesWorkspaceRecord {
  return {
    id: String(row.id),
    workspaceName: String(row.workspace_name),
    displayName: String(row.display_name),
    workspaceRoot: String(row.workspace_root),
    status: row.status as HermesWorkspaceRecord["status"],
    keyHash: String(row.key_hash),
    configFile: String(row.config_file),
    accessKeyFile: String(row.access_key_file)
  };
}

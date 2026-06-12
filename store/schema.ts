export const CURRENT_SCHEMA_VERSION = 1;

export const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mail_accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_address TEXT NOT NULL,
    account_label TEXT NOT NULL,
    status TEXT NOT NULL,
    last_sync_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mail_folders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_folder_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    folder_type TEXT NOT NULL DEFAULT 'custom',
    message_count INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, provider_folder_id),
    FOREIGN KEY(account_id) REFERENCES mail_accounts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_message_id TEXT NOT NULL,
    provider_thread_id TEXT,
    subject TEXT NOT NULL,
    sender_display TEXT,
    sender_address_bounded TEXT,
    received_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    body_state TEXT NOT NULL DEFAULT 'metadata-only',
    sync_version INTEGER NOT NULL DEFAULT 1,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    moved_to_folder_id TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, provider_message_id),
    FOREIGN KEY(account_id) REFERENCES mail_accounts(id),
    FOREIGN KEY(folder_id) REFERENCES mail_folders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_message_bodies (
    message_id TEXT PRIMARY KEY,
    sanitized_excerpt TEXT,
    indexed_text TEXT,
    content_source TEXT NOT NULL DEFAULT 'provider-body-text',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES mail_messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER,
    availability_state TEXT NOT NULL DEFAULT 'metadata-only',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES mail_messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_attachment_blobs (
    attachment_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    content BLOB NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(attachment_id) REFERENCES mail_attachments(id) ON DELETE CASCADE,
    FOREIGN KEY(message_id) REFERENCES mail_messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_sync_cursors (
    account_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    cursor TEXT,
    cursor_type TEXT NOT NULL DEFAULT 'provider-delta',
    updated_at TEXT NOT NULL,
    PRIMARY KEY(account_id, folder_id),
    FOREIGN KEY(account_id) REFERENCES mail_accounts(id),
    FOREIGN KEY(folder_id) REFERENCES mail_folders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_actions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    message_id TEXT,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_result_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES mail_accounts(id),
    FOREIGN KEY(message_id) REFERENCES mail_messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_analysis_marks (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    mark_type TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES mail_messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_users (
    id TEXT PRIMARY KEY,
    external_user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(external_user_id, workspace_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_mail_accounts (
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, account_id),
    FOREIGN KEY(user_id) REFERENCES plugin_users(id),
    FOREIGN KEY(account_id) REFERENCES mail_accounts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    role TEXT NOT NULL,
    allowed_account_ids TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES plugin_users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS hermes_workspaces (
    id TEXT PRIMARY KEY,
    workspace_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    status TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    config_file TEXT NOT NULL,
    access_key_file TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))`
];

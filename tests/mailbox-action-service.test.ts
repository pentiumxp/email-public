import { describe, expect, it } from "vitest";
import { MailboxActionService } from "../service/mailbox-action-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("MailboxActionService", () => {
  it("applies local read state and delete tombstone with audit rows", () => {
    const db = openMailDatabase();
    runMigrations(db);
    db.exec(`
      INSERT INTO mail_accounts(id, provider, display_address, account_label, status, created_at, updated_at)
      VALUES ('acct-1', 'outlook', 'user@example.local', 'User', 'connected', datetime('now'), datetime('now'));
      INSERT INTO mail_folders(id, account_id, provider_folder_id, display_name, updated_at)
      VALUES ('folder-1', 'acct-1', 'inbox', 'Inbox', datetime('now'));
      INSERT INTO mail_messages(id, account_id, folder_id, provider, provider_message_id, subject, received_at, is_read, has_attachments, attachment_count, updated_at)
      VALUES ('msg-1', 'acct-1', 'folder-1', 'outlook', 'provider-1', 'Subject', '2026-05-31T00:00:00.000Z', 0, 0, 0, datetime('now'));
    `);

    const service = new MailboxActionService(db);
    const context = { userId: "user-1", workspaceId: "workspace-1", role: "member" as const, allowedAccountIds: ["acct-1"], mode: "launch-session" as const };
    expect(service.setReadState(context, { accountId: "acct-1", messageId: "msg-1", isRead: true })).toMatchObject({ changed: true, remoteApplied: false });
    expect(db.prepare("SELECT is_read FROM mail_messages WHERE id = 'msg-1'").get()).toEqual({ is_read: 1 });

    expect(service.deleteLocal(context, { accountId: "acct-1", messageId: "msg-1" })).toMatchObject({ changed: true, remoteApplied: false });
    expect(db.prepare("SELECT is_deleted FROM mail_messages WHERE id = 'msg-1'").get()).toEqual({ is_deleted: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mail_actions").get()).toEqual({ count: 2 });
  });
});

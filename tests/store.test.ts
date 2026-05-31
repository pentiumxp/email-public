import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository, FolderRepository, MessageRepository } from "../store/mail-repositories";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("mail store", () => {
  const db = openMailDatabase();
  runMigrations(db);

  afterEach(() => {
    db.exec("DELETE FROM mail_analysis_marks; DELETE FROM mail_actions; DELETE FROM mail_sync_cursors; DELETE FROM mail_attachments; DELETE FROM mail_message_bodies; DELETE FROM mail_messages; DELETE FROM mail_folders; DELETE FROM mail_accounts;");
  });

  it("creates schema and records migration version", () => {
    const row = db.prepare("SELECT version FROM schema_migrations WHERE version = 1").get();
    expect(row).toEqual({ version: 1 });
  });

  it("upserts accounts, folders, and duplicate provider messages idempotently", () => {
    const accounts = new AccountRepository(db);
    const folders = new FolderRepository(db);
    const messages = new MessageRepository(db);

    accounts.upsert({
      id: "acct-1",
      provider: "outlook",
      displayAddress: "outlook@example.local",
      accountLabel: "Outlook",
      status: "connected"
    });
    folders.upsert({
      id: "folder-1",
      accountId: "acct-1",
      providerFolderId: "inbox",
      displayName: "Inbox"
    });

    const baseMessage = {
      id: "msg-1",
      accountId: "acct-1",
      folderId: "folder-1",
      provider: "outlook",
      providerMessageId: "provider-msg-1",
      subject: "First subject",
      senderDisplay: "Sender",
      senderAddressBounded: "sender@example.local",
      receivedAt: "2026-05-31T00:00:00.000Z",
      isRead: false,
      hasAttachments: false,
      attachmentCount: 0
    };

    messages.upsert(baseMessage);
    messages.upsert({ ...baseMessage, id: "msg-ignored", subject: "Updated subject", isRead: true });

    const rows = messages.listRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("msg-1");
    expect(rows[0].subject).toBe("Updated subject");
    expect(rows[0].isRead).toBe(true);
  });
});


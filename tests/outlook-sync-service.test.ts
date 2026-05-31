import { describe, expect, it } from "vitest";
import { OutlookSyncService } from "../service/outlook-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";
import type { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";

describe("OutlookSyncService", () => {
  it("syncs folders, messages, bodies, and attachment metadata without remote writes", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const fakeGraph = {
      async getMe() {
        return { mail: "user@example.local", userPrincipalName: "user@example.local", displayName: "User" };
      },
      async listFolders() {
        return [{ id: "inbox", displayName: "Inbox", totalItemCount: 1, unreadItemCount: 1 }];
      },
      async listMessagesPage(_folderId: string, nextLink?: string | null) {
        if (nextLink) {
          return { messages: [], nextLink: null };
        }
        return {
          nextLink: null,
          messages: [{
            id: "msg-1",
            conversationId: "thread-1",
            parentFolderId: "inbox",
            subject: "Hello",
            from: { emailAddress: { name: "Sender", address: "sender@example.local" } },
            receivedDateTime: "2026-05-31T00:00:00.000Z",
            isRead: false,
            hasAttachments: true,
            body: { contentType: "html", content: "<p>Hello <strong>body</strong></p>" }
          }]
        };
      },
      async listAttachmentMetadata() {
        return [{ id: "att-1", name: "file.pdf", contentType: "application/pdf", size: 123 }];
      }
    } as unknown as MicrosoftGraphClient;

    const summary = await new OutlookSyncService(fakeGraph, db).syncAll();

    expect(summary).toMatchObject({ foldersSeen: 1, messagesSeen: 1, messagesWithAttachments: 1, attachmentMetadataSeen: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mail_messages").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT indexed_text FROM mail_message_bodies").get()).toEqual({ indexed_text: "Hello body" });
    expect(db.prepare("SELECT filename FROM mail_attachments").get()).toEqual({ filename: "file.pdf" });
  });

  it("resumes from a stored next link instead of restarting a folder", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    db.exec(`
      INSERT INTO mail_accounts(id, provider, display_address, account_label, status, created_at, updated_at)
      VALUES ('outlook-hotmail-primary', 'outlook', 'user@example.local', 'User', 'connected', datetime('now'), datetime('now'));
      INSERT INTO mail_folders(id, account_id, provider_folder_id, display_name, message_count, unread_count, updated_at)
      VALUES ('outlook-folder-inbox', 'outlook-hotmail-primary', 'inbox', 'Inbox', 2, 0, datetime('now'));
      INSERT INTO mail_sync_cursors(account_id, folder_id, cursor, cursor_type, updated_at)
      VALUES ('outlook-hotmail-primary', 'outlook-folder-inbox', 'https://graph.example/next', 'graph-nextlink', datetime('now'));
    `);
    const seenNextLinks: Array<string | null | undefined> = [];
    const fakeGraph = {
      async getMe() {
        return { mail: "user@example.local", userPrincipalName: "user@example.local", displayName: "User" };
      },
      async listFolders() {
        return [{ id: "inbox", displayName: "Inbox", totalItemCount: 2, unreadItemCount: 0 }];
      },
      async listMessagesPage(_folderId: string, nextLink?: string | null) {
        seenNextLinks.push(nextLink);
        return { messages: [], nextLink: null };
      },
      async listAttachmentMetadata() {
        return [];
      }
    } as unknown as MicrosoftGraphClient;

    await new OutlookSyncService(fakeGraph, db).syncAll();
    expect(seenNextLinks).toEqual(["https://graph.example/next"]);
  });
});

import { describe, expect, it } from "vitest";
import type { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { OutlookDeltaSyncService } from "../service/outlook-delta-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("OutlookDeltaSyncService", () => {
  it("stores delta links after initial delta traversal", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const fakeGraph = {
      async getMe() {
        return { mail: "user@example.local", userPrincipalName: "user@example.local", displayName: "User" };
      },
      async listFolders() {
        return [{ id: "inbox", displayName: "Inbox", totalItemCount: 1, unreadItemCount: 0 }];
      },
      async listMessagesDeltaPage(_folderId: string, cursor?: string | null) {
        if (cursor === "next-1") {
          return { messages: [], nextLink: null, deltaLink: "delta-1" };
        }
        return {
          nextLink: "next-1",
          deltaLink: null,
          messages: [{
            id: "msg-1",
            conversationId: "thread-1",
            parentFolderId: "inbox",
            subject: "Hello",
            from: { emailAddress: { name: "Sender", address: "sender@example.local" } },
            receivedDateTime: "2026-05-31T00:00:00.000Z",
            isRead: false,
            hasAttachments: false,
            body: { contentType: "html", content: "<p>Hello</p>" }
          }]
        };
      },
      async listAttachmentMetadata() {
        return [];
      }
    } as unknown as MicrosoftGraphClient;

    const summary = await new OutlookDeltaSyncService(fakeGraph, db).syncOnce();
    expect(summary).toMatchObject({ messagesUpserted: 1, pagesSeen: 2 });
    expect(db.prepare("SELECT cursor, cursor_type FROM mail_sync_cursors").get()).toEqual({
      cursor: "delta-1",
      cursor_type: "graph-delta-link"
    });
  });

  it("uses stored delta links and tombstones removed messages", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    db.exec(`
      INSERT INTO mail_accounts(id, provider, display_address, account_label, status, created_at, updated_at)
      VALUES ('outlook-hotmail-primary', 'outlook', 'user@example.local', 'User', 'connected', datetime('now'), datetime('now'));
      INSERT INTO mail_folders(id, account_id, provider_folder_id, display_name, message_count, unread_count, updated_at)
      VALUES ('outlook-folder-inbox', 'outlook-hotmail-primary', 'inbox', 'Inbox', 1, 0, datetime('now'));
      INSERT INTO mail_messages(id, account_id, folder_id, provider, provider_message_id, subject, received_at, is_read, has_attachments, attachment_count, updated_at)
      VALUES ('outlook-msg-msg-1', 'outlook-hotmail-primary', 'outlook-folder-inbox', 'outlook', 'msg-1', 'Old', '2026-05-31T00:00:00.000Z', 1, 0, 0, datetime('now'));
      INSERT INTO mail_sync_cursors(account_id, folder_id, cursor, cursor_type, updated_at)
      VALUES ('outlook-hotmail-primary', 'outlook-folder-inbox', 'delta-1', 'graph-delta-link', datetime('now'));
    `);
    const seenCursors: Array<string | null | undefined> = [];
    const fakeGraph = {
      async getMe() {
        return { mail: "user@example.local", userPrincipalName: "user@example.local", displayName: "User" };
      },
      async listFolders() {
        return [{ id: "inbox", displayName: "Inbox", totalItemCount: 1, unreadItemCount: 0 }];
      },
      async listMessagesDeltaPage(_folderId: string, cursor?: string | null) {
        seenCursors.push(cursor);
        return { messages: [{ id: "msg-1", "@removed": { reason: "deleted" } }], nextLink: null, deltaLink: "delta-2" };
      },
      async listAttachmentMetadata() {
        return [];
      }
    } as unknown as MicrosoftGraphClient;

    const summary = await new OutlookDeltaSyncService(fakeGraph, db).syncOnce();
    expect(seenCursors).toEqual(["delta-1"]);
    expect(summary.messagesRemoved).toBe(1);
    expect(db.prepare("SELECT is_deleted FROM mail_messages WHERE provider_message_id = 'msg-1'").get()).toEqual({ is_deleted: 1 });
    expect(db.prepare("SELECT cursor FROM mail_sync_cursors").get()).toEqual({ cursor: "delta-2" });
  });
});

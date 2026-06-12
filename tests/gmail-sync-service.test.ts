import { describe, expect, it } from "vitest";
import type { GmailApiClient } from "../connectors/gmail/gmail-api-client";
import type { GmailRuntimeConfig } from "../connectors/gmail/gmail-config";
import { GmailSyncService } from "../service/gmail-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("GmailSyncService", () => {
  it("syncs Gmail labels, messages, text bodies, and attachment metadata as read-only data", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const config = { accountId: "gmail-primary", accountLabel: "Gmail" } as GmailRuntimeConfig;
    const fakeClient = {
      async getProfile() {
        return { emailAddress: "user@gmail.example", messagesTotal: 1, threadsTotal: 1, historyId: "1" };
      },
      async listLabels() {
        return [{ id: "INBOX", name: "INBOX", type: "system" }];
      },
      async getLabel() {
        return { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 12, messagesUnread: 3 };
      },
      async listMessagesPage() {
        return { messages: [{ id: "gmail-1", threadId: "thread-1" }], nextPageToken: null };
      },
      async getMessage() {
        return {
          id: "gmail-1",
          threadId: "thread-1",
          labelIds: ["INBOX", "UNREAD"],
          internalDate: String(new Date("2026-05-31T00:00:00.000Z").getTime()),
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "Subject", value: "Gmail hello" },
              { name: "From", value: "Sender <sender@example.local>" }
            ],
            parts: [
              { mimeType: "text/plain", body: { data: Buffer.from("hello body").toString("base64url"), size: 10 } },
              { mimeType: "application/pdf", filename: "file.pdf", body: { attachmentId: "att-1", size: 123 } }
            ]
          }
        };
      },
      async getAttachmentContent() {
        return Buffer.from("cached gmail attachment");
      }
    } as unknown as GmailApiClient;

    const summary = await new GmailSyncService(config, fakeClient, db).syncAll();

    expect(summary).toMatchObject({ foldersSeen: 1, messagesSeen: 1, foldersChanged: 1, attachmentMetadataSeen: 1, attachmentContentCached: 1 });
    expect(db.prepare("SELECT message_count, unread_count FROM mail_folders").get()).toEqual({ message_count: 12, unread_count: 3 });
    expect(db.prepare("SELECT provider, subject, is_read FROM mail_messages").get()).toEqual({ provider: "gmail", subject: "Gmail hello", is_read: 0 });
    expect(db.prepare("SELECT indexed_text FROM mail_message_bodies").get()).toEqual({ indexed_text: "hello body" });
    expect(db.prepare("SELECT filename, availability_state FROM mail_attachments").get()).toEqual({ filename: "file.pdf", availability_state: "cached-local" });
    expect(db.prepare("SELECT size_bytes FROM mail_attachment_blobs").get()).toEqual({ size_bytes: 23 });
    expect(db.prepare("SELECT cursor, cursor_type FROM mail_sync_cursors WHERE folder_id = 'gmail-folder-INBOX'").get()).toEqual({ cursor: "1", cursor_type: "gmail-history-id" });
  });

  it("uses Gmail history cursor for background incremental sync without rescanning label pages", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const config = { accountId: "gmail-primary", accountLabel: "Gmail" } as GmailRuntimeConfig;
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO mail_accounts (id, provider, display_address, account_label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("gmail-primary", "gmail", "user@gmail.example", "Gmail", "connected", now, now);
    db.prepare(
      "INSERT INTO mail_folders (id, account_id, provider_folder_id, display_name, folder_type, message_count, unread_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("gmail-folder-INBOX", "gmail-primary", "INBOX", "INBOX", "inbox", 0, 0, now);
    db.prepare(
      "INSERT INTO mail_sync_cursors (account_id, folder_id, cursor, cursor_type, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("gmail-primary", "gmail-folder-INBOX", "10", "gmail-history-id", now);
    let listMessagesCalls = 0;
    const fakeClient = {
      async getProfile() {
        return { emailAddress: "user@gmail.example", messagesTotal: 2, threadsTotal: 2, historyId: "12" };
      },
      async listLabels() {
        return [{ id: "INBOX", name: "INBOX", type: "system" }];
      },
      async getLabel() {
        return { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 2, messagesUnread: 1 };
      },
      async listMessagesPage() {
        listMessagesCalls += 1;
        return { messages: [], nextPageToken: null };
      },
      async listHistoryPage() {
        return {
          history: [{ id: "11", messagesAdded: [{ message: { id: "gmail-2", threadId: "thread-2" } }] }],
          historyId: "12",
          nextPageToken: null
        };
      },
      async getMessage() {
        return {
          id: "gmail-2",
          threadId: "thread-2",
          labelIds: ["INBOX"],
          internalDate: String(new Date("2026-06-01T00:00:00.000Z").getTime()),
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "Subject", value: "Incremental Gmail" },
              { name: "From", value: "Sender <sender@example.local>" }
            ],
            body: { data: Buffer.from("incremental body").toString("base64url"), size: 16 }
          }
        };
      }
    } as unknown as GmailApiClient;

    const summary = await new GmailSyncService(config, fakeClient, db).syncIncremental();

    expect(summary).toMatchObject({ syncMode: "history", foldersSeen: 1, messagesSeen: 1, foldersChanged: 1 });
    expect(listMessagesCalls).toBe(0);
    expect(db.prepare("SELECT subject FROM mail_messages").get()).toEqual({ subject: "Incremental Gmail" });
    expect(db.prepare("SELECT cursor FROM mail_sync_cursors WHERE folder_id = 'gmail-folder-INBOX'").get()).toEqual({ cursor: "12" });
  });

  it("seeds Gmail history cursor quickly when no incremental cursor exists", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const config = { accountId: "gmail-primary", accountLabel: "Gmail" } as GmailRuntimeConfig;
    let listMessagesCalls = 0;
    const fakeClient = {
      async getProfile() {
        return { emailAddress: "user@gmail.example", messagesTotal: 2, threadsTotal: 2, historyId: "20" };
      },
      async listLabels() {
        return [{ id: "INBOX", name: "INBOX", type: "system" }];
      },
      async getLabel() {
        return { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 2, messagesUnread: 1 };
      },
      async listMessagesPage() {
        listMessagesCalls += 1;
        return { messages: [], nextPageToken: null };
      },
      async listHistoryPage() {
        throw new Error("should not read history before seeding cursor");
      },
      async getMessage() {
        throw new Error("should not fetch messages before seeding cursor");
      }
    } as unknown as GmailApiClient;

    const summary = await new GmailSyncService(config, fakeClient, db).syncIncremental();

    expect(summary).toMatchObject({ syncMode: "history-seeded", foldersSeen: 1, messagesSeen: 0 });
    expect(listMessagesCalls).toBe(0);
    expect(db.prepare("SELECT cursor FROM mail_sync_cursors WHERE folder_id = 'gmail-folder-INBOX'").get()).toEqual({ cursor: "20" });
  });
});

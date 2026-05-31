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
      }
    } as unknown as GmailApiClient;

    const summary = await new GmailSyncService(config, fakeClient, db).syncAll();

    expect(summary).toMatchObject({ foldersSeen: 1, messagesSeen: 1, foldersChanged: 1, attachmentMetadataSeen: 1 });
    expect(db.prepare("SELECT message_count, unread_count FROM mail_folders").get()).toEqual({ message_count: 12, unread_count: 3 });
    expect(db.prepare("SELECT provider, subject, is_read FROM mail_messages").get()).toEqual({ provider: "gmail", subject: "Gmail hello", is_read: 0 });
    expect(db.prepare("SELECT indexed_text FROM mail_message_bodies").get()).toEqual({ indexed_text: "hello body" });
    expect(db.prepare("SELECT filename FROM mail_attachments").get()).toEqual({ filename: "file.pdf" });
  });
});

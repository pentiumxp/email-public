import { describe, expect, it } from "vitest";
import type { AliMailRuntimeConfig } from "../connectors/alimail/alimail-config";
import type { AliMailImapClient } from "../connectors/alimail/alimail-imap-client";
import { AliMailSyncService } from "../service/alimail-sync-service";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("AliMailSyncService", () => {
  it("syncs IMAP folders and messages using UID cursors", async () => {
    const db = openMailDatabase();
    runMigrations(db);
    const config = { accountId: "alimail-qifan-primary", accountLabel: "Qifan work mail", username: "user@example.local" } as AliMailRuntimeConfig;
    const fakeClient = {
      async listFolders() {
        return [{ path: "INBOX", name: "INBOX", listed: true, exists: 1, unseen: 1 }];
      },
      async fetchFolderMessages(_folderPath: string, sinceUid: number) {
        return {
          highestUid: Math.max(10, sinceUid),
          exists: 1,
          unseen: 1,
          messages: sinceUid > 0 ? [] : [{
            uid: 10,
            folderPath: "INBOX",
            subject: "AliMail hello",
            fromName: "Sender",
            fromAddress: "sender@example.local",
            date: new Date("2026-05-31T00:00:00.000Z"),
            flags: [],
            text: "hello body",
            hasAttachments: false,
            attachmentCount: 0
          }]
        };
      }
    } as unknown as AliMailImapClient;
    const service = new AliMailSyncService(config, fakeClient, db);
    expect(await service.syncAll()).toMatchObject({ foldersSeen: 1, messagesSeen: 1, foldersChanged: 1 });
    expect(await service.syncAll()).toMatchObject({ foldersSeen: 1, messagesSeen: 0, foldersChanged: 0 });
    expect(db.prepare("SELECT provider, subject FROM mail_messages").get()).toEqual({ provider: "alimail", subject: "AliMail hello" });
    expect(db.prepare("SELECT cursor, cursor_type FROM mail_sync_cursors").get()).toEqual({ cursor: "10", cursor_type: "imap-uid" });
  });
});

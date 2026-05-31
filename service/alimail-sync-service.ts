import type { AliMailImapClient } from "../connectors/alimail/alimail-imap-client";
import type { AliMailRuntimeConfig } from "../connectors/alimail/alimail-config";
import { AccountRepository, FolderRepository, MessageBodyRepository, MessageRepository, SyncCursorRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import { localAliMailFolderId, normalizeAliMailBody, normalizeAliMailFolder, normalizeAliMailMessage } from "./alimail-message-normalizer";

export interface AliMailSyncSummary {
  accountId: string;
  foldersSeen: number;
  messagesSeen: number;
  foldersChanged: number;
}

export class AliMailSyncService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly bodies: MessageBodyRepository;
  private readonly cursors: SyncCursorRepository;

  constructor(private readonly config: AliMailRuntimeConfig, private readonly client: AliMailImapClient, db: SqliteDatabase) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.bodies = new MessageBodyRepository(db);
    this.cursors = new SyncCursorRepository(db);
  }

  async syncAll(limitPerFolder = 500): Promise<AliMailSyncSummary> {
    this.accounts.upsert({
      id: this.config.accountId,
      provider: "alimail",
      displayAddress: this.config.username,
      accountLabel: this.config.accountLabel,
      status: "connected",
      lastSyncAt: new Date().toISOString()
    });
    const folders = await this.client.listFolders();
    const summary: AliMailSyncSummary = { accountId: this.config.accountId, foldersSeen: folders.length, messagesSeen: 0, foldersChanged: 0 };
    for (const folder of folders) {
      this.folders.upsert(normalizeAliMailFolder(this.config, folder));
      const folderId = localAliMailFolderId(folder.path);
      const cursor = this.cursors.get(this.config.accountId, folderId);
      const sinceUid = cursor?.cursor ? Number(cursor.cursor) : 0;
      const page = await this.client.fetchFolderMessages(folder.path, sinceUid, limitPerFolder);
      for (const message of page.messages) {
        this.messages.upsert(normalizeAliMailMessage(this.config, message));
        this.bodies.upsert(normalizeAliMailBody(message));
        summary.messagesSeen += 1;
      }
      if (page.messages.length > 0) summary.foldersChanged += 1;
      this.cursors.upsert({ accountId: this.config.accountId, folderId, cursor: String(page.highestUid || sinceUid), cursorType: "imap-uid" });
    }
    return summary;
  }
}

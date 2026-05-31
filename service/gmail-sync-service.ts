import type { GmailApiClient } from "../connectors/gmail/gmail-api-client";
import type { GmailRuntimeConfig } from "../connectors/gmail/gmail-config";
import { AccountRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository, SyncCursorRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import { localGmailFolderId, localGmailMessageId, normalizeGmailAttachments, normalizeGmailBody, normalizeGmailFolder, normalizeGmailMessage } from "./gmail-message-normalizer";

export interface GmailSyncSummary {
  accountId: string;
  foldersSeen: number;
  foldersChanged: number;
  messagesSeen: number;
  attachmentMetadataSeen: number;
}

export class GmailSyncService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly bodies: MessageBodyRepository;
  private readonly attachments: AttachmentRepository;
  private readonly cursors: SyncCursorRepository;

  constructor(private readonly config: GmailRuntimeConfig, private readonly client: GmailApiClient, db: SqliteDatabase) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.bodies = new MessageBodyRepository(db);
    this.attachments = new AttachmentRepository(db);
    this.cursors = new SyncCursorRepository(db);
  }

  async syncAll(limitPerLabel = 100): Promise<GmailSyncSummary> {
    const profile = await this.client.getProfile();
    this.accounts.upsert({
      id: this.config.accountId,
      provider: "gmail",
      displayAddress: profile.emailAddress,
      accountLabel: this.config.accountLabel,
      status: "connected",
      lastSyncAt: new Date().toISOString()
    });

    const labels = await this.client.listLabels();
    const visibleLabelSummaries = labels.filter((label) => !["CHAT", "CATEGORY_FORUMS", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"].includes(label.id));
    const visibleLabels = await Promise.all(visibleLabelSummaries.map((label) => this.client.getLabel(label.id)));
    for (const label of visibleLabels) {
      this.folders.upsert(normalizeGmailFolder(this.config, label));
    }

    const summary: GmailSyncSummary = {
      accountId: this.config.accountId,
      foldersSeen: visibleLabels.length,
      foldersChanged: 0,
      messagesSeen: 0,
      attachmentMetadataSeen: 0
    };

    for (const label of visibleLabels) {
      const folderId = localGmailFolderId(label.id);
      const cursor = this.cursors.get(this.config.accountId, folderId);
      let pageToken = cursor?.cursorType === "gmail-next-page" ? cursor.cursor : null;
      let seenForLabel = 0;
      let changed = false;
      do {
        const remaining = limitPerLabel - seenForLabel;
        if (remaining <= 0) {
          break;
        }
        const page = await this.client.listMessagesPage(label.id, pageToken, Math.min(50, remaining));
        for (const item of page.messages) {
          const message = await this.client.getMessage(item.id);
          this.messages.upsert(normalizeGmailMessage(this.config, message, label.id));
          this.bodies.upsert(normalizeGmailBody(message));
          const localAttachments = normalizeGmailAttachments(message);
          this.attachments.replaceForMessage(localGmailMessageId(message.id), localAttachments);
          summary.attachmentMetadataSeen += localAttachments.length;
          summary.messagesSeen += 1;
          seenForLabel += 1;
          changed = true;
        }
        pageToken = page.nextPageToken;
        this.cursors.upsert({ accountId: this.config.accountId, folderId, cursor: pageToken, cursorType: pageToken ? "gmail-next-page" : "gmail-page-complete" });
      } while (pageToken && seenForLabel < limitPerLabel);

      if (changed) {
        summary.foldersChanged += 1;
      }
    }

    return summary;
  }
}

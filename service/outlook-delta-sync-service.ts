import { OUTLOOK_ACCOUNT_ID } from "../connectors/outlook-graph/outlook-config";
import type { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { AccountRepository, AttachmentContentRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository, SyncCursorRepository, type MailAttachmentRecord } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import { localOutlookFolderId, localOutlookMessageId, normalizeOutlookAttachment, normalizeOutlookBody, normalizeOutlookFolder, normalizeOutlookMessage } from "./outlook-message-normalizer";

export interface OutlookDeltaSyncSummary {
  accountId: string;
  foldersSeen: number;
  foldersChanged: number;
  pagesSeen: number;
  messagesUpserted: number;
  messagesRemoved: number;
  attachmentMetadataSeen: number;
  attachmentContentCached: number;
  attachmentContentSkipped: number;
}

export interface OutlookDeltaProgress {
  folderName: string;
  pageMessages: number;
  totalMessagesUpserted: number;
  totalMessagesRemoved: number;
  cursorType: "graph-delta-link" | "graph-delta-nextlink";
}

export class OutlookDeltaSyncService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly bodies: MessageBodyRepository;
  private readonly attachments: AttachmentRepository;
  private readonly attachmentContent: AttachmentContentRepository;
  private readonly cursors: SyncCursorRepository;

  constructor(
    private readonly graph: MicrosoftGraphClient,
    db: SqliteDatabase,
    private readonly onProgress?: (progress: OutlookDeltaProgress) => void
  ) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.bodies = new MessageBodyRepository(db);
    this.attachments = new AttachmentRepository(db);
    this.attachmentContent = new AttachmentContentRepository(db);
    this.cursors = new SyncCursorRepository(db);
  }

  async syncOnce(): Promise<OutlookDeltaSyncSummary> {
    const me = await this.graph.getMe();
    this.accounts.upsert({
      id: OUTLOOK_ACCOUNT_ID,
      provider: "outlook",
      displayAddress: me.mail || me.userPrincipalName || "outlook-account",
      accountLabel: me.displayName || "Outlook / Hotmail",
      status: "connected",
      lastSyncAt: new Date().toISOString()
    });

    const remoteFolders = await this.graph.listFolders();
    for (const folder of remoteFolders) {
      this.folders.upsert(normalizeOutlookFolder(folder));
    }

    const summary: OutlookDeltaSyncSummary = {
      accountId: OUTLOOK_ACCOUNT_ID,
      foldersSeen: remoteFolders.length,
      foldersChanged: 0,
      pagesSeen: 0,
      messagesUpserted: 0,
      messagesRemoved: 0,
      attachmentMetadataSeen: 0,
      attachmentContentCached: 0,
      attachmentContentSkipped: 0
    };

    for (const folder of remoteFolders) {
      const folderId = localOutlookFolderId(folder.id);
      const existingCursor = this.cursors.get(OUTLOOK_ACCOUNT_ID, folderId);
      let cursor = existingCursor?.cursorType?.startsWith("graph-delta") ? existingCursor.cursor : null;
      let folderChanged = false;

      do {
        const page = await this.graph.listMessagesDeltaPage(folder.id, cursor);
        summary.pagesSeen += 1;
        for (const message of page.messages) {
          if (message["@removed"]) {
            if (this.messages.markDeletedByProviderMessageId(OUTLOOK_ACCOUNT_ID, message.id)) {
              summary.messagesRemoved += 1;
              folderChanged = true;
            }
            continue;
          }
          this.messages.upsert(normalizeOutlookMessage(message, folder.id));
          this.bodies.upsert(normalizeOutlookBody(message));
          if (message.hasAttachments) {
            const remoteAttachments = await this.graph.listAttachmentMetadata(message.id);
            const localAttachments = remoteAttachments.map((attachment) => normalizeOutlookAttachment(message.id, attachment));
            this.attachments.replaceForMessage(localOutlookMessageId(message.id), localAttachments);
            summary.attachmentMetadataSeen += localAttachments.length;
            await this.cacheAttachmentContents(message.id, localAttachments, summary);
          }
          summary.messagesUpserted += 1;
          folderChanged = true;
        }

        if (page.deltaLink) {
          cursor = page.deltaLink;
          this.cursors.upsert({ accountId: OUTLOOK_ACCOUNT_ID, folderId, cursor, cursorType: "graph-delta-link" });
        } else {
          cursor = page.nextLink;
          this.cursors.upsert({ accountId: OUTLOOK_ACCOUNT_ID, folderId, cursor, cursorType: "graph-delta-nextlink" });
        }

        this.onProgress?.({
          folderName: folder.displayName,
          pageMessages: page.messages.length,
          totalMessagesUpserted: summary.messagesUpserted,
          totalMessagesRemoved: summary.messagesRemoved,
          cursorType: page.deltaLink ? "graph-delta-link" : "graph-delta-nextlink"
        });
      } while (cursor && this.cursors.get(OUTLOOK_ACCOUNT_ID, folderId)?.cursorType === "graph-delta-nextlink");

      if (folderChanged) {
        summary.foldersChanged += 1;
      }
    }

    return summary;
  }

  private async cacheAttachmentContents(providerMessageId: string, attachments: MailAttachmentRecord[], summary: OutlookDeltaSyncSummary): Promise<void> {
    for (const attachment of attachments) {
      if (!attachment.providerAttachmentId) {
        summary.attachmentContentSkipped += 1;
        continue;
      }
      if (attachment.sizeBytes && attachment.sizeBytes > maxAttachmentCacheBytes()) {
        this.attachments.setAvailabilityState(attachment.id, "cache-too-large", attachment.sizeBytes);
        summary.attachmentContentSkipped += 1;
        continue;
      }
      try {
        const content = await this.graph.getAttachmentContent(providerMessageId, attachment.providerAttachmentId);
        if (!content) {
          summary.attachmentContentSkipped += 1;
          continue;
        }
        if (content.byteLength > maxAttachmentCacheBytes()) {
          this.attachments.setAvailabilityState(attachment.id, "cache-too-large", content.byteLength);
          summary.attachmentContentSkipped += 1;
          continue;
        }
        this.attachmentContent.upsert({
          attachmentId: attachment.id,
          messageId: attachment.messageId,
          contentType: attachment.contentType,
          sizeBytes: content.byteLength,
          content
        });
        this.attachments.setAvailabilityState(attachment.id, "cached-local", content.byteLength);
        summary.attachmentContentCached += 1;
      } catch {
        this.attachments.setAvailabilityState(attachment.id, "cache-error", attachment.sizeBytes);
        summary.attachmentContentSkipped += 1;
      }
    }
  }
}

function maxAttachmentCacheBytes(): number {
  return Math.max(Number(process.env.EMAIL_ATTACHMENT_CACHE_MAX_BYTES || 15 * 1024 * 1024), 1);
}

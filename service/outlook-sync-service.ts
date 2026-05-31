import { OUTLOOK_ACCOUNT_ID } from "../connectors/outlook-graph/outlook-config";
import type { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { AccountRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository, SyncCursorRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import { localOutlookFolderId, localOutlookMessageId, normalizeOutlookAttachment, normalizeOutlookBody, normalizeOutlookFolder, normalizeOutlookMessage } from "./outlook-message-normalizer";

export interface OutlookSyncSummary {
  accountId: string;
  foldersSeen: number;
  messagesSeen: number;
  messagesWithAttachments: number;
  attachmentMetadataSeen: number;
  foldersSkipped: number;
}

export interface OutlookSyncProgress {
  folderName: string;
  folderLocalId: string;
  pageMessages: number;
  totalMessagesSeen: number;
  nextPage: boolean;
}

export class OutlookSyncService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly bodies: MessageBodyRepository;
  private readonly attachments: AttachmentRepository;
  private readonly cursors: SyncCursorRepository;

  constructor(
    private readonly graph: MicrosoftGraphClient,
    db: SqliteDatabase,
    private readonly onProgress?: (progress: OutlookSyncProgress) => void
  ) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.bodies = new MessageBodyRepository(db);
    this.attachments = new AttachmentRepository(db);
    this.cursors = new SyncCursorRepository(db);
  }

  async syncAll(): Promise<OutlookSyncSummary> {
    const me = await this.graph.getMe();
    const displayAddress = me.mail || me.userPrincipalName || "outlook-account";
    this.accounts.upsert({
      id: OUTLOOK_ACCOUNT_ID,
      provider: "outlook",
      displayAddress,
      accountLabel: me.displayName || "Outlook / Hotmail",
      status: "connected",
      lastSyncAt: new Date().toISOString()
    });

    const remoteFolders = await this.graph.listFolders();
    for (const folder of remoteFolders) {
      this.folders.upsert(normalizeOutlookFolder(folder));
    }

    const summary: OutlookSyncSummary = {
      accountId: OUTLOOK_ACCOUNT_ID,
      foldersSeen: remoteFolders.length,
      messagesSeen: 0,
      messagesWithAttachments: 0,
      attachmentMetadataSeen: 0,
      foldersSkipped: 0
    };

    for (const folder of remoteFolders) {
      const folderId = localOutlookFolderId(folder.id);
      const existingCursor = this.cursors.get(OUTLOOK_ACCOUNT_ID, folderId);
      const localCount = this.messages.countByFolder(folderId);
      if (existingCursor?.cursor === null && localCount >= (folder.totalItemCount || 0)) {
        summary.foldersSkipped += 1;
        continue;
      }

      let nextLink: string | null = existingCursor?.cursor ?? null;
      do {
        const page = await this.graph.listMessagesPage(folder.id, nextLink);
        for (const message of page.messages) {
          this.messages.upsert(normalizeOutlookMessage(message, folder.id));
          this.bodies.upsert(normalizeOutlookBody(message));
          if (message.hasAttachments) {
            summary.messagesWithAttachments += 1;
            const remoteAttachments = await this.graph.listAttachmentMetadata(message.id);
            const localAttachments = remoteAttachments.map((attachment) => normalizeOutlookAttachment(message.id, attachment));
            this.attachments.replaceForMessage(localOutlookMessageId(message.id), localAttachments);
            summary.attachmentMetadataSeen += localAttachments.length;
          }
          summary.messagesSeen += 1;
        }
        nextLink = page.nextLink;
        this.cursors.upsert({
          accountId: OUTLOOK_ACCOUNT_ID,
          folderId,
          cursor: nextLink,
          cursorType: "graph-nextlink"
        });
        this.onProgress?.({
          folderName: folder.displayName,
          folderLocalId: folderId,
          pageMessages: page.messages.length,
          totalMessagesSeen: summary.messagesSeen,
          nextPage: Boolean(nextLink)
        });
      } while (nextLink);
    }

    return summary;
  }
}

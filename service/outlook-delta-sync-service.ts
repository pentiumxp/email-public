import { OUTLOOK_ACCOUNT_ID } from "../connectors/outlook-graph/outlook-config";
import type { MicrosoftGraphClient } from "../connectors/outlook-graph/microsoft-graph-client";
import { AccountRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository, SyncCursorRepository } from "../store/mail-repositories";
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
      attachmentMetadataSeen: 0
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
}

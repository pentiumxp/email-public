import { AccountRepository, AttachmentContentRepository, AttachmentRepository, FolderRepository, MessageRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import type { AuthContext } from "./authorization-service";
import { projectAccount, projectFolder, projectMessageDetail, projectMessageSummary } from "./privacy-projection-service";

export class MailboxReadService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly attachments: AttachmentRepository;
  private readonly attachmentContent: AttachmentContentRepository;

  constructor(db: SqliteDatabase) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.attachments = new AttachmentRepository(db);
    this.attachmentContent = new AttachmentContentRepository(db);
  }

  listAccounts(context: AuthContext) {
    return this.accounts.listByIds(context.allowedAccountIds).map(projectAccount);
  }

  listFolders(context: AuthContext, accountId: string) {
    if (!context.allowedAccountIds.includes(accountId)) {
      return [];
    }
    return this.folders.listByAccount(accountId).map(projectFolder);
  }

  listMessages(context: AuthContext, input: { folderId?: string; query?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);
    if (input.query?.trim()) {
      return this.messages.searchForAccounts(context.allowedAccountIds, input.query.trim(), limit, offset).map(projectMessageSummary);
    }
    if (input.folderId) {
      const folder = this.folders.get(input.folderId);
      if (!folder || !context.allowedAccountIds.includes(folder.accountId)) {
        return [];
      }
      return this.messages.listByFolder(input.folderId, limit, offset).map(projectMessageSummary);
    }
    return this.messages.listRecentForAccounts(context.allowedAccountIds, limit, offset).map(projectMessageSummary);
  }

  getMessage(context: AuthContext, messageId: string) {
    const summary = this.messages.get(messageId);
    if (!summary || !context.allowedAccountIds.includes(summary.accountId)) {
      return null;
    }
    const message = this.messages.getDetail(messageId);
    if (!message) {
      return null;
    }
    return projectMessageDetail(message, this.attachments.listByMessage(messageId));
  }

  getMessageBody(context: AuthContext, messageId: string) {
    const message = this.messages.getDetail(messageId);
    if (!message || !context.allowedAccountIds.includes(message.accountId)) {
      return null;
    }
    return {
      id: message.id,
      accountId: message.accountId,
      provider: message.provider,
      subject: message.subject,
      sender: message.senderDisplay || message.senderAddressBounded || "Unknown sender",
      receivedAt: message.receivedAt,
      contentSource: message.contentSource,
      bodyText: message.indexedText || message.sanitizedExcerpt || ""
    };
  }

  getAttachmentContent(context: AuthContext, attachmentId: string) {
    const attachment = this.attachments.getWithAccount(attachmentId);
    if (!attachment || !context.allowedAccountIds.includes(attachment.accountId)) {
      return null;
    }
    const blob = this.attachmentContent.get(attachmentId);
    if (!blob) {
      return {
        attachment,
        blob: null
      };
    }
    return { attachment, blob };
  }
}

import { AccountRepository, AttachmentRepository, FolderRepository, MessageRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import type { AuthContext } from "./authorization-service";
import { projectAccount, projectFolder, projectMessageDetail, projectMessageSummary } from "./privacy-projection-service";

export class MailboxReadService {
  private readonly accounts: AccountRepository;
  private readonly folders: FolderRepository;
  private readonly messages: MessageRepository;
  private readonly attachments: AttachmentRepository;

  constructor(db: SqliteDatabase) {
    this.accounts = new AccountRepository(db);
    this.folders = new FolderRepository(db);
    this.messages = new MessageRepository(db);
    this.attachments = new AttachmentRepository(db);
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

  listMessages(context: AuthContext, input: { folderId?: string; query?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    if (input.query?.trim()) {
      return this.messages.searchForAccounts(context.allowedAccountIds, input.query.trim(), limit).map(projectMessageSummary);
    }
    if (input.folderId) {
      const folder = this.folders.get(input.folderId);
      if (!folder || !context.allowedAccountIds.includes(folder.accountId)) {
        return [];
      }
      return this.messages.listByFolder(input.folderId, limit).map(projectMessageSummary);
    }
    return this.messages.listRecentForAccounts(context.allowedAccountIds, limit).map(projectMessageSummary);
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
}

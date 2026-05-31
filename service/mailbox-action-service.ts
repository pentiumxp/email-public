import { ActionAuditRepository, MessageRepository } from "../store/mail-repositories";
import type { SqliteDatabase } from "../store/sqlite-store";
import type { AuthContext } from "./authorization-service";

export class MailboxActionService {
  private readonly messages: MessageRepository;
  private readonly actions: ActionAuditRepository;

  constructor(db: SqliteDatabase) {
    this.messages = new MessageRepository(db);
    this.actions = new ActionAuditRepository(db);
  }

  setReadState(context: AuthContext, input: { accountId: string; messageId: string; isRead: boolean }) {
    if (!context.allowedAccountIds.includes(input.accountId)) {
      return { changed: false, actionId: null, remoteApplied: false, error: "account_forbidden" };
    }
    const message = this.messages.get(input.messageId);
    if (!message || message.accountId !== input.accountId) {
      return { changed: false, actionId: null, remoteApplied: false, error: "message_not_found" };
    }
    const changed = this.messages.setReadState(input.messageId, input.isRead);
    const actionId = this.actions.record({
      accountId: input.accountId,
      messageId: input.messageId,
      actionType: input.isRead ? "local_mark_read" : "local_mark_unread",
      status: changed ? "applied_local" : "not_found"
    });
    return { changed, actionId, remoteApplied: false };
  }

  deleteLocal(context: AuthContext, input: { accountId: string; messageId: string }) {
    if (!context.allowedAccountIds.includes(input.accountId)) {
      return { changed: false, actionId: null, remoteApplied: false, error: "account_forbidden" };
    }
    const message = this.messages.get(input.messageId);
    if (!message || message.accountId !== input.accountId) {
      return { changed: false, actionId: null, remoteApplied: false, error: "message_not_found" };
    }
    const changed = this.messages.markDeleted(input.messageId);
    const actionId = this.actions.record({
      accountId: input.accountId,
      messageId: input.messageId,
      actionType: "local_delete_tombstone",
      status: changed ? "applied_local" : "not_found"
    });
    return { changed, actionId, remoteApplied: false };
  }
}

import type { MessageRepository } from "../store/mail-repositories";
import { projectMessageSummary, type MessageSummary } from "./privacy-projection-service";

export class MessageQueryService {
  constructor(private readonly messages: MessageRepository) {}

  listRecent(limit = 50): MessageSummary[] {
    return this.messages.listRecent(limit).map(projectMessageSummary);
  }

  search(query: string, limit = 50): MessageSummary[] {
    const normalized = query.trim();
    if (!normalized) {
      return this.listRecent(limit);
    }
    return this.messages.search(normalized, limit).map(projectMessageSummary);
  }

  listByFolder(folderId: string, limit = 100): MessageSummary[] {
    return this.messages.listByFolder(folderId, limit).map(projectMessageSummary);
  }
}

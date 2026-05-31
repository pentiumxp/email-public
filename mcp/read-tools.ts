import type { MessageQueryService } from "../service/message-query-service";

export interface EmailListRecentMessagesInput {
  limit?: number;
}

export function createReadTools(deps: { messageQuery: MessageQueryService }) {
  return {
    email_list_recent_messages(input: EmailListRecentMessagesInput = {}) {
      return {
        messages: deps.messageQuery.listRecent(Math.min(input.limit ?? 25, 100))
      };
    },
    email_search_messages(input: { query: string; limit?: number }) {
      return {
        messages: deps.messageQuery.search(input.query, Math.min(input.limit ?? 25, 100))
      };
    }
  };
}


export interface GmailAuthStatus {
  connected: boolean;
  account?: string;
  expiresAt?: number;
  errorCode?: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface GmailMessageListPage {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken: string | null;
}

export interface GmailHistoryPage {
  history: GmailHistoryRecord[];
  historyId: string | null;
  nextPageToken: string | null;
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: GmailHistoryMessageRef[];
  messagesDeleted?: GmailHistoryMessageRef[];
  labelsAdded?: GmailHistoryLabelRef[];
  labelsRemoved?: GmailHistoryLabelRef[];
}

export interface GmailHistoryMessageRef {
  message: {
    id: string;
    threadId?: string;
  };
}

export interface GmailHistoryLabelRef extends GmailHistoryMessageRef {
  labelIds?: string[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GraphAuthStatus {
  connected: boolean;
  account?: string;
  expiresAt?: number;
  errorCode?: string;
}

export interface GraphFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId: string;
  subject: string;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  body?: {
    contentType?: string;
    content?: string;
  };
  "@removed"?: {
    reason?: string;
  };
}

export interface GraphAttachment {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
}

export interface GraphMessagePage {
  messages: GraphMessage[];
  nextLink: string | null;
}

export interface GraphMessageDeltaPage {
  messages: GraphMessage[];
  nextLink: string | null;
  deltaLink: string | null;
}

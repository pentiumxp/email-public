import { OUTLOOK_ACCOUNT_ID } from "../connectors/outlook-graph/outlook-config";
import type { GraphAttachment, GraphFolder, GraphMessage } from "../connectors/outlook-graph/types";

export function normalizeOutlookFolder(folder: GraphFolder) {
  return {
    id: localOutlookFolderId(folder.id),
    accountId: OUTLOOK_ACCOUNT_ID,
    providerFolderId: folder.id,
    displayName: folder.displayName,
    folderType: folder.displayName.toLowerCase() === "inbox" ? "inbox" : "custom",
    messageCount: folder.totalItemCount || 0,
    unreadCount: folder.unreadItemCount || 0
  };
}

export function normalizeOutlookMessage(message: GraphMessage, fallbackFolderId: string) {
  return {
    id: localOutlookMessageId(message.id),
    accountId: OUTLOOK_ACCOUNT_ID,
    folderId: localOutlookFolderId(message.parentFolderId || fallbackFolderId),
    provider: "outlook",
    providerMessageId: message.id,
    providerThreadId: message.conversationId || null,
    subject: message.subject || "(no subject)",
    senderDisplay: message.from?.emailAddress?.name || null,
    senderAddressBounded: boundAddress(message.from?.emailAddress?.address || ""),
    receivedAt: message.receivedDateTime || new Date(0).toISOString(),
    isRead: Boolean(message.isRead),
    hasAttachments: Boolean(message.hasAttachments),
    attachmentCount: message.hasAttachments ? 1 : 0,
    bodyState: message.body?.content ? "cached-text" : "metadata-only",
    isDeleted: false
  };
}

export function normalizeOutlookBody(message: GraphMessage) {
  const text = htmlToText(message.body?.content || "");
  return {
    messageId: localOutlookMessageId(message.id),
    sanitizedExcerpt: text.slice(0, 500),
    indexedText: text,
    contentSource: `graph-body-${message.body?.contentType || "unknown"}`
  };
}

export function normalizeOutlookAttachment(messageId: string, attachment: GraphAttachment) {
  return {
    id: `outlook-att-${attachment.id}`,
    messageId: localOutlookMessageId(messageId),
    filename: attachment.name || "attachment",
    contentType: attachment.contentType || null,
    sizeBytes: attachment.size || null,
    availabilityState: "metadata-only",
    providerAttachmentId: attachment.id
  };
}

export function localOutlookFolderId(providerFolderId: string): string {
  return `outlook-folder-${providerFolderId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function localOutlookMessageId(providerMessageId: string): string {
  return `outlook-msg-${providerMessageId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function htmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function boundAddress(address: string): string | null {
  if (!address) {
    return null;
  }
  const [local, domain] = address.split("@");
  if (!domain) {
    return address.slice(0, 64);
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

import type { AliMailFolder, AliMailMessage } from "../connectors/alimail/alimail-imap-client";
import type { AliMailRuntimeConfig } from "../connectors/alimail/alimail-config";

export function normalizeAliMailFolder(config: AliMailRuntimeConfig, folder: AliMailFolder) {
  return {
    id: localAliMailFolderId(folder.path),
    accountId: config.accountId,
    providerFolderId: folder.path,
    displayName: folder.name || folder.path,
    folderType: folder.path.toUpperCase() === "INBOX" ? "inbox" : "custom",
    messageCount: folder.exists || 0,
    unreadCount: folder.unseen || 0
  };
}

export function normalizeAliMailMessage(config: AliMailRuntimeConfig, message: AliMailMessage) {
  return {
    id: localAliMailMessageId(message.folderPath, message.uid),
    accountId: config.accountId,
    folderId: localAliMailFolderId(message.folderPath),
    provider: "alimail",
    providerMessageId: `${message.folderPath}:${message.uid}`,
    providerThreadId: null,
    subject: message.subject || "(no subject)",
    senderDisplay: message.fromName,
    senderAddressBounded: boundAddress(message.fromAddress || ""),
    receivedAt: (message.date || new Date(0)).toISOString(),
    isRead: message.flags.includes("\\Seen"),
    hasAttachments: message.hasAttachments,
    attachmentCount: message.attachmentCount,
    bodyState: message.text ? "cached-text" : "metadata-only",
    isDeleted: false
  };
}

export function normalizeAliMailBody(message: AliMailMessage) {
  const text = message.text || "";
  return {
    messageId: localAliMailMessageId(message.folderPath, message.uid),
    sanitizedExcerpt: text.slice(0, 500),
    indexedText: text,
    contentSource: "imap-source-text"
  };
}

export function normalizeAliMailAttachments(message: AliMailMessage) {
  return message.attachments.map((attachment) => ({
    id: localAliMailAttachmentId(message.folderPath, message.uid, attachment.index),
    messageId: localAliMailMessageId(message.folderPath, message.uid),
    filename: attachment.filename || "attachment",
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    availabilityState: "metadata-only",
    providerAttachmentId: String(attachment.index)
  }));
}

export function localAliMailFolderId(folderPath: string): string {
  return `alimail-folder-${folderPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function localAliMailMessageId(folderPath: string, uid: number): string {
  return `alimail-msg-${folderPath.replace(/[^a-zA-Z0-9_-]/g, "_")}-${uid}`;
}

function localAliMailAttachmentId(folderPath: string, uid: number, index: number): string {
  return `alimail-att-${folderPath.replace(/[^a-zA-Z0-9_-]/g, "_")}-${uid}-${index}`;
}

function boundAddress(address: string): string | null {
  if (!address) return null;
  const [local, domain] = address.split("@");
  if (!domain) return address.slice(0, 64);
  return `${local.slice(0, 2)}***@${domain}`;
}

import type { GmailRuntimeConfig } from "../connectors/gmail/gmail-config";
import type { GmailLabel, GmailMessage, GmailMessagePart } from "../connectors/gmail/types";

export function normalizeGmailFolder(config: GmailRuntimeConfig, label: GmailLabel) {
  return {
    id: localGmailFolderId(label.id),
    accountId: config.accountId,
    providerFolderId: label.id,
    displayName: label.name,
    folderType: label.id === "INBOX" ? "inbox" : "custom",
    messageCount: label.messagesTotal || 0,
    unreadCount: label.messagesUnread || 0
  };
}

export function normalizeGmailMessage(config: GmailRuntimeConfig, message: GmailMessage, fallbackLabelId: string) {
  const headers = headersByName(message.payload);
  const sender = parseAddress(headers.from || "");
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : parseDate(headers.date);
  const attachments = listAttachmentParts(message.payload);
  return {
    id: localGmailMessageId(message.id),
    accountId: config.accountId,
    folderId: localGmailFolderId(primaryFolderLabel(message.labelIds, fallbackLabelId)),
    provider: "gmail",
    providerMessageId: message.id,
    providerThreadId: message.threadId || null,
    subject: headers.subject || "(no subject)",
    senderDisplay: sender.name || null,
    senderAddressBounded: boundAddress(sender.address),
    receivedAt,
    isRead: !(message.labelIds || []).includes("UNREAD"),
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    bodyState: extractMessageText(message).text ? "cached-text" : "metadata-only",
    isDeleted: (message.labelIds || []).includes("TRASH")
  };
}

export function normalizeGmailBody(message: GmailMessage) {
  const extracted = extractMessageText(message);
  return {
    messageId: localGmailMessageId(message.id),
    sanitizedExcerpt: (extracted.text || message.snippet || "").slice(0, 500),
    indexedText: extracted.text || message.snippet || "",
    contentSource: `gmail-${extracted.source}`
  };
}

export function normalizeGmailAttachments(message: GmailMessage) {
  return listAttachmentParts(message.payload).map((part, index) => ({
    id: `gmail-att-${message.id}-${part.body?.attachmentId || index}`,
    messageId: localGmailMessageId(message.id),
    filename: part.filename || "attachment",
    contentType: part.mimeType || null,
    sizeBytes: part.body?.size || null,
    availabilityState: "metadata-only",
    providerAttachmentId: part.body?.attachmentId || null
  }));
}

export function localGmailFolderId(providerFolderId: string): string {
  return `gmail-folder-${providerFolderId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function localGmailMessageId(providerMessageId: string): string {
  return `gmail-msg-${providerMessageId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function primaryFolderLabel(labelIds: string[] | undefined, fallbackLabelId: string): string {
  if (!labelIds?.length) {
    return fallbackLabelId;
  }
  for (const label of ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM"]) {
    if (labelIds.includes(label)) {
      return label;
    }
  }
  return fallbackLabelId;
}

function headersByName(part?: GmailMessagePart): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of part?.headers || []) {
    result[header.name.toLowerCase()] = header.value;
  }
  return result;
}

function extractMessageText(message: GmailMessage): { text: string; source: string } {
  const plain = findBodyPart(message.payload, "text/plain");
  if (plain?.body?.data) {
    return { text: decodeBase64Url(plain.body.data), source: "text-plain" };
  }
  const html = findBodyPart(message.payload, "text/html");
  if (html?.body?.data) {
    return { text: htmlToText(decodeBase64Url(html.body.data)), source: "text-html" };
  }
  if (message.payload?.body?.data) {
    const text = decodeBase64Url(message.payload.body.data);
    return { text: message.payload.mimeType === "text/html" ? htmlToText(text) : text, source: message.payload.mimeType || "body" };
  }
  return { text: "", source: "snippet-only" };
}

function findBodyPart(part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart | null {
  if (!part) {
    return null;
  }
  if (part.mimeType === mimeType && part.body?.data) {
    return part;
  }
  for (const child of part.parts || []) {
    const found = findBodyPart(child, mimeType);
    if (found) {
      return found;
    }
  }
  return null;
}

function listAttachmentParts(part: GmailMessagePart | undefined): GmailMessagePart[] {
  if (!part) {
    return [];
  }
  const own = part.filename && part.body?.attachmentId ? [part] : [];
  return own.concat(...(part.parts || []).map(listAttachmentParts));
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8").replace(/\s+/g, " ").trim();
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

function parseDate(value: string | undefined): string {
  if (!value) {
    return new Date(0).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function parseAddress(value: string): { name: string; address: string } {
  const match = value.match(/^(.*?)<([^>]+)>$/);
  if (!match) {
    return { name: value.includes("@") ? "" : value.slice(0, 80), address: value.includes("@") ? value.trim() : "" };
  }
  return { name: match[1].trim().replace(/^"|"$/g, ""), address: match[2].trim() };
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

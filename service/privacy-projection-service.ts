import type { MailAccountRecord, MailAttachmentRecord, MailFolderRecord, MailMessageDetailRecord, MailMessageRecord } from "../store/mail-repositories";

export interface MessageSummary {
  id: string;
  accountId: string;
  folderId: string;
  provider: string;
  subject: string;
  sender: string;
  receivedAt: string;
  isRead: boolean;
  attachmentCount: number;
  bodyState: string;
}

export interface FolderSummary {
  id: string;
  accountId: string;
  providerFolderId: string;
  displayName: string;
  folderType: string;
  messageCount: number;
  unreadCount: number;
}

export interface MessageDetail extends MessageSummary {
  senderAddress: string | null;
  bodyText: string;
  bodyExcerpt: string;
  contentSource: string | null;
  attachments: AttachmentSummary[];
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  availabilityState: string;
}

export interface AccountSummary {
  id: string;
  provider: string;
  displayAddress: string;
  accountLabel: string;
  status: string;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
}

export function projectAccount(account: MailAccountRecord): AccountSummary {
  return {
    id: account.id,
    provider: account.provider,
    displayAddress: account.displayAddress,
    accountLabel: account.accountLabel,
    status: account.status,
    lastSyncAt: account.lastSyncAt ?? null,
    lastErrorCode: account.lastErrorCode ?? null
  };
}

export function projectMessageSummary(message: MailMessageRecord): MessageSummary {
  return {
    id: message.id,
    accountId: message.accountId,
    folderId: message.folderId,
    provider: message.provider,
    subject: clamp(message.subject, 160),
    sender: message.senderDisplay || message.senderAddressBounded || "Unknown sender",
    receivedAt: message.receivedAt,
    isRead: message.isRead,
    attachmentCount: message.attachmentCount,
    bodyState: message.bodyState ?? "metadata-only"
  };
}

export function projectFolder(folder: MailFolderRecord): FolderSummary {
  return {
    id: folder.id,
    accountId: folder.accountId,
    providerFolderId: folder.providerFolderId,
    displayName: folder.displayName,
    folderType: folder.folderType ?? "custom",
    messageCount: folder.messageCount ?? 0,
    unreadCount: folder.unreadCount ?? 0
  };
}

export function projectMessageDetail(message: MailMessageDetailRecord, attachments: MailAttachmentRecord[]): MessageDetail {
  const bodyText = clamp(message.indexedText || message.sanitizedExcerpt || "", 8000);
  return {
    ...projectMessageSummary(message),
    senderAddress: message.senderAddressBounded ?? null,
    bodyText,
    bodyExcerpt: clamp(message.sanitizedExcerpt || bodyText, 500),
    contentSource: message.contentSource,
    attachments: attachments.map(projectAttachment)
  };
}

function projectAttachment(attachment: MailAttachmentRecord): AttachmentSummary {
  return {
    id: attachment.id,
    filename: clamp(attachment.filename, 180),
    contentType: attachment.contentType ?? null,
    sizeBytes: attachment.sizeBytes ?? null,
    availabilityState: attachment.availabilityState ?? "metadata-only"
  };
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

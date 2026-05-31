import type { MailAccountRecord, MailFolderRecord, MailMessageRecord } from "../store/mail-repositories";

export const sampleAccounts: MailAccountRecord[] = [
  {
    id: "acct-outlook-demo",
    provider: "outlook",
    displayAddress: "outlook@example.local",
    accountLabel: "Outlook / Hotmail",
    status: "connected",
    lastSyncAt: "2026-05-31T03:30:00.000Z"
  },
  {
    id: "acct-qifan-demo",
    provider: "alimail",
    displayAddress: "user@7fgame.com",
    accountLabel: "Qifan work mail",
    status: "needs-auth",
    lastErrorCode: "AUTH_DIAGNOSTIC_REQUIRED"
  }
];

export const sampleFolders: MailFolderRecord[] = [
  { id: "folder-inbox", accountId: "acct-outlook-demo", providerFolderId: "inbox", displayName: "Inbox", folderType: "inbox", messageCount: 42, unreadCount: 8 },
  { id: "folder-focused", accountId: "acct-outlook-demo", providerFolderId: "focused", displayName: "Focused", folderType: "custom", messageCount: 18, unreadCount: 5 },
  { id: "folder-sent", accountId: "acct-outlook-demo", providerFolderId: "sentitems", displayName: "Sent", folderType: "sent", messageCount: 12, unreadCount: 0 },
  { id: "folder-qifan-inbox", accountId: "acct-qifan-demo", providerFolderId: "INBOX", displayName: "Qifan Inbox", folderType: "inbox", messageCount: 0, unreadCount: 0 }
];

export const sampleMessages: MailMessageRecord[] = [
  {
    id: "msg-001",
    accountId: "acct-outlook-demo",
    folderId: "folder-inbox",
    provider: "outlook",
    providerMessageId: "provider-demo-001",
    providerThreadId: "thread-demo-001",
    subject: "Graph connector refactor checkpoint",
    senderDisplay: "Mailbox Service",
    senderAddressBounded: "service@example.local",
    receivedAt: "2026-05-31T03:22:00.000Z",
    isRead: false,
    hasAttachments: false,
    attachmentCount: 0,
    bodyState: "excerpt"
  },
  {
    id: "msg-002",
    accountId: "acct-outlook-demo",
    folderId: "folder-inbox",
    provider: "outlook",
    providerMessageId: "provider-demo-002",
    providerThreadId: "thread-demo-002",
    subject: "SQLite migration harness ready for review",
    senderDisplay: "Local Store",
    senderAddressBounded: "store@example.local",
    receivedAt: "2026-05-31T02:48:00.000Z",
    isRead: true,
    hasAttachments: true,
    attachmentCount: 1,
    bodyState: "metadata-only"
  },
  {
    id: "msg-003",
    accountId: "acct-outlook-demo",
    folderId: "folder-focused",
    provider: "outlook",
    providerMessageId: "provider-demo-003",
    providerThreadId: "thread-demo-003",
    subject: "Hermes plugin manifest should stay metadata-only",
    senderDisplay: "Plugin Contract",
    senderAddressBounded: "plugin@example.local",
    receivedAt: "2026-05-30T16:10:00.000Z",
    isRead: false,
    hasAttachments: false,
    attachmentCount: 0,
    bodyState: "summary-only"
  }
];


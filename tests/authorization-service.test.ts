import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../service/authorization-service";
import { MailboxReadService } from "../service/mailbox-read-service";
import { AccountRepository, FolderRepository, MessageRepository } from "../store/mail-repositories";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("AuthorizationService", () => {
  it("filters mailbox reads to launch-session allowed accounts", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "A subject");
    seedAccount(db, "acct-b", "folder-b", "msg-b", "B subject");

    const authorization = new AuthorizationService(db);
    const launch = authorization.createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    const context = authorization.contextFromSessionToken(launch.token);
    expect(context?.allowedAccountIds).toEqual(["acct-a"]);

    const read = new MailboxReadService(db);
    expect(read.listAccounts(context!)).toHaveLength(1);
    expect(read.listFolders(context!, "acct-a")).toHaveLength(1);
    expect(read.listFolders(context!, "acct-b")).toHaveLength(0);
    expect(read.listMessages(context!, { query: "subject" }).map((message) => message.id)).toEqual(["msg-a"]);
    expect(read.getMessage(context!, "msg-a")?.subject).toBe("A subject");
    expect(read.getMessage(context!, "msg-b")).toBeNull();
  });

  it("keeps standalone bootstrap admin access explicit", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "A subject");
    seedAccount(db, "acct-b", "folder-b", "msg-b", "B subject");

    const context = new AuthorizationService(db).ensureBootstrapAdmin();
    expect(context).toMatchObject({ userId: "local-admin", mode: "bootstrap-admin" });
    expect(context.allowedAccountIds.sort()).toEqual(["acct-a", "acct-b"]);
  });

  it("paginates bounded mailbox reads by offset", () => {
    const db = openMailDatabase();
    runMigrations(db);
    const accounts = new AccountRepository(db);
    const folders = new FolderRepository(db);
    const messages = new MessageRepository(db);
    accounts.upsert({ id: "acct-a", provider: "gmail", displayAddress: "acct-a@example.local", accountLabel: "acct-a", status: "connected" });
    folders.upsert({ id: "folder-a", accountId: "acct-a", providerFolderId: "INBOX", displayName: "INBOX", folderType: "inbox", messageCount: 55, unreadCount: 0 });
    for (let index = 0; index < 55; index += 1) {
      messages.upsert({
        id: `msg-${index}`,
        accountId: "acct-a",
        folderId: "folder-a",
        provider: "gmail",
        providerMessageId: `provider-msg-${index}`,
        subject: `Subject ${index}`,
        receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        isRead: true,
        hasAttachments: false,
        attachmentCount: 0
      });
    }

    const context = new AuthorizationService(db).ensureBootstrapAdmin();
    expect(new MailboxReadService(db).listMessages(context, { folderId: "folder-a" })).toHaveLength(50);
    const next = new MailboxReadService(db).listMessages(context, { folderId: "folder-a", offset: 50 });
    expect(next).toHaveLength(5);
    expect(next[0].id).toBe("msg-4");
  });
});

function seedAccount(db: ReturnType<typeof openMailDatabase>, accountId: string, folderId: string, messageId: string, subject: string) {
  const accounts = new AccountRepository(db);
  const folders = new FolderRepository(db);
  const messages = new MessageRepository(db);
  accounts.upsert({ id: accountId, provider: "gmail", displayAddress: `${accountId}@example.local`, accountLabel: accountId, status: "connected" });
  folders.upsert({ id: folderId, accountId, providerFolderId: "INBOX", displayName: "INBOX", folderType: "inbox", messageCount: 1, unreadCount: 1 });
  messages.upsert({
    id: messageId,
    accountId,
    folderId,
    provider: "gmail",
    providerMessageId: `provider-${messageId}`,
    subject,
    receivedAt: "2026-05-31T00:00:00.000Z",
    isRead: false,
    hasAttachments: false,
    attachmentCount: 0
  });
}

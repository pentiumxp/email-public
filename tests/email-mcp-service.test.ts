import { describe, expect, it } from "vitest";
import { EmailMcpService } from "../service/email-mcp-service";
import { AuthorizationService } from "../service/authorization-service";
import { handleMcpJsonRpcLine } from "../mcp/stdio-protocol";
import { AccountRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository } from "../store/mail-repositories";
import { openMailDatabase, runMigrations } from "../store/sqlite-store";

describe("EmailMcpService", () => {
  it("lists MCP tools using Hermes-facing dotted names", () => {
    const db = openMailDatabase();
    runMigrations(db);
    const tools = new EmailMcpService(db).listTools().map((tool) => tool.name);

    expect(tools).toEqual(expect.arrayContaining([
      "email.list_accounts",
      "email.list_mailboxes",
      "email.search_messages",
      "email.get_message",
      "email.get_digest",
      "email.sync_account",
      "email.apply_mail_action"
    ]));
  });

  it("filters message reads by short-lived launch session", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    seedAccount(db, "acct-b", "folder-b", "msg-b", "Blocked subject");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });

    const service = new EmailMcpService(db);
    const listed = service.callTool("email.search_messages", { sessionToken: session.token, query: "subject" });
    expect(listed.ok).toBe(true);
    expect(listed.messages).toEqual([expect.objectContaining({ id: "msg-a" })]);

    const blocked = service.callTool("email.get_message", { sessionToken: session.token, messageId: "msg-b" });
    expect(blocked).toMatchObject({ ok: false, error: "email_message_not_found" });
  });

  it("fails closed when no MCP session token is supplied", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");

    const service = new EmailMcpService(db);
    expect(service.callTool("email.list_accounts")).toMatchObject({ ok: false, error: "email_mcp_session_denied" });
    expect(service.callTool("email.search_messages", { query: "subject" })).toMatchObject({ ok: false, error: "email_mcp_session_denied" });
  });

  it("returns bounded details without raw body text or attachment content", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    new MessageBodyRepository(db).upsert({
      messageId: "msg-a",
      sanitizedExcerpt: "Short safe excerpt",
      indexedText: "Long indexed body text that must not be returned as bodyText by MCP.",
      contentSource: "test"
    });
    new AttachmentRepository(db).replaceForMessage("msg-a", [{
      id: "att-a",
      messageId: "msg-a",
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 1234,
      availabilityState: "metadata-only"
    }]);

    const detail = new EmailMcpService(db).callTool("email.get_message", { sessionToken: session.token, messageId: "msg-a" });
    expect(detail.ok).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("bodyText");
    expect(detail.message).toEqual(expect.objectContaining({
      id: "msg-a",
      bodyExcerpt: "Short safe excerpt",
      fullBodyAvailable: true,
      attachments: [expect.objectContaining({ filename: "report.pdf", availabilityState: "metadata-only" })]
    }));
  });

  it("applies local delete tombstone through MCP with session authorization and audit", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    seedAccount(db, "acct-b", "folder-b", "msg-b", "Blocked subject");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });

    const service = new EmailMcpService(db);
    const deleted = service.callTool("email.apply_mail_action", { sessionToken: session.token, action: "delete_local", messageId: "msg-a" });
    expect(deleted).toMatchObject({ ok: true, action: "delete_local", changed: true, remoteApplied: false, localOnly: true });
    expect(db.prepare("SELECT is_deleted FROM mail_messages WHERE id = 'msg-a'").get()).toEqual({ is_deleted: 1 });
    expect(db.prepare("SELECT action_type, status FROM mail_actions WHERE message_id = 'msg-a'").get()).toEqual({
      action_type: "local_delete_tombstone",
      status: "applied_local"
    });
    expect(service.callTool("email.search_messages", { sessionToken: session.token, query: "Allowed" })).toMatchObject({ ok: true, messages: [] });

    expect(service.callTool("email.apply_mail_action", { sessionToken: session.token, action: "delete_local", messageId: "msg-b" })).toMatchObject({
      ok: false,
      error: "email_message_not_found"
    });
    expect(service.callTool("email.apply_mail_action", { action: "delete_local", messageId: "msg-b" })).toMatchObject({
      ok: false,
      error: "email_mcp_session_denied"
    });
  });

  it("rejects unsupported MCP mail actions", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });

    expect(new EmailMcpService(db).callTool("email.apply_mail_action", { sessionToken: session.token, action: "remote_delete", messageId: "msg-a" })).toMatchObject({
      ok: false,
      error: "email_mcp_action_not_supported"
    });
  });

  it("handles MCP initialize, tools/list, and tools/call over line JSON-RPC", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    const service = new EmailMcpService(db);

    const initialized = JSON.parse(handleMcpJsonRpcLine(service, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }))!);
    expect(initialized.result.serverInfo.name).toBe("email-mcp");

    const listed = JSON.parse(handleMcpJsonRpcLine(service, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))!);
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("email.search_messages");

    const called = JSON.parse(handleMcpJsonRpcLine(service, JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "email.get_digest", arguments: { sessionToken: session.token, limit: 10 } }
    }))!);
    const payload = JSON.parse(called.result.content[0].text);
    expect(payload.digest.messages).toHaveLength(1);
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
    senderDisplay: "Sender",
    senderAddressBounded: "sender@example.local",
    receivedAt: "2026-05-31T00:00:00.000Z",
    isRead: false,
    hasAttachments: false,
    attachmentCount: 0,
    bodyState: "metadata-only"
  });
}

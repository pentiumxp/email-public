import { describe, expect, it } from "vitest";
import { EmailMcpService } from "../service/email-mcp-service";
import { AuthorizationService } from "../service/authorization-service";
import { handleMcpJsonRpcLine } from "../mcp/stdio-protocol";
import { AccountRepository, AttachmentContentRepository, AttachmentRepository, FolderRepository, MessageBodyRepository, MessageRepository } from "../store/mail-repositories";
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
      "email.get_message_body",
      "email.get_digest",
      "email.get_attachment_content",
      "email.sync_account",
      "email.apply_mail_action",
      "email.delete_local_by_search",
      "email.apply_mail_action_bulk"
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

  it("returns cached sanitized body text only for high-privilege MCP sessions with audit", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    new MessageBodyRepository(db).upsert({
      messageId: "msg-a",
      sanitizedExcerpt: "Short safe excerpt",
      indexedText: "0123456789abcdefghijklmnopqrstuvwxyz",
      contentSource: "test"
    });
    const ownerSession = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "owner-1",
      role: "owner",
      allowedAccountIds: ["acct-a"]
    });
    const memberSession = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "member-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    const service = new EmailMcpService(db);

    expect(service.callTool("email.get_message_body", {
      sessionToken: memberSession.token,
      messageId: "msg-a",
      purpose: "investigate user-selected message"
    })).toMatchObject({ ok: false, error: "email_mcp_full_content_capability_required" });
    expect(service.callTool("email.get_message_body", {
      sessionToken: ownerSession.token,
      messageId: "msg-a"
    })).toMatchObject({ ok: false, error: "email_mcp_purpose_required" });

    const body = service.callTool("mcp_email_get_message_body", {
      sessionToken: ownerSession.token,
      messageId: "msg-a",
      purpose: "investigate user-selected message",
      offset: 10,
      limit: 12
    });

    expect(body).toMatchObject({
      ok: true,
      messageId: "msg-a",
      bodyText: "abcdefghijkl",
      offset: 10,
      limit: 12,
      returnedChars: 12,
      totalChars: 36,
      truncated: true,
      attachmentContentIncluded: false
    });
    expect(db.prepare("SELECT action_type, status FROM mail_actions WHERE message_id = 'msg-a'").get()).toEqual({
      action_type: "mcp_full_body_read",
      status: "read_local_sanitized_body"
    });
  });

  it("returns locally cached attachment content as bounded base64 chunks only for high-privilege sessions", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a", "Allowed subject");
    new AttachmentRepository(db).replaceForMessage("msg-a", [{
      id: "att-a",
      messageId: "msg-a",
      filename: "report.txt",
      contentType: "text/plain",
      sizeBytes: 26,
      availabilityState: "cached-local"
    }, {
      id: "att-metadata-only",
      messageId: "msg-a",
      filename: "remote.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      availabilityState: "metadata-only"
    }]);
    new AttachmentContentRepository(db).upsert({
      attachmentId: "att-a",
      messageId: "msg-a",
      contentType: "text/plain",
      sizeBytes: 26,
      content: Buffer.from("abcdefghijklmnopqrstuvwxyz")
    });
    const ownerSession = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "owner-1",
      role: "owner",
      allowedAccountIds: ["acct-a"]
    });
    const memberSession = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "member-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    const service = new EmailMcpService(db);

    expect(service.callTool("email.get_attachment_content", {
      sessionToken: memberSession.token,
      attachmentId: "att-a",
      purpose: "inspect user-selected attachment"
    })).toMatchObject({ ok: false, error: "email_mcp_full_content_capability_required" });

    const chunk = service.callTool("mcp_email_get_attachment_content", {
      sessionToken: ownerSession.token,
      attachmentId: "att-a",
      purpose: "inspect user-selected attachment",
      offset: 2,
      limit: 5
    });
    expect(chunk).toMatchObject({
      ok: true,
      attachmentId: "att-a",
      filename: "report.txt",
      encoding: "base64",
      data: Buffer.from("cdefg").toString("base64"),
      offset: 2,
      returnedBytes: 5,
      totalBytes: 26,
      truncated: true,
      localOnly: true
    });
    expect(db.prepare("SELECT action_type, status FROM mail_actions WHERE message_id = 'msg-a'").get()).toEqual({
      action_type: "mcp_attachment_read",
      status: "read_local_attachment_chunk"
    });

    expect(service.callTool("email.get_attachment_content", {
      sessionToken: ownerSession.token,
      attachmentId: "att-metadata-only",
      purpose: "inspect user-selected attachment"
    })).toMatchObject({
      ok: false,
      error: "email_attachment_content_unavailable",
      availabilityState: "metadata-only"
    });
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

  it("dry-runs local delete by search with exclude safeguards and bounded samples", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-cathay-sale", "Cathay Pacific special offer", {
      senderAddressBounded: "news@cathaypacific.com"
    });
    seedAccount(db, "acct-a", "folder-a", "msg-cathay-invoice", "Cathay Pacific invoice", {
      senderAddressBounded: "booking@cathaypacific.com"
    });
    seedAccount(db, "acct-b", "folder-b", "msg-blocked", "Cathay Pacific special offer", {
      senderAddressBounded: "news@cathaypacific.com"
    });
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });

    const result = new EmailMcpService(db).callTool("mcp_email_delete_local_by_search", {
      sessionToken: session.token,
      query: "Cathay OR \"Cathay Pacific\" OR 国泰航空",
      dry_run: true,
      limit: 500,
      exclude_keywords: ["invoice", "收据"]
    });

    expect(result).toMatchObject({
      ok: true,
      matched_count: 2,
      would_delete_count: 1,
      deleted_count: 0,
      skipped_count: 1,
      remoteApplied: false,
      action: "delete_local",
      dry_run: true
    });
    expect(result.sample_deleted).toEqual([expect.objectContaining({ messageId: "msg-cathay-sale", subject: "Cathay Pacific special offer" })]);
    expect(result.skipped_samples).toEqual([expect.objectContaining({ messageId: "msg-cathay-invoice", reason: "matched exclude keyword: invoice" })]);
    expect(result.sender_breakdown).toEqual({ "news@cathaypacific.com": 1 });
    expect(db.prepare("SELECT is_deleted FROM mail_messages WHERE id = 'msg-cathay-sale'").get()).toEqual({ is_deleted: 0 });
  });

  it("applies local delete by search only when dry_run is explicitly false", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-family-a", "Microsoft Family Safety activity report", {
      senderAddressBounded: "family-safety-noreply@microsoft.com"
    });
    seedAccount(db, "acct-a", "folder-a", "msg-family-b", "Family Safety screen time", {
      senderAddressBounded: "family-safety-noreply@microsoft.com"
    });
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });

    const deleted = new EmailMcpService(db).callTool("email.delete_local_by_search", {
      sessionToken: session.token,
      query: "\"Microsoft Family Safety\" OR \"Family Safety\" OR \"screen time\"",
      dry_run: false
    });

    expect(deleted).toMatchObject({ ok: true, matched_count: 2, would_delete_count: 2, deleted_count: 2, remoteApplied: false, dry_run: false });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE is_deleted = 1").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mail_actions WHERE action_type = 'local_delete_tombstone'").get()).toEqual({ count: 2 });
  });

  it("applies bulk local delete by message ids with dry-run default and account filtering", () => {
    const db = openMailDatabase();
    runMigrations(db);
    seedAccount(db, "acct-a", "folder-a", "msg-a1", "Allowed sale");
    seedAccount(db, "acct-a", "folder-a", "msg-a2", "Allowed newsletter");
    seedAccount(db, "acct-b", "folder-b", "msg-b1", "Blocked sale");
    const session = new AuthorizationService(db).createLaunchSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      allowedAccountIds: ["acct-a"]
    });
    const service = new EmailMcpService(db);

    const dryRun = service.callTool("email.apply_mail_action_bulk", {
      sessionToken: session.token,
      action: "delete_local",
      messageIds: ["msg-a1", "msg-b1", "missing"]
    });
    expect(dryRun).toMatchObject({ ok: true, matched_count: 3, would_delete_count: 1, deleted_count: 0, skipped_count: 2, dry_run: true });
    expect(dryRun.skipped_samples).toContainEqual(expect.objectContaining({ messageId: "msg-b1", subject: "", reason: "message outside allowed accounts" }));
    expect(db.prepare("SELECT is_deleted FROM mail_messages WHERE id = 'msg-a1'").get()).toEqual({ is_deleted: 0 });

    const deleted = service.callTool("mcp_email_apply_mail_action_bulk", {
      sessionToken: session.token,
      action: "delete_local",
      messageIds: ["msg-a1", "msg-a2"],
      dry_run: false
    });
    expect(deleted).toMatchObject({ ok: true, matched_count: 2, would_delete_count: 2, deleted_count: 2, skipped_count: 0, remoteApplied: false });
    expect(db.prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE account_id = 'acct-a' AND is_deleted = 1").get()).toEqual({ count: 2 });
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
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("email.delete_local_by_search");

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

function seedAccount(
  db: ReturnType<typeof openMailDatabase>,
  accountId: string,
  folderId: string,
  messageId: string,
  subject: string,
  options: { senderDisplay?: string; senderAddressBounded?: string; receivedAt?: string } = {}
) {
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
    senderDisplay: options.senderDisplay ?? "Sender",
    senderAddressBounded: options.senderAddressBounded ?? "sender@example.local",
    receivedAt: options.receivedAt ?? "2026-05-31T00:00:00.000Z",
    isRead: false,
    hasAttachments: false,
    attachmentCount: 0,
    bodyState: "metadata-only"
  });
}

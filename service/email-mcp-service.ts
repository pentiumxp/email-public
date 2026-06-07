import { AuthorizationService, type AuthContext } from "./authorization-service";
import { MailboxActionService } from "./mailbox-action-service";
import { MailboxReadService } from "./mailbox-read-service";
import type { AttachmentSummary, MessageDetail } from "./privacy-projection-service";
import type { SqliteDatabase } from "../store/sqlite-store";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface EmailMcpCallResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface ToolInput {
  sessionToken?: string;
  accountId?: string;
  folderId?: string;
  messageId?: string;
  query?: string;
  limit?: number;
  offset?: number;
  action?: string;
}

const TOOL_ALIASES: Record<string, string> = {
  "email.list_accounts": "email.list_accounts",
  email_list_accounts: "email.list_accounts",
  email_auth_status: "email.list_accounts",
  "email.list_mailboxes": "email.list_mailboxes",
  email_list_mailboxes: "email.list_mailboxes",
  email_list_folders: "email.list_mailboxes",
  "email.search_messages": "email.search_messages",
  email_search_messages: "email.search_messages",
  "email.get_message": "email.get_message",
  email_get_message: "email.get_message",
  email_get_message_summary: "email.get_message",
  "email.get_digest": "email.get_digest",
  email_get_digest: "email.get_digest",
  email_list_recent_messages: "email.get_digest",
  "email.list_attachments": "email.list_attachments",
  email_list_attachments: "email.list_attachments",
  "email.sync_account": "email.sync_account",
  email_sync_account: "email.sync_account",
  "email.apply_mail_action": "email.apply_mail_action",
  email_apply_mail_action: "email.apply_mail_action",
  "email.delete_message": "email.apply_mail_action",
  email_delete_message: "email.apply_mail_action"
};

export class EmailMcpService {
  private readonly authorization: AuthorizationService;
  private readonly actions: MailboxActionService;
  private readonly mailbox: MailboxReadService;

  constructor(db: SqliteDatabase) {
    this.authorization = new AuthorizationService(db);
    this.actions = new MailboxActionService(db);
    this.mailbox = new MailboxReadService(db);
  }

  listTools(): McpToolDefinition[] {
    return [
      {
        name: "email.list_accounts",
        description: "List mailbox accounts visible to the current Email plugin session.",
        inputSchema: { type: "object", properties: sessionProperties() }
      },
      {
        name: "email.list_mailboxes",
        description: "List folders/mailboxes for one account or all visible accounts.",
        inputSchema: {
          type: "object",
          properties: { ...sessionProperties(), accountId: { type: "string" } }
        }
      },
      {
        name: "email.search_messages",
        description: "Search bounded email message summaries by subject or bounded sender metadata.",
        inputSchema: {
          type: "object",
          properties: {
            ...sessionProperties(),
            query: { type: "string" },
            folderId: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 100 },
            offset: { type: "number", minimum: 0 }
          }
        }
      },
      {
        name: "email.get_message",
        description: "Get one bounded message detail projection. Raw MIME and full bodies are not returned.",
        inputSchema: {
          type: "object",
          properties: { ...sessionProperties(), messageId: { type: "string" } },
          required: ["messageId"]
        }
      },
      {
        name: "email.get_digest",
        description: "Return recent bounded message summaries and simple counts for visible mailbox data.",
        inputSchema: {
          type: "object",
          properties: {
            ...sessionProperties(),
            folderId: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 100 },
            offset: { type: "number", minimum: 0 }
          }
        }
      },
      {
        name: "email.list_attachments",
        description: "List attachment metadata for a message without returning attachment content.",
        inputSchema: {
          type: "object",
          properties: { ...sessionProperties(), messageId: { type: "string" } },
          required: ["messageId"]
        }
      },
      {
        name: "email.sync_account",
        description: "Read-only MCP sync diagnostic. Scheduler/provider sync remains outside MCP by default.",
        inputSchema: {
          type: "object",
          properties: { ...sessionProperties(), accountId: { type: "string" } }
        }
      },
      {
        name: "email.apply_mail_action",
        description: "Apply an audited local-only mail action. V1 supports delete_local tombstones only.",
        inputSchema: {
          type: "object",
          properties: {
            ...sessionProperties(),
            action: { type: "string", enum: ["delete_local"] },
            messageId: { type: "string" }
          },
          required: ["action", "messageId"]
        }
      }
    ];
  }

  callTool(name: string, input: ToolInput = {}): EmailMcpCallResult {
    const canonicalName = TOOL_ALIASES[name];
    if (!canonicalName) {
      return { ok: false, error: "unknown_email_mcp_tool", tool: name };
    }

    const context = this.resolveContext(input);
    if (!context) {
      return { ok: false, error: "email_mcp_session_denied" };
    }

    switch (canonicalName) {
      case "email.list_accounts":
        return this.listAccounts(context);
      case "email.list_mailboxes":
        return this.listMailboxes(context, input);
      case "email.search_messages":
        return this.searchMessages(context, input);
      case "email.get_message":
        return this.getMessage(context, input);
      case "email.get_digest":
        return this.getDigest(context, input);
      case "email.list_attachments":
        return this.listAttachments(context, input);
      case "email.sync_account":
        return this.syncAccount(context, input);
      case "email.apply_mail_action":
        return this.applyMailAction(context, input);
      default:
        return { ok: false, error: "unknown_email_mcp_tool", tool: name };
    }
  }

  private resolveContext(input: ToolInput): AuthContext | null {
    const explicitToken = input.sessionToken || process.env.EMAIL_MCP_SESSION_TOKEN;
    if (!explicitToken) {
      return null;
    }
    return this.authorization.contextFromSessionToken(explicitToken);
  }

  private listAccounts(context: AuthContext): EmailMcpCallResult {
    const accounts = this.mailbox.listAccounts(context);
    return { ok: true, accounts, count: accounts.length };
  }

  private listMailboxes(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    const accounts = this.mailbox.listAccounts(context).filter((account) => !input.accountId || account.id === input.accountId);
    if (input.accountId && accounts.length === 0) {
      return { ok: false, error: "email_account_not_allowed", accountId: input.accountId };
    }
    const mailboxes = accounts.flatMap((account) =>
      this.mailbox.listFolders(context, account.id).map((folder) => ({ ...folder, provider: account.provider, accountLabel: account.accountLabel }))
    );
    return { ok: true, mailboxes, count: mailboxes.length };
  }

  private searchMessages(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    const messages = this.mailbox.listMessages(context, {
      folderId: input.folderId,
      query: input.query,
      limit: boundedLimit(input.limit),
      offset: boundedOffset(input.offset)
    });
    return { ok: true, messages, count: messages.length, limit: boundedLimit(input.limit), offset: boundedOffset(input.offset) };
  }

  private getMessage(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    if (!input.messageId) {
      return { ok: false, error: "email_message_id_required" };
    }
    const message = this.mailbox.getMessage(context, input.messageId);
    if (!message) {
      return { ok: false, error: "email_message_not_found" };
    }
    return { ok: true, message: projectMcpMessageDetail(message) };
  }

  private getDigest(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    const messages = this.mailbox.listMessages(context, {
      folderId: input.folderId,
      limit: boundedLimit(input.limit),
      offset: boundedOffset(input.offset)
    });
    const unreadCount = messages.filter((message) => !message.isRead).length;
    return {
      ok: true,
      digest: {
        total: messages.length,
        unreadCount,
        limit: boundedLimit(input.limit),
        offset: boundedOffset(input.offset),
        messages
      }
    };
  }

  private listAttachments(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    if (!input.messageId) {
      return { ok: false, error: "email_message_id_required" };
    }
    const message = this.mailbox.getMessage(context, input.messageId);
    if (!message) {
      return { ok: false, error: "email_message_not_found" };
    }
    return { ok: true, messageId: input.messageId, attachments: projectMcpAttachments(message.attachments) };
  }

  private syncAccount(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    if (input.accountId && !context.allowedAccountIds.includes(input.accountId)) {
      return { ok: false, error: "email_account_not_allowed", accountId: input.accountId };
    }
    return {
      ok: true,
      status: "read_only_mcp",
      syncEnabled: false,
      reason: "MCP exposes a compatibility diagnostic; provider sync is handled by the Email scheduler/service."
    };
  }

  private applyMailAction(context: AuthContext, input: ToolInput): EmailMcpCallResult {
    if (input.action !== "delete_local") {
      return { ok: false, error: "email_mcp_action_not_supported", supportedActions: ["delete_local"] };
    }
    if (!input.messageId) {
      return { ok: false, error: "email_message_id_required" };
    }
    const message = this.mailbox.getMessage(context, input.messageId);
    if (!message) {
      return { ok: false, error: "email_message_not_found" };
    }
    const result = this.actions.deleteLocal(context, { accountId: message.accountId, messageId: input.messageId });
    if (result.error) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      action: "delete_local",
      messageId: input.messageId,
      changed: result.changed,
      actionId: result.actionId,
      remoteApplied: false,
      localOnly: true
    };
  }
}

function sessionProperties(): Record<string, unknown> {
  return {
    sessionToken: {
      type: "string",
      description: "Optional short-lived Email launch session token. Prefer EMAIL_MCP_SESSION_TOKEN for host wiring."
    }
  };
}

function boundedLimit(value: unknown): number {
  return Math.min(Math.max(Number(value ?? 50) || 50, 1), 100);
}

function boundedOffset(value: unknown): number {
  return Math.max(Number(value ?? 0) || 0, 0);
}

function projectMcpMessageDetail(message: MessageDetail) {
  const { bodyText: _bodyText, ...rest } = message;
  return {
    ...rest,
    bodyExcerpt: clamp(message.bodyExcerpt, 800),
    fullBodyAvailable: Boolean(_bodyText),
    attachments: projectMcpAttachments(message.attachments)
  };
}

function projectMcpAttachments(attachments: AttachmentSummary[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    availabilityState: attachment.availabilityState
  }));
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

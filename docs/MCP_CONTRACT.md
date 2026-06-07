# Email Plugin MCP Contract

## Contract Goal

Expose email data to Hermes Mobile through bounded tools. The MCP server should let Hermes search and analyze local mail without handling provider OAuth tokens or polling remote mailboxes.

Default MCP tools are read-only except the explicitly documented local-only delete tombstone action. Additional write tools require explicit enablement, audit, and confirmation.

## Authorization Context

MCP calls must be evaluated with a server-side authorization context from Hermes Mobile or the Email plugin session layer.

Required context fields before production multi-user use:

- plugin user id;
- workspace id;
- role;
- allowed account ids;
- optional delegated capability set.

Rules:

- Tools must reject or ignore `accountId` values outside the caller's allowed account set.
- `email_list_accounts` must return only accounts visible to the caller, except admin-only bounded health views.
- `email_get_message_summary` and attachment tools must verify message ownership through the account/folder relationship before returning data.
- Admin status tooling may expose account/provider health and counts, but not other users' full message bodies by default.
- Write tools, if enabled later, must require both account visibility and explicit write capability.
- Local-only delete tombstones must verify message ownership through the current session and write an audit row.

Current implementation status:

- HTTP UI/API account filtering is implemented through the Email plugin launch session layer.
- MCP read tools are implemented through `service/email-mcp-service.ts` and reuse the same launch-session authorization model.
- The stdio MCP entrypoint for Hermes should be `npm --silent run mcp:stdio` so npm does not write a banner into the MCP stdout stream.
- Hermes Mobile should pass the short-lived Email launch session through `EMAIL_MCP_SESSION_TOKEN` for the MCP process, or as the optional `sessionToken` tool input when host wiring requires per-call context.
- If no session token is supplied, MCP read tools fail closed with `email_mcp_session_denied`.

## Privacy-Bounded Output

MCP responses may include:

- local account id;
- provider;
- folder id/name;
- local message id;
- provider message id hash or bounded id;
- subject;
- sender display name or bounded address;
- received timestamp;
- read/unread state;
- attachment count and metadata;
- short body excerpt when explicitly requested and policy allows;
- local analysis status.

MCP responses must not include:

- OAuth tokens;
- mailbox passwords;
- raw full message bodies by default;
- full attachments;
- local filesystem paths;
- hidden provider headers unless explicitly needed and bounded;
- long raw logs.

## V1 Read Tools

The Hermes-facing tool names use dotted MCP names. Legacy underscore aliases are accepted for compatibility with older harnesses.

### `email.list_accounts`

Lists configured accounts visible to the current session.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`

Output:

- account id;
- provider;
- bounded display address;
- account label;
- connected/needs-auth/error/disabled;
- last sync time;
- bounded error code.

Aliases:

- `email_list_accounts`
- `email_auth_status`

### `email.list_mailboxes`

Lists visible folders/mailboxes.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- optional `accountId`

Output:

- account id;
- folder id;
- provider folder id;
- display name;
- folder type;
- message count;
- unread count.

Aliases:

- `email_list_mailboxes`
- `email_list_folders`

### `email.search_messages`

Searches bounded message summaries by subject or bounded sender metadata.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`;
- optional `folderId`;
- optional `query`;
- optional `limit`, clamped to 1..100;
- optional `offset`.

Output:

- message summaries only.

Aliases:

- `email_search_messages`

### `email.get_digest`

Returns a recent-message digest from visible local mail.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`;
- optional `folderId`;
- optional `limit`, clamped to 1..100;
- optional `offset`.

Output:

- total returned;
- unread count within returned messages;
- bounded recent message summaries.

Aliases:

- `email_get_digest`
- `email_list_recent_messages`

### `email.get_message`

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `messageId`

Output:

- metadata;
- bounded sanitized body excerpt;
- `fullBodyAvailable` boolean;
- attachment metadata.

The MCP detail projection does not return the `bodyText` field, raw MIME, attachment content, or local file paths.

Aliases:

- `email_get_message`
- `email_get_message_summary`

### `email.list_attachments`

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `messageId`

Output:

- attachment metadata only.

Aliases:

- `email_list_attachments`

### `email.sync_account`

Current V1 behavior is a read-only compatibility diagnostic.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- optional `accountId`

Output:

- `syncEnabled: false`
- bounded reason

Provider sync remains owned by the Email service scheduler and explicit local sync scripts. MCP write/sync side effects need a separate capability and audit design before enabling.

## V1 Local Write Tool

### `email.apply_mail_action`

Applies audited local-only actions. V1 supports only local tombstone deletion.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `action`: `delete_local`
- `messageId`

Output:

- `changed`
- `actionId`
- `remoteApplied: false`
- `localOnly: true`

Rules:

- does not call Gmail, Outlook, AliMail, IMAP, or SMTP;
- marks the local message as deleted/tombstoned so normal list/search/detail reads no longer return it;
- writes a local `mail_actions` audit row;
- rejects missing or invalid session context;
- rejects messages outside the caller's allowed accounts;
- rejects unsupported actions such as remote delete, archive, move, send, or reply.

Aliases:

- `email_apply_mail_action`
- `email.delete_message`
- `email_delete_message`

## Later Remote Write Tools

Remote write tools are not required for V1.

If enabled later:

- `email_mark_read`
- `email_archive_message`
- remote `email_delete_message`
- `email_move_message`
- `email_send_reply`

Rules:

- write action must be idempotent;
- destructive action must be explicit;
- remote provider call must succeed before local final state changes;
- local action audit must be written;
- tool response must return bounded status only.

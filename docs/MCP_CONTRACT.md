# Email Plugin MCP Contract

## Contract Goal

Expose email data to Hermes Mobile through bounded tools. The MCP server should let Hermes search and analyze local mail without handling provider OAuth tokens or polling remote mailboxes.

Default MCP tools are read-only except the explicitly documented local-only delete tombstone actions. Additional write tools require explicit enablement, audit, and confirmation.

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
- Bulk local delete tools must default to `dry_run=true`, cap the candidate set, return bounded samples/breakdowns only, and report `remoteApplied=false`.

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

### `email.get_message_body`

High-privilege read of locally cached sanitized/indexed message body text.
This is a separate tool from `email.get_message` so normal MCP detail calls stay
metadata/excerpt-only.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `messageId`
- `purpose`: short human-readable reason for this full-content read
- optional `offset`, default `0`
- optional `limit`, default `8000`, clamped to `1..20000`

Output:

- message metadata needed to identify the message;
- `bodyText`: cached sanitized/indexed local text slice only;
- `offset`, `limit`, `returnedChars`, `totalChars`;
- `truncated` and `fullBodyReturned`;
- `attachmentContentIncluded: false`;
- `auditId`.

Rules:

- requires a valid owner/admin launch session;
- member sessions fail with `email_mcp_full_content_capability_required`;
- missing or too-short `purpose` fails with `email_mcp_purpose_required`;
- verifies the current session's allowed account ids before reading;
- writes a local `mail_actions` audit row with `mcp_full_body_read`;
- does not return raw MIME, provider headers, attachment content, local file
  paths, provider tokens, provider passwords, or provider logs;
- callers must page with `offset`/`limit` when `truncated=true`.

Aliases:

- `email_get_message_body`
- `mcp_email_get_message_body`

### `email.list_attachments`

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `messageId`

Output:

- attachment metadata and local cache availability only.

### `email.get_attachment_content`

High-privilege read of locally cached attachment content. This tool never
contacts Gmail, Outlook, AliMail, IMAP, or SMTP providers; provider download is
owned by the sync services, which cache attachments in the local Email runtime.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `attachmentId`
- `purpose`: short human-readable reason for this attachment read
- optional `offset`, default `0`
- optional `limit`, default `65536`, clamped to `1..262144` bytes

Output:

- attachment id, message id, filename, content type;
- `encoding: base64`;
- `data`: bounded base64 chunk;
- `offset`, `limit`, `returnedBytes`, `totalBytes`;
- `truncated` and `fullAttachmentReturned`;
- `localOnly: true`;
- `auditId`.

Rules:

- requires a valid owner/admin launch session;
- member sessions fail with `email_mcp_full_content_capability_required`;
- missing or too-short `purpose` fails with `email_mcp_purpose_required`;
- verifies the current session's allowed account ids through the attachment's
  parent message before reading;
- if the attachment is not locally cached, fails with
  `email_attachment_content_unavailable` and returns the metadata
  `availabilityState`;
- writes a local `mail_actions` audit row with `mcp_attachment_read`;
- does not return local filesystem paths, provider tokens, provider passwords,
  raw MIME, provider headers, or uncapped binary payloads;
- callers must page with `offset`/`limit` when `truncated=true`.

Aliases:

- `email_list_attachments`
- `email_get_attachment_content`
- `mcp_email_get_attachment_content`

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

### `email.delete_local_by_search`

Searches visible local mail, applies include/exclude safeguards inside the Email plugin, and optionally applies local tombstone deletion. The tool is designed to avoid returning every message to the Agent for per-message judgment.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `query`: search text. Quoted phrases and `OR` separators are accepted.
- optional `folderId`
- optional `limit`, default `500`, clamped to `1..1000`
- optional `dry_run`, default `true`
- optional `include_sender`: sender/domain contains list
- optional `include_subject`: subject contains list
- optional `exclude_keywords`: subject/sender safety keywords that skip a matched message
- optional `older_than_days`
- optional `newer_than_days`

Output:

- `matched_count`: visible messages found by query and date/folder scope within the limit;
- `would_delete_count`: messages remaining after include/exclude filters;
- `deleted_count`: actual local tombstones written; always `0` during dry run;
- `skipped_count`;
- `remoteApplied: false`;
- `action: delete_local`;
- `dry_run`;
- `sample_deleted`: bounded metadata samples for messages that would be or were deleted;
- `skipped_samples`: bounded metadata samples with skip reasons;
- `sender_breakdown`: bounded sender counts for messages that would be or were deleted.

Rules:

- default behavior is dry run; deletion requires explicit `dry_run=false`;
- only local tombstones are supported;
- never calls Gmail, Outlook, AliMail, IMAP, SMTP, or any provider delete API;
- never returns raw bodies, raw MIME, attachments, local paths, provider tokens, or full provider payloads;
- verifies the current session's allowed account ids before searching.

Aliases:

- `email_delete_local_by_search`
- `mcp_email_delete_local_by_search`

### `email.apply_mail_action_bulk`

Applies a local-only action to a bounded list of message ids. V1 supports only `delete_local`.

Input:

- required `sessionToken`, unless the host supplies `EMAIL_MCP_SESSION_TOKEN`
- `action`: `delete_local`
- `messageIds`: array of local message ids, capped at `1000`
- optional `dry_run`, default `true`

Output:

- `matched_count`;
- `would_delete_count`;
- `deleted_count`;
- `skipped_count`;
- `remoteApplied: false`;
- `action: delete_local`;
- `dry_run`;
- bounded `sample_deleted`, `skipped_samples`, and `sender_breakdown`.

Rules:

- default behavior is dry run; deletion requires explicit `dry_run=false`;
- only messages inside the current session's allowed account ids are eligible;
- each real deletion writes the same `mail_actions` audit row as `email.apply_mail_action`;
- remote provider delete is not supported.

Aliases:

- `email_apply_mail_action_bulk`
- `mcp_email_apply_mail_action_bulk`

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

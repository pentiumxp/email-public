# Email Plugin MCP Contract

## Contract Goal

Expose email data to Hermes Mobile through bounded tools. The MCP server should let Hermes search and analyze local mail without handling provider OAuth tokens or polling remote mailboxes.

Default MCP tools are read-only. Write tools require explicit enablement, audit, and confirmation.

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

Current implementation status:

- HTTP UI/API account filtering is implemented through the Email plugin launch session layer.
- MCP read tools still need to be wired to the same authorization context before production multi-user use.

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

### `email_auth_status`

Returns provider/account connection status.

Input:

- optional `accountId`

Output:

- account id;
- provider;
- connected/needs-auth/error;
- last sync time;
- bounded error code/message.

### `email_list_accounts`

Lists configured accounts.

Output:

- account id;
- provider;
- display address;
- status;
- last sync time;
- unread count when available.

### `email_list_folders`

Input:

- `accountId`

Output:

- folder id;
- provider folder id;
- display name;
- message count;
- unread count.

### `email_search_messages`

Input:

- optional `accountId`;
- optional `folderId`;
- `query`;
- optional time range;
- `limit`.

Output:

- message summaries only.

### `email_list_recent_messages`

Input:

- optional `accountId`;
- optional `folderId`;
- optional `unreadOnly`;
- optional `since`;
- `limit`.

Output:

- message summaries only.

### `email_get_message_summary`

Input:

- `messageId`

Output:

- metadata;
- bounded sanitized body excerpt or generated local summary;
- attachment metadata;
- analysis marks.

### `email_list_attachments`

Input:

- `messageId`

Output:

- attachment id;
- filename;
- content type;
- size;
- availability state.

## Later Write Tools

Write tools are not required for V1.

If enabled later:

- `email_mark_read`
- `email_archive_message`
- `email_delete_message`
- `email_move_message`
- `email_send_reply`

Rules:

- write action must be idempotent;
- destructive action must be explicit;
- remote provider call must succeed before local final state changes;
- local action audit must be written;
- tool response must return bounded status only.

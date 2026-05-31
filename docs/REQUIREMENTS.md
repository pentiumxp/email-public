# Email Plugin Requirements

## Product Goal

Create an independent local Email / Mailbox application that replaces scattered scheduled mail-scraping automations with a durable local mail service.

The app should:

- connect to approved mailboxes such as Hotmail/Outlook, Gmail, work email, and later QQ Mail;
- sync new messages into a local database;
- expose a clean mailbox UI for browsing and basic management;
- expose bounded MCP tools so Hermes Mobile can analyze, summarize, classify, and report on mail without owning mailbox credentials;
- integrate into Hermes Mobile as an embedded plugin.

## User Problems

- Current automation jobs are not timely enough because they run as scheduled batches.
- Current reports are not direct or visual enough.
- Mail authentication and analysis logic risks making Hermes Mobile too large.
- Mail data needs a local, queryable, auditable store similar in spirit to Outlook's local cache.

## V1 Scope

V1 should be a local mail index and analysis plugin, not a full Outlook replacement.

Required:

- Account registration shell for providers.
- Outlook/Hotmail connector using Microsoft Graph.
- Gmail connector design and optional first implementation.
- Local SQLite store for account, folder, message, attachment metadata, sync cursor, and action state.
- Incremental sync worker.
- Message list, account list, folder list, search, and message detail UI.
- Read-only MCP query tools.
- Mark-read support if the provider connector can do it safely.
- Hermes Mobile plugin manifest and iframe-launch plan.
- Privacy-bounded Action Inbox notification plan for important mail.

Deferred:

- Sending mail.
- Replying to mail.
- Calendar/contact integration.
- Full attachment OCR/content extraction.
- Complex multi-user delegation.
- Full enterprise compliance archive.
- Public release.

## Provider Priority

1. Outlook / Hotmail through Microsoft Graph.
2. Gmail through Gmail API.
3. Qifan work mail through AliMail-compatible IMAP first.
4. Generic IMAP/SMTP for work mail and QQ Mail.
5. Provider-specific enhancements after V1.

## Functional Requirements

### Accounts

- Add account by provider.
- Show connection status, last sync time, and sync errors.
- Disable or disconnect account.
- Never display raw tokens or app passwords.

### Sync

- Pull recent messages incrementally.
- Store provider message ids and stable local ids.
- Track sync cursor per account and folder.
- Upsert messages idempotently.
- Preserve deletion/move state.
- Retry transient provider errors with bounded backoff.

### Local Store

- Store account metadata, folder metadata, message metadata, bounded body text or text index, attachment metadata, sync cursors, and action audit.
- Separate attachments from the main database if binary storage is needed.
- Avoid logging or handoff of full email bodies.

### UI

- Account overview.
- Folder/mailbox navigation.
- Message list with read/unread, sender, subject, timestamp, account, and attachment indicator.
- Message detail with safe bounded rendering.
- Search across local indexed metadata and optionally sanitized text.
- Clear sync status and error states.

### MCP

- Provide query tools for Hermes Mobile.
- Default MCP surface must be read-only.
- Any destructive or external write operation must require explicit capability and confirmation.

### Hermes Mobile Integration

- Hermes Mobile embeds the app through the existing plugin host pattern.
- Hermes Mobile uses MCP tools for analysis.
- Hermes Mobile may receive bounded Inbox/Web Push notifications for important mail, but not full message bodies.

## Non-Functional Requirements

- Local-first.
- Incremental and restart-safe.
- Provider failures must degrade per account, not stop the whole service.
- Secrets must stay in local secret storage or provider-specific token vault files excluded from Git.
- Tests must cover sync idempotency and privacy boundaries.

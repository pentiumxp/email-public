# Email Plugin Architecture

## Summary

The Email plugin is an independent local service with four boundaries:

1. provider connectors;
2. local mail store and sync services;
3. web UI;
4. MCP and Hermes Mobile plugin integration.

Hermes Mobile should not import provider SDKs, OAuth flows, mail sync workers, or mailbox storage. It should only embed the plugin UI and call MCP tools.

## Proposed Components

```text
Provider APIs
  | Outlook Graph / Gmail API / IMAP
  v
connectors/
  | normalized provider clients
  v
service/
  account-auth-service
  mail-sync-service
  message-query-service
  mailbox-action-service
  attachment-service
  notification-projection-service
  v
store/
  SQLite metadata
  attachment cache
  sync cursor state
  audit log
  v
interfaces/
  web UI
  MCP server
  Hermes plugin manifest/launch
```

## Service-First Rule

Entrypoints must stay thin:

- HTTP server registers routes and passes request context to services.
- MCP server validates tool parameters and delegates to services.
- Sync runner loads configuration and calls sync services.

Business rules belong in services:

- sync cursor logic;
- message deduplication;
- local/remote action reconciliation;
- provider retry policy;
- write confirmation and audit;
- privacy projection;
- MCP authorization and bounded read projection;
- Hermes notification projection.

## Connector Boundary

Provider connectors normalize remote APIs into a common interface:

- `getAccountProfile()`
- `listFolders()`
- `syncFolder({ folderId, cursor, limit })`
- `getMessage({ providerMessageId })`
- `markRead({ providerMessageId })`
- `archiveMessage({ providerMessageId })`
- `deleteMessage({ providerMessageId })`

Sending/replying is intentionally outside V1.

Provider outbound HTTP runtime:

- Shared provider fetch proxy setup lives in `connectors/http/provider-fetch-proxy.ts`.
- Provider clients that call Gmail, Microsoft Graph, or other HTTPS APIs should install this runtime inside connector-owned code.
- UI, MCP, HTTP routes, and Hermes plugin services should not import `ProxyAgent`, `setGlobalDispatcher`, provider token config, or provider proxy setup directly.
- Node `fetch` proxy behavior is treated as connector runtime infrastructure, not as a UI or host integration concern.

## Local Store Boundary

The store should expose repository-style APIs and hide SQL from business services:

- account repository;
- folder repository;
- message repository;
- sync cursor repository;
- attachment repository;
- action audit repository.

SQLite is the default choice because this is local-first, queryable, easy to backup, and consistent with similar Hermes local-service patterns.

## Suggested Data Model

Tables:

- `mail_accounts`
- `mail_folders`
- `mail_messages`
- `mail_message_bodies`
- `mail_attachments`
- `mail_sync_cursors`
- `mail_actions`
- `mail_analysis_marks`

Message records should include:

- local id;
- account id;
- provider;
- provider message id;
- provider thread/conversation id;
- folder id;
- subject;
- sender display/address hash or bounded address;
- recipients metadata;
- received timestamp;
- read/unread;
- flags;
- attachment count;
- body availability state;
- sync version;
- deletion/move tombstone.

## Hermes Mobile Integration Boundary

Hermes Mobile integration should be plugin-first:

- Email app exposes a manifest.
- Hermes Mobile launches it in iframe/same-window plugin host.
- Email app exposes MCP tools.
- Hermes Mobile uses Action Inbox only for bounded notifications.
- Email app follows `docs/HERMES_PLUGIN_HOST_CONTRACT.md` for manifest, launch, same-origin proxy, postMessage navigation/back, refresh-required events, and appearance sync.

Hermes Mobile must not:

- own email OAuth tokens;
- poll provider mailboxes directly;
- store full raw email bodies in its own state;
- sync attachments directly;
- duplicate mailbox UI logic.

## Multi-User Authorization Model

The Email plugin is not an owner-only personal mailbox tool. The owner may act as an administrator, but ordinary Hermes Mobile users must bind and access only their own mailbox accounts.

Core entities:

- plugin user: local Email-plugin user id mapped from Hermes Mobile launch identity;
- mailbox account: one OAuth/IMAP credential set owned by exactly one plugin user unless explicitly shared later;
- workspace membership: Hermes Mobile workspace/account context that is allowed to launch the plugin for that user;
- provider credential: token/app-password stored under the Email plugin secret store and referenced by account id only.

Required authorization rules:

- Every launch request from Hermes Mobile must include a verified user/workspace identity from the host, not a browser-supplied identity.
- Every mailbox account must have an owner user id.
- UI/API/MCP requests must run with an authorization context and filter by allowed account ids.
- Admin users may see operational status and bounded account metadata, but must not read another user's message bodies or attachments by default.
- Cross-user mailbox access requires an explicit future sharing/delegation model with audit records; do not infer it from Windows administrator access.
- Provider tokens, IMAP app passwords, refresh tokens, and sync cursors stay server-side and are never exposed to Hermes Mobile clients.
- Background sync may sync all configured accounts as a service process, but query/action surfaces must still enforce per-user access.
- Write operations, if enabled later, must validate both account ownership/delegation and write capability before creating an audit row.

Data model additions needed before production multi-user use:

- `plugin_users`;
- `user_mail_accounts` or owner fields on `mail_accounts`;
- `plugin_sessions` / launch sessions with expiry and workspace binding;
- authorization checks in HTTP route services and MCP tools;
- admin audit events for account binding, reconnect, disable, and delegated access changes.

Current implementation status:

- The current local runtime has a `local-admin` bootstrap context for standalone administration.
- Store tables now include `plugin_users`, `user_mail_accounts`, and `plugin_sessions`.
- Hermes launch sessions can carry allowed account ids and UI/API/MCP reads/actions filter through that server-side context.
- The stdio MCP server is `mcp/stdio-server.ts`; it opens the local SQLite database, runs migrations, and delegates tool calls to `service/email-mcp-service.ts`.
- Remaining hardening before production:
  - host-side launch authentication between Hermes Mobile and Email plugin;
  - UI for user account binding/reconnect/disable;
  - admin bounded health view separated from mailbox content;
  - Hermes-side MCP process/session wiring using the short-lived Email launch session.

## Outlook / Hotmail Realtime Sync Strategy

Outlook / Hotmail should use local polling over Microsoft Graph delta query:

- no Outlook message webhook dependency for V1;
- no public HTTPS notification endpoint required;
- poll interval defaults to a few minutes;
- every folder stores a Graph delta cursor in `mail_sync_cursors`;
- first delta pass establishes `graph-delta-link`;
- later polling uses the stored delta link to fetch only changes;
- deletions are represented as local tombstones through `is_deleted`;
- Hermes Mobile notification should be produced by the Email plugin's own bounded projection after local sync, not by directly trusting webhook payloads.

Webhook/change notifications may be added later only as a wake-up optimization. Even then, durable state should still come from delta sync.

## Runtime Stack Decision

Current foundation decision:

- Node/TypeScript for local service contracts, store layer, MCP glue, tests, and web UI.
- React/Vite for the local mailbox UI.
- SQLite through Node's `node:sqlite` API for the first local-store harness. This API is currently experimental in Node 24, so a later hardening pass may pin a stable SQLite package if needed.
- The copied Outlook Graph Python connector remains a reference/seed until it is refactored or ported into a normalized provider connector.
- Microsoft OAuth app registration can be shared with the existing Hermes-side connector by reusing the app `client_id`. Runtime tokens remain separate in the Email plugin's excluded `runtime/secrets/` store.
- Provider HTTPS clients use `undici` proxy runtime support when configured through Email-specific or standard proxy environment variables. This keeps NAS/Hermes local proxy reuse inside connector runtime code.

Pragmatic path:

1. keep the copied Outlook connector as Python reference/seed;
2. implement store/service/MCP contracts in TypeScript first;
3. port provider logic into `connectors/<provider>/` before production sync instead of calling Python for every sync;
4. keep HTTP, MCP, and UI entrypoints thin and delegate business behavior to services.

## UI Direction

The local UI follows Microsoft Outlook's information architecture and interaction density as a reference:

- account and folder navigation;
- message list;
- reading pane on desktop;
- search and sync controls;
- compact mobile list view.

The implementation must not copy Microsoft trademarks, proprietary icons, or protected assets. Use project-owned styling and open-source icons only.

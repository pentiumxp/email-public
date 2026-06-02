# Email Plugin Implementation Plan

## Phase 0: Project Foundation

- Initialize Git when ready.
- Add docs and context files.
- Decide runtime stack.
- Add lint/test command skeleton.
- Add architecture boundary test to prevent business logic in entrypoints.

Done in initial setup:

- `.agent-context/PROJECT_CONTEXT.md`
- `.agent-context/HANDOFF.md`
- `.gitignore`
- initial docs
- copied Outlook Graph connector seed

Done in first implementation slice:

- Node/TypeScript + React/Vite project foundation.
- SQLite schema and migration runner using `node:sqlite`.
- Account, folder, and message repositories with duplicate-safe message upsert.
- Privacy projection service for bounded message summaries.
- Read-only MCP glue helpers for recent/search message queries.
- Outlook-style local UI shell using synthetic metadata only.
- Store, privacy projection, and architecture boundary tests.
- Browser smoke check at desktop and mobile widths.
- Outlook/Hotmail Graph TypeScript client scaffold:
  - Email plugin-owned device-code token store under excluded `runtime/secrets/`;
  - `Mail.Read`-only auth/sync scripts;
  - provider sync service that stores folders, messages, body text, and attachment metadata in local SQLite;
  - resumable folder sync from stored Graph next links;
  - delta sync service and polling runner for few-minute local refresh without Outlook webhooks;
  - service harness with synthetic provider data.
- Local service/UI integration:
  - `npm run service` serves the built UI and read-only mailbox API;
  - API reads from `runtime/data/mail.sqlite`;
  - UI lists real local accounts, folders, messages, message detail, body text, and attachment metadata;
  - UI supports mobile folder drawer, mobile message detail, local read/unread state, and local delete tombstones;
  - Windows current-user autostart is installed through scheduled task `EmailPluginService`.
  - Background service now runs provider polling loops for Outlook delta sync and AliMail IMAP sync:
    - Outlook default interval: 180 seconds, override with `EMAIL_OUTLOOK_POLL_SECONDS`;
    - AliMail default interval: 300 seconds, override with `EMAIL_ALIMAIL_POLL_SECONDS`;
    - Gmail default interval after authorization: 300 seconds, override with `EMAIL_GMAIL_POLL_SECONDS`;
    - Gmail service polling uses Gmail `users.history.list` after a local history cursor exists, avoiding repeated full label-page scans during normal background polling;
    - Gmail incremental history page limit override: `EMAIL_GMAIL_HISTORY_PAGE_LIMIT` (default 20);
    - AliMail per-folder fetch limit override: `EMAIL_ALIMAIL_SYNC_LIMIT`;
    - Provider `fetch` calls can use the shared `connectors/http/provider-fetch-proxy.ts` runtime with `EMAIL_PROVIDER_PROXY_URL` / `HTTPS_PROXY` style environment variables.
- AliMail / Qifan IMAP connector scaffold:
  - `imapflow` IMAP client;
  - read-only auth diagnostic script;
  - IMAP folder/message sync service with UID cursor storage;
  - MIME parsing through `mailparser` for readable text bodies;
  - local config template under excluded `runtime/config/alimail.json`;
  - local credential template under excluded `runtime/secrets/alimail/credentials.json`;
  - SMTP remains disabled.

## Phase 1: Local Store

Implement:

- SQLite connection and migration runner. Initial version complete.
- Account table. Initial version complete.
- Folder table. Initial version complete.
- Message table. Initial version complete.
- Body table. Initial version complete.
- Attachment metadata table. Initial version complete.
- Sync cursor table. Initial version complete.
- Action audit table. Initial version complete.
- Plugin users table. Initial version complete.
- User/mail-account binding table. Initial version complete.
- Plugin launch sessions table. Initial version complete.

Tests:

- migration creates schema; initial coverage added.
- upsert account/folder/message is idempotent; initial coverage added.
- duplicate provider ids do not create duplicate local messages; initial coverage added.
- cursors update per account/folder;
- deletion tombstones persist.
- launch-session account filtering prevents cross-user reads; initial coverage added.

## Phase 2: Outlook / Hotmail Connector

Starting asset:

- `connectors/outlook-graph/outlook_graph_mcp.py`

Refactor target:

- separate Graph client from MCP tool declarations;
- keep auth status and device-code flow;
- add normalized folder/message mapping;
- add sync cursor support;
- add provider error normalization.

Tests:

- auth status with missing token;
- folder normalization; initial sync-service harness added.
- message metadata normalization; initial sync-service harness added.
- stored next-link resume; initial sync-service harness added.
- Graph delta link storage and tombstone handling; initial service harness added.
- provider error shape;
- no token in logs or returned objects.

## Phase 3: Sync Service

Implement:

- `mail-sync-service`;
- sync account;
- sync folder;
- schedule/poll loop;
- restart-safe cursor recovery;
- bounded backoff;
- per-account failure isolation.
- Outlook/Hotmail V1 realtime mode uses local polling over Graph delta query. It does not depend on Outlook message webhooks.

Tests:

- initial sync;
- incremental sync;
- duplicate message upsert;
- provider transient failure retry;
- permanent auth failure marks account disconnected/needs-auth;
- deletion/move state handling.
- polling runner emits bounded status/count logs only.

## Phase 4: MCP Server

Implement read-only tools first:

- `email_auth_status`
- `email_list_accounts`
- `email_list_folders`
- `email_search_messages`
- `email_list_recent_messages`
- `email_get_message_summary`
- `email_get_message_metadata`
- `email_list_attachments`

Write tools later and gated:

- `email_mark_read`
- `email_archive_message`
- `email_delete_message`

Tests:

- tool schema is stable;
- outputs are privacy-bounded;
- invalid account/folder/message ids fail closed;
- write tools require explicit enablement.

## Phase 5: Web UI

Implement:

- account overview; initial real-data version complete.
- add/connect account shell;
- folder list; initial real-data version complete.
- message list; initial real-data version complete.
- message detail; initial real-data version complete.
- search; initial local metadata search complete.
- local read/unread and local delete tombstone actions; initial version complete.
- sync status/error state.
- first-load account/folder/message loading placeholders so the UI does not show an empty gap while local cache requests are still in flight.
- first-level message page includes a three-slot account quick switcher, so the current Gmail / Qifan / Outlook accounts fit in one screen without opening the folder navigation drawer or horizontally scrolling.

UI posture:

- compact to standard density;
- no decorative dashboard style;
- status-forward and operational;
- mobile-first layout;
- no raw local paths or tokens.

Tests:

- account list renders status;
- message list handles empty/loading/error;
- message detail does not overflow mixed Chinese/English content;
- destructive actions are visually distinct and confirmed.
- first-level account quick switcher renders available accounts and switches the active account without opening the folder drawer; initial jsdom coverage and three-slot width guard added.

## Phase 6: Hermes Mobile Plugin Integration

Implement:

- plugin manifest endpoint; initial HTTP endpoint complete.
- launch token/session endpoint; initial HTTP endpoint complete.
- workspace registration endpoint; initial HTTP endpoint complete.
- host-verified user/workspace launch context; Email-side session model complete, host authentication still pending.
- per-user mailbox account binding; initial store model complete.
- account visibility filtering for UI/API complete; MCP filtering still pending.
- admin bounded health view separate from mailbox-content access;
- same-origin iframe/proxy contract;
- `postMessage` navigation/back contract:
  - emit `email.plugin.navigation`;
  - receive `hermes.plugin.back`;
  - emit `email.plugin.back_result`;
- host refresh contract:
  - emit `email.plugin.refresh_required` with bounded route/reason only;
  - avoid self-reload loops on visibility/focus;
- appearance inheritance:
  - accept launch `appearance`;
  - accept iframe query `pluginTheme` / `pluginFontSize`;
  - apply theme/font before first visible paint;
- MCP registration docs;
- bounded Action Inbox notification projection.

Tests:

- manifest includes safe metadata;
- launch does not expose secrets; initial endpoint returns only entry path, expiry, and visible account count.
- launch session cannot be forged from browser-supplied user/account ids; host-side authentication still pending.
- ordinary user cannot list or read another user's mailbox account; initial service coverage added.
- admin health view does not expose another user's full message body or attachment content;
- iframe route can return to Hermes Mobile host;
- postMessage navigation/back events are privacy-bounded; initial iframe implementation added, stricter origin allowlist still pending.
- refresh-required events do not include tokens, cookies, full message content, or long logs;
- theme/font inheritance works for light/dark and default/large; initial query-param support added.
- Inbox notification contains bounded metadata only.

## Phase 7: Gmail And IMAP

Gmail:

- Gmail API OAuth read-only scaffold complete:
  - config template: `runtime/config/gmail.json`;
  - token store: `runtime/secrets/gmail/token.json`;
  - client secret store when required by a Desktop OAuth client: `runtime/secrets/gmail/client-secret.json`;
  - auth scripts:
    - `npm run gmail:auth:start`;
    - `npm run gmail:auth:finish`;
    - `npm run gmail:auth:status`;
  - sync script:
    - `npm run sync:gmail`;
  - connector and sync service:
    - `connectors/gmail/gmail-api-client.ts`;
    - `service/gmail-sync-service.ts`;
    - `service/gmail-message-normalizer.ts`.
- Gmail V1 requests only `https://www.googleapis.com/auth/gmail.readonly`.
- Gmail OAuth supports device flow for TV / limited-input clients and browser localhost callback for Desktop clients that require a client secret.
- Gmail OAuth has been completed for the local account `xuxinxp@gmail.com`.
- Gmail sync maps labels to local folders and caches message text plus attachment metadata only. Attachment binary download, remote writes, send, reply, delete, archive, and mark-read are not enabled.
- First Gmail sync completed with 21 labels, 425 messages, and 5 attachment metadata rows.
- Gmail label counts are read from `users.labels.get`; `users.labels.list` alone does not include reliable `messagesTotal/messagesUnread` counts for the UI folder badges.
- Gmail background polling now uses `users.history.list` with the read-only scope after seeding a local history cursor. This keeps few-minute polling lightweight and avoids the older repeated scan of every visible label page.
- `sync:gmail` still performs an explicit bounded full label sync for manual catch-up/backfill. The long-running service uses the incremental history path.
- Gmail and Outlook provider clients now install the shared provider fetch proxy runtime during client construction. This is required in NAS deployments where Hermes/Codex use a local proxy wrapper because Node fetch does not automatically honor proxy environment variables.
- Focused provider proxy harness is available:
  - `npm run harness:provider-proxy`;
  - validates proxy precedence/redaction, unsupported protocol rejection, provider-client wiring, and boundary separation from UI/MCP/Hermes glue.

Qifan / AliMail IMAP:

- read `docs/PROVIDER_CONFIG_RULES.md` first;
- start with read-only auth diagnostics; initial scaffold complete.
- use `imap.qiye.aliyun.com:993` TLS as the first documented host/port candidate; initial config template created.
- do not assume historical Hermes credentials are valid; current working application password was supplied explicitly by the user and stored only in the excluded Email plugin secret store.
- do not enable SMTP or send/reply in V1.
- credentials must be supplied in the Email plugin excluded secret store or current shell env, not copied from Hermes runtime.

Generic IMAP:

- host/port/TLS config;
- app-password based auth for providers that require it;
- UIDVALIDITY/UID cursor handling;
- provider-specific folder mapping.

## Commit And Deployment Discipline

- Commit locally after each verified phase.
- Do not push unless explicitly requested.
- Use detailed Chinese commit messages.
- Never commit `data/`, `runtime/`, `logs/`, `.env`, token files, client secrets, or mailbox content.

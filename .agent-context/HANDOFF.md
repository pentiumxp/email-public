# Email Plugin Handoff

## Latest Update - 2026-06-10 Pagination Fix

- Investigated message-list pagination after reports that scrolling to the
  bottom and the manual `Load 50 more messages` button could stop appending
  messages.
- Reproduced against the live local Email service:
  - `GET /api/messages?...offset=0` returned 50 rows and `hasMore=true`;
  - `offset=50` returned 50 rows and appended to 100;
  - `offset=100` returned HTTP 200, but the UI stayed at 100 rows and kept
    showing `Loading 50 more messages`.
- Root cause:
  - `loadMessages()` incremented `messageRequestSeq` before checking the
    append-loading guard;
  - an extra scroll event fired while an append request was already in flight;
  - the guarded no-op call still advanced the request sequence and caused the
    real in-flight page response to be treated as stale.
- Fix:
  - move `messageRequestSeq` increment until after guard checks and after the
    request is known to be valid;
  - add a UI regression test that clicks the manual load button, fires a
    duplicate scroll event during the pending request, then verifies the second
    page still appends and loading clears.
- Verification:
  - `npm exec vitest run tests/ui-account-switcher.test.tsx` passed: 1 file / 5 tests;
  - `npm run check` passed: build plus 15 test files / 46 tests;
  - Playwright with the patched bundle against the real `127.0.0.1:5175` API
    loaded `offset=0`, `offset=50`, and `offset=100`, rendered 135 rows, and
    cleared the load-more status.
- Mac production deployment:
  - deployed with Home AI central deploy script from source commit
    `88d04e0c9f51` plus classified dirty files `web/src/ui/App.tsx` and
    `tests/ui-account-switcher.test.tsx`;
  - backup path:
    `/Users/hermes-host/HermesMobile/backups/deploy/20260610T021119Z-plugin-email-manual`;
  - `system/com.hermesmobile.plugin.email` restarted and reported running;
  - `http://127.0.0.1:5175/api/app-version` returned version `v-6e204df7`;
  - production Playwright smoke loaded bundle `index-Dgqqfsxo.js`, requested
    `offset=0`, `offset=50`, and `offset=100`, rendered 135 rows, cleared the
    load-more status, and reported no console errors or horizontal overflow.

## Latest Update - 2026-06-10

- Added MCP bulk local cleanup tools:
  - `email.delete_local_by_search`;
  - alias support: `email_delete_local_by_search`, `mcp_email_delete_local_by_search`;
  - `email.apply_mail_action_bulk`;
  - alias support: `email_apply_mail_action_bulk`, `mcp_email_apply_mail_action_bulk`.
- Behavior:
  - both tools default to `dry_run=true`;
  - only `delete_local` is supported;
  - deletion writes local tombstones and `mail_actions` audit rows only;
  - provider-side delete/archive/move/send/reply remains unsupported;
  - outputs include counts, bounded samples, skip reasons, and sender breakdowns only;
  - raw bodies, raw MIME, attachments, provider tokens, provider passwords, local paths, and provider logs are not returned.
- Search-based cleanup supports:
  - query terms with quoted phrases and `OR`;
  - optional `folderId`;
  - `limit` default 500 and max 1000;
  - `include_sender`, `include_subject`, `exclude_keywords`;
  - `older_than_days`, `newer_than_days`.
- Bulk message-id cleanup supports:
  - up to 1000 local message ids;
  - session account visibility filtering;
  - missing/already-deleted/out-of-scope messages reported as skipped samples.
- Added focused MCP tests covering:
  - new tool schema names;
  - dry-run search does not delete;
  - exclude keyword skip reasons;
  - explicit `dry_run=false` applies local tombstones and audit rows;
  - bulk message-id dry-run default and allowed-account filtering.
- Updated docs:
  - `docs/MCP_CONTRACT.md`;
  - `docs/SECURITY_PRIVACY.md`;
  - `docs/IMPLEMENTATION_PLAN.md`;
  - `docs/HARNESS_AND_DOCS_RULES.md`.
- AI Ops v2:
  - intake run classified the task as H1 for MCP/schema work;
  - required-check selection was run for changed files, but plugin absolute paths were classified conservatively as generic H3, so Email-local H1/MCP harness rules were followed.
- Verification:
  - `npm exec vitest run tests/email-mcp-service.test.ts tests/architecture-boundary.test.ts` passed: 2 files / 14 tests;
  - `npm run check` passed: build plus 15 test files / 46 tests;
  - `git diff --check` passed;
  - AI Ops evidence ledger updated at `$HOME/.homeai-qa/email-evidence-ledger.jsonl` with focused and aggregate test records.
- Mac production deployment:
  - Email plugin deployed with Home AI central deploy script from source commit `30637a19ef71` plus classified dirty files for this MCP bulk-delete change;
  - Email backup path: `/Users/hermes-host/HermesMobile/backups/deploy/20260610T015310Z-plugin-email-manual`;
  - Email source sync excluded `.agent-context/`, secrets, data, and `runtime/`;
  - `system/com.hermesmobile.plugin.email` restarted and reported running;
  - Email health URL `http://127.0.0.1:5175/api/app-version` returned version `v-38589920`;
  - direct production Email MCP `tools/list` includes `email.delete_local_by_search` and `email.apply_mail_action_bulk`;
  - direct production no-session call to `email.delete_local_by_search` fails closed with `email_mcp_session_denied`.
- Home AI / Gateway production closure for the new MCP callable names:
  - Home AI `scripts/email-mcp-wrapper.py`, `adapters/gateway-run-instruction-service.js`, and `mobile-server-runtime.js` were updated so Gateway exposes `mcp_email_delete_local_by_search` and `mcp_email_apply_mail_action_bulk`;
  - Home AI schema epoch updated to `20260610-email-bulk-local-delete-mcp-v1`;
  - central deploy script was also fixed to exclude plugin `runtime/` during plugin deploys;
  - Home AI source was deployed from staging path `/Users/hermes-dev/HermesMobileDev/.deploy-staging/homeai-email-bulk-mcp-deploy` to avoid unrelated dirty UI/Growth files in the app worktree;
  - Home AI backup path: `/Users/hermes-host/HermesMobile/backups/deploy/20260610T015712Z-home-ai-manual`;
  - `system/com.hermesmobile.listener` restarted and production status smoke passed with client version `20260609-dark-growth-surfaces-v679`;
  - Gateway worker wrapper at `/Users/hermes-host/HermesMobile/gateway-worker/email-mcp/scripts/email-mcp-wrapper.py` was synchronized from the deployed app wrapper and now reports 10 Email tools;
  - selected worker `hm-owner-openai-1` / `system/com.hermesmobile.gateway.hm-owner.openai.1` was restarted;
  - production native Gateway schema smoke for `hm-owner-openai-1` passed with required tools including `mcp_email_delete_local_by_search` and `mcp_email_apply_mail_action_bulk`.

## Current Status - 2026-05-31

- Workspace initialized manually because the referenced Agent initialization script was not present at `C:\Users\xuxin\Documents\Agent\scripts\powershell\initialize-workspace-context.ps1`.
- Workspace path: `C:\Users\xuxin\Documents\email`.
- Git/GitHub/CodeGraph status:
  - Git initialized on branch `main`.
  - GitHub private repository created and pushed:
    - `https://github.com/pentiumxp/email`
  - Initial commit:
    - `b240a2b` / `初始化 Email 邮箱插件工作区`.
  - CodeGraph initialized under `.codegraph/`.
  - CodeGraph status after initialization:
    - files indexed: 53;
    - nodes: 733;
    - edges: 1634.
  - `.codegraph/codegraph.db` is local-only and ignored by `.codegraph/.gitignore`.
- Initial project docs created:
  - `docs/DOCS_INDEX.md`
  - `docs/REQUIREMENTS.md`
  - `docs/ARCHITECTURE.md`
  - `docs/IMPLEMENTATION_PLAN.md`
  - `docs/MCP_CONTRACT.md`
  - `docs/SECURITY_PRIVACY.md`
  - `docs/PROVIDER_CONFIG_RULES.md`
  - `docs/HERMES_PLUGIN_HOST_CONTRACT.md`
  - `docs/HARNESS_AND_DOCS_RULES.md`
- Root `AGENTS.md` created with startup, architecture, documentation, Harness, Git/GitHub, and privacy rules.
- Initial reusable connector seed copied:
  - `connectors/outlook-graph/outlook_graph_mcp.py`
  - Source: Hermes Mobile `scripts/python/outlook_graph_mcp.py`
  - No token, `.env`, runtime state, mailbox data, attachment, or log was copied.
- `.gitignore` added to block secrets, local data, runtime state, logs, dependencies, and build outputs.
- First implementation slice added:
  - Node/TypeScript + React/Vite foundation.
  - SQLite schema/migration runner under `store/`.
  - Account/folder/message repositories with duplicate-safe message upsert.
  - Privacy-bounded message projection and query service under `service/`.
  - Read-only MCP glue helpers under `mcp/`.
  - Outlook-style local UI shell under `web/`, using synthetic metadata only.
  - Focused tests under `tests/`.
- Outlook/Hotmail Graph integration scaffold added:
  - TypeScript Graph client under `connectors/outlook-graph/`.
  - Email plugin-owned device-code auth scripts:
    - `npm run outlook:auth:start`
    - `npm run outlook:auth:finish`
    - `npm run outlook:auth:status`
  - Full-folder sync script:
    - `npm run sync:outlook`
  - Single-pass delta sync script:
    - `npm run sync:outlook:delta`
  - Polling runner:
    - `npm run poll:outlook`
    - default interval: 180 seconds;
    - override with `EMAIL_OUTLOOK_POLL_SECONDS`.
  - Local database default:
    - `runtime/data/mail.sqlite`
  - Token store default:
    - `runtime/secrets/outlook-graph/token.json`
  - Sync currently stores folder/message metadata, sanitized body text, and attachment metadata. Attachment binary download is not enabled.
  - Sync is resumable from stored Graph next links in `mail_sync_cursors`.
  - Delta polling uses Graph `messages/delta`, stores `graph-delta-link`, and marks removed messages as local tombstones.
  - Outlook message webhooks are intentionally not used for V1; Hermes Mobile notifications should be generated from local bounded projection after sync.
- Outlook polling status:
  - `npm run poll:outlook` started in a background process on 2026-05-31.
  - Poll interval is 180 seconds.
  - Logs:
    - `runtime/outlook-poll.out.log`
    - `runtime/outlook-poll.err.log`
  - First poll cycle completed:
    - foldersSeen: 12;
    - pagesSeen: 31;
    - messagesUpserted: 198;
    - messagesRemoved: 0;
    - attachmentMetadataSeen: 43.
  - All 12 folder cursors are now stored as `graph-delta-link`.
- Local Email service/UI integration:
  - `npm run service` starts one local service process that serves the built UI/API and runs Outlook delta polling.
  - The same service now also runs AliMail IMAP polling.
  - Service URL:
    - local: `http://127.0.0.1:5175/`;
    - LAN: `http://192.168.10.108:5175/` when the host keeps the same LAN IP.
  - Service host/port defaults:
    - `EMAIL_SERVICE_HOST=0.0.0.0`;
    - `EMAIL_SERVICE_PORT=5175`.
  - Service polling defaults:
    - Outlook: `EMAIL_OUTLOOK_POLL_SECONDS=180`;
    - AliMail: `EMAIL_ALIMAIL_POLL_SECONDS=300`;
    - Gmail: `EMAIL_GMAIL_POLL_SECONDS=300` after Gmail OAuth is configured and authorized;
    - AliMail per-folder fetch limit: `EMAIL_ALIMAIL_SYNC_LIMIT=500`.
  - Service logs:
    - `runtime/email-service.out.log`;
    - `runtime/email-service.err.log`.
  - UI now reads real local SQLite data from `runtime/data/mail.sqlite` through read-only APIs:
    - `/api/accounts`;
    - `/api/folders`;
    - `/api/messages`;
    - `/api/messages/:id`.
  - Local action APIs added:
    - `PATCH /api/messages/:id/read` for local read/unread state;
    - `DELETE /api/messages/:id` for local delete tombstone.
  - These actions write `mail_actions` audit rows and do not perform remote Outlook mailbox writes. Remote mark-read/delete/archive requires a separate `Mail.ReadWrite` authorization decision.
  - UI now supports:
    - desktop Outlook-style folder/message/detail panes;
    - mobile folder drawer;
    - mobile message detail view with back navigation;
    - right-swipe back gesture on mobile:
      - from message detail back to message list;
      - from folder drawer back to message list;
    - toolbar buttons for open, mark read, mark unread, archive placeholder, and local delete;
    - default folder ordering with `收件箱` first.
  - Browser smoke check passed on `http://127.0.0.1:5175/`:
    - default folder is `收件箱`;
    - 100 local messages render in the list;
    - message detail renders cached body text and metadata-only attachment state;
    - no horizontal overflow at desktop width.
  - Chrome direct verification on `http://192.168.10.108:5175/` passed:
    - desktop title: `收件箱`;
    - desktop rows: 100;
    - detail opened for first message;
    - mark read/unread toggled local UI state;
    - mobile folder drawer opened;
    - mobile message detail opened;
    - mobile right-swipe back gesture closed detail and folder drawer;
    - no console errors.
- Windows autostart:
  - Scheduled task name: `EmailPluginService`.
  - Trigger: current Windows user logon.
  - Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\xuxin\Documents\email\scripts\powershell\start-email-service.ps1 -WorkspacePath C:\Users\xuxin\Documents\email`.
  - Run level: limited/current user.
  - Startup helper avoids starting a duplicate `node.exe` service process when one is already running.
- AliMail / Qifan IMAP status:
  - `imapflow` dependency added.
  - `mailparser` dependency added for MIME body parsing.
  - Connector files:
    - `connectors/alimail/alimail-config.ts`;
    - `connectors/alimail/alimail-imap-client.ts`.
  - Service files:
    - `service/alimail-message-normalizer.ts`;
    - `service/alimail-sync-service.ts`.
  - Scripts:
    - `npm run alimail:auth:status`;
    - `npm run sync:alimail`.
  - Local config template created:
    - `runtime/config/alimail.json`.
  - Local credentials template created:
    - `runtime/secrets/alimail/credentials.json`.
  - Current diagnostic:
    - host: `imap.qiye.aliyun.com`;
    - port: 993;
    - TLS: true;
    - usernameConfigured: true;
    - connected: true;
    - mailboxCount: 5.
  - Low-level IMAP LOGIN check returned `OK LOGIN completed`.
  - User explicitly supplied the AliMail application password in the chat. It was written only to `runtime/secrets/alimail/credentials.json`; do not copy it to docs, handoff, tests, logs, or prompts.
  - Current sync result:
    - account: `alimail-qifan-primary`;
    - foldersSeen: 5;
    - messagesSeen: 124;
    - foldersChanged: 3;
    - local database: `runtime/data/mail.sqlite`.
  - Local folder summary after sync:
    - `INBOX`: remote 176, unread 158, local synced 110;
    - `垃圾邮件`: remote 15, unread 15, local synced 5;
    - `已发送`: remote 9, local synced 9;
    - `草稿`: 0;
    - `已删除邮件`: 0.
  - Chrome verification passed:
    - UI shows two accounts: Qifan work mail and Outlook;
    - Qifan account opens `INBOX`;
    - 100 local messages render;
    - first message detail body is readable parsed text, not base64/MIME source;
    - no horizontal overflow.
  - AliMail polling is integrated into `npm run service`; first service poll after restart completed with:
    - foldersSeen: 5;
    - messagesSeen: 0;
    - foldersChanged: 0.
  - SMTP/send/reply is not enabled.
  - No old Hermes password/app-password was copied; only the owner account address was located from Hermes config, and the current application password was supplied by the user for this workspace.
  - Microsoft app registration may be reused by supplying its `client_id`; old Hermes token, `.env`, and client-secret files were not read or copied.
- Outlook/Hotmail sync run completed for account `xuxinxp@hotmail.com`:
  - local database: `runtime/data/mail.sqlite`;
  - accounts: 1;
  - folders: 12;
  - messages: 11829;
  - message bodies cached as sanitized/indexed text: 11829;
  - attachment metadata rows: 2879;
  - local unread messages: 241;
  - attachment binary files were not downloaded.
  - Folder coverage from the final metadata check:
    - `收件箱`: remote 11028, local 11028;
    - `已发送邮件`: remote 703, local 703;
    - `草稿`: remote 23, local 23;
    - `存档`: remote 11, local 11;
    - `垃圾邮件`: remote 10, local 10;
    - `cHAT`: remote 32, local 32;
    - `已删除邮件`: remote folder count 24, Graph messages endpoint returned/local stored 22;
    - empty folders: `Conversation History`, `RSS 源`, `Scheduled`, `发件箱`, `同步问题`.
- Gmail read-only integration scaffold added:
  - Config template:
    - `runtime/config/gmail.json`.
  - Token store:
    - `runtime/secrets/gmail/token.json`.
  - Desktop OAuth client secret store:
    - `runtime/secrets/gmail/client-secret.json`.
  - Scripts:
    - `npm run gmail:auth:start`;
    - `npm run gmail:auth:finish`;
    - `npm run gmail:auth:status`;
    - `npm run sync:gmail`.
  - Connector files:
    - `connectors/gmail/gmail-config.ts`;
    - `connectors/gmail/gmail-api-client.ts`;
    - `connectors/gmail/types.ts`.
  - Service files:
    - `service/gmail-message-normalizer.ts`;
    - `service/gmail-sync-service.ts`.
  - Scope:
    - `https://www.googleapis.com/auth/gmail.readonly`.
  - Gmail polling is integrated into `npm run service`.
  - Current status:
    - Gmail OAuth completed for `xuxinxp@gmail.com`;
    - the user supplied a new Google OAuth `clientId`;
    - the user pointed to a Desktop file containing the required client secret; it was copied only into the Email plugin excluded secret store;
    - no legacy Hermes Google token was read or copied.
  - OAuth note:
    - Device flow works for TV / limited-input clients;
    - the current Desktop client uses browser localhost callback and requires a client secret for token exchange.
  - First Gmail sync completed:
    - foldersSeen: 21;
    - foldersChanged: 7;
    - messagesSeen: 425;
    - attachmentMetadataSeen: 5.
  - Gmail folder-count fix:
    - `users.labels.list` did not provide reliable message/unread counts, so Gmail sync now calls `users.labels.get` for visible labels before writing local folders;
    - refreshed Gmail folder API shows `INBOX` messageCount 726 and unreadCount 189;
    - UI folder badge shows unread count when nonzero, so Gmail `INBOX` displays 189 rather than total 726.
  - Chrome verification passed:
    - UI shows Gmail account `xuxinxp@gmail.com`;
    - Gmail `INBOX` renders 100 local messages;
    - no console errors.
  - Gmail remote writes, send/reply, archive, delete, mark-read, and attachment binary download are not enabled.
- Multi-user/Hermes Mobile authorization clarification:
  - The current local instance is an administrator bootstrap instance and is not yet a production multi-user authorization model.
  - Future Hermes Mobile integration must treat the owner/admin as one user among many, not as the global mailbox reader.
  - Required production model:
    - host-verified Hermes user/workspace launch context;
    - short-lived Email plugin session;
    - mailbox accounts bound to plugin user ids;
    - UI/API/MCP filtering by allowed account ids;
    - admin bounded health/status views separated from message-body and attachment access;
    - audit for account binding, reconnect, disable, delegation, and write actions.
  - Implemented in this slice:
    - schema tables: `plugin_users`, `user_mail_accounts`, `plugin_sessions`;
    - `AuthorizationService` with `local-admin` bootstrap context and Hermes launch sessions;
    - `GET /api/v1/hermes/plugin/manifest`;
    - `POST /api/v1/hermes/plugin/workspaces` with owner-key authorization;
    - `POST /api/v1/hermes/plugin/launch`;
    - owner key local path: `runtime/secrets/hermes/owner-key.txt`;
    - workspace config/key output under registered root `.hermes-email/`;
    - server-side account filtering for `/api/accounts`, `/api/folders`, `/api/messages`, message detail, and local read/delete APIs;
    - focused authorization tests showing a member launch session cannot read another account.
    - manifest/provisioning tests showing registration and launch do not return the raw workspace key.
    - iframe query appearance support for `pluginTheme` and `pluginFontSize`;
    - iframe `postMessage` navigation and `hermes.plugin.back` handling.
  - Bounded smoke for `weixin_test_1`:
    - registration returned `ok=true` and `status=active`;
    - `.hermes-email/config.json` exists;
    - `.hermes-email/access-key.txt` exists;
    - workspace-key launch returned a short-lived token with `expires_in=300`;
    - launch entry included theme/font query parameters;
    - registration/launch responses did not include the raw workspace key.
  - Chrome embed smoke:
    - `pluginTheme=dark` and `pluginFontSize=large` applied to root DOM attributes;
    - iframe emitted `email.plugin.navigation`;
    - no raw key/token/mail body was used in postMessage.
  - Still pending before production multi-user use:
    - user-facing account binding/reconnect/disable flows;
    - admin bounded health view that is separate from mailbox-content access;
    - MCP tools must be wired to the same authorization context.
  - Updated docs:
    - `docs/ARCHITECTURE.md`;
    - `docs/SECURITY_PRIVACY.md`;
    - `docs/HERMES_PLUGIN_HOST_CONTRACT.md`;
    - `docs/MCP_CONTRACT.md`;
    - `docs/IMPLEMENTATION_PLAN.md`.
- Verification:
  - `npm run build` passed.
  - `npm run test` passed with 10 test files and 16 tests.
  - Browser smoke check passed at desktop width 1365 and mobile width 390 with no horizontal overflow.

## Current Objective

Design an independent local Email / Mailbox plugin that:

- connects to approved Gmail, Outlook/Hotmail, and later QQ/IMAP mailboxes;
- syncs mail into a local store;
- provides a local web UI;
- exposes bounded MCP tools for Hermes Mobile analysis and automation;
- can be embedded in Hermes Mobile as a plugin without moving mailbox business logic into Hermes Mobile.

## Latest Update - 2026-06-02

- Optimized first-load behavior affected by heavy Gmail background polling.
- Gmail service polling now calls `GmailSyncService.syncIncremental()` instead of the older bounded `syncAll()` full label scan.
- Gmail incremental sync uses the Gmail read-only `users.history.list` API after a local `gmail-history-id` cursor is available.
- If no Gmail history cursor exists, the service seeds the cursor from `/users/me/profile` and returns quickly; manual `npm run sync:gmail` remains the explicit bounded full backfill path.
- Gmail history cursor is stored on the local Gmail INBOX folder cursor row to satisfy the existing folder foreign-key schema without a migration.
- UI message loading now has an explicit loading/error/empty state and request sequencing so stale responses do not overwrite the current folder/account view.
- Account/folder/message first-load paths now show foreground loading placeholders; the message pane displays `正在加载邮件...` while the local cache request is still in flight instead of presenting a blank list.
- New tests cover:
  - full Gmail sync writes the history cursor;
  - background incremental sync uses history without calling `listMessagesPage`;
  - missing history cursor seeding is fast and does not fetch message pages.
- Verification:
  - `npm run check` passed: build plus 10 test files / 18 tests.
  - Chrome delayed-message-API smoke passed: loading placeholder displayed before rows rendered, then 100 rows appeared with no console errors or horizontal overflow.

## NAS Deployment - 2026-06-02

- Deployed local version to NAS production:
  - code commit `c1fd6f5` / `优化邮箱首屏加载与 Gmail 增量同步`;
  - includes tracked `Dockerfile` and explicit dev dependency `@types/mailparser` so clean NAS installs can run TypeScript checks.
- NAS source sync completed:
  - target: `/volume1/docker/email-plugin/source`;
  - final backup: `/volume1/docker/email-plugin/backups/c1fd6f5-20260602-074459/source-before.tar.gz`;
  - earlier source backup from the first attempt: `/volume1/docker/email-plugin/backups/be50c44-20260602-073922/source-before.tar.gz`;
  - excluded runtime data, secrets, logs, local database, and `node_modules`.
- NAS validation:
  - `npm ci --include=dev` passed;
  - `npm run check` passed before container rebuild: build passed; 10 test files / 18 tests passed;
  - Docker image rebuild from `/volume1/docker/email-plugin/source` passed.
- Docker runtime activation completed:
  - old image tagged as `email-plugin:backup-before-c1fd6f5-20260602-074523`;
  - container replaced with ID prefix `0b38f5d59df9`;
  - image tag: `email-plugin:local`;
  - port mapping: `127.0.0.1:5175->5175/tcp`;
  - runtime volume preserved: `/volume1/docker/email-plugin/runtime:/data`.
- NAS runtime smoke passed:
  - `http://127.0.0.1:5175/` serves new assets `index-BnhkI33t.js` and `index-CVSZe0zP.css`;
  - `/api/accounts` returned 3 configured accounts;
  - `/api/messages?folderId=gmail-folder-INBOX&limit=5` returned 5 rows.
- Provider poll status after restart:
  - AliMail poll completed;
  - Outlook poll completed;
  - Gmail poll returned bounded error code `fetch failed`, matching the earlier NAS Google-network behavior seen before this deployment.
- Changed files:
  - `connectors/gmail/types.ts`
  - `connectors/gmail/gmail-api-client.ts`
  - `service/gmail-sync-service.ts`
  - `scripts/email-service.ts`
  - `web/src/ui/App.tsx`
  - `web/src/styles.css`
  - `tests/gmail-sync-service.test.ts`
  - `docs/IMPLEMENTATION_PLAN.md`
  - `.agent-context/HANDOFF.md`

## NAS Provider Proxy Deployment - 2026-06-02

- Investigated the NAS Google connection failure after Gmail polling returned bounded error code `fetch failed`.
- Current NAS proxy facts:
  - Hermes Agent runs with `HTTP_PROXY` / `HTTPS_PROXY` set to `http://127.0.0.1:7890`;
  - `sing-box` is running on the NAS and listens only on host loopback `127.0.0.1:7890`;
  - the previous Email Docker container used bridge networking and had no proxy environment, so it could not reach the host loopback proxy.
- Implemented shared provider fetch proxy runtime:
  - `connectors/http/provider-fetch-proxy.ts`;
  - uses `undici` `ProxyAgent` for HTTP/HTTPS proxy URLs;
  - resolves Email-specific env first, then generic `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` style variables;
  - redacts proxy credentials in status labels.
- Wired the proxy runtime into provider API clients:
  - `connectors/gmail/gmail-api-client.ts`;
  - `connectors/outlook-graph/microsoft-graph-client.ts`.
- Added focused tests:
  - `tests/provider-fetch-proxy.test.ts`.
- Updated docs:
  - `docs/PROVIDER_CONFIG_RULES.md`;
  - `docs/IMPLEMENTATION_PLAN.md`.
- Verification:
  - local `npm run check` passed: build plus 11 test files / 22 tests;
  - NAS `npm ci --include=dev` passed;
  - NAS `npm run check` passed: build plus 11 test files / 22 tests.
- NAS production container was rebuilt and replaced:
  - image tag: `email-plugin:local`;
  - new container ID prefix: `8ac1358f792c`;
  - Docker network mode: `host`;
  - service bind remains local-only with `EMAIL_SERVICE_HOST=127.0.0.1` and `EMAIL_SERVICE_PORT=5175`;
  - runtime volume preserved: `/volume1/docker/email-plugin/runtime:/data`;
  - previous image backup tag: `email-plugin:backup-before-proxy-20260602-075950`.
- NAS runtime smoke passed:
  - `http://127.0.0.1:5175/` returned HTTP 200;
  - `/api/accounts` returned 3 configured accounts;
  - `/api/messages?folderId=gmail-folder-INBOX&limit=5` returned 5 rows.
- Gmail network verification:
  - first service poll after proxy deployment completed with `syncMode=history-seeded`;
  - manual incremental Gmail sync completed with `syncMode=history`;
  - no Google `fetch failed` error appeared in the checked logs after the proxy deployment.
- Operational note:
  - because `sing-box` listens only on host loopback, do not move Email back to Docker bridge networking unless a container-reachable proxy endpoint is added.

## Provider Proxy Harness And Docs - 2026-06-02

- Added focused provider proxy harness command:
  - `npm run harness:provider-proxy`.
- Added provider proxy boundary tests:
  - `tests/provider-proxy-boundary.test.ts`;
  - verifies Gmail and Outlook provider clients wire through `connectors/http/provider-fetch-proxy.ts`;
  - verifies UI, MCP read tools, HTTP routes, and Hermes plugin service do not import proxy runtime directly.
- Extended provider proxy unit tests:
  - credential redaction is checked through `configureProviderFetchProxyFromEnv`;
  - unsupported proxy protocols remain rejected.
- Extended architecture boundary tests:
  - UI cannot import Gmail provider modules or provider proxy runtime;
  - Hermes plugin service cannot import provider credential config or provider proxy runtime.
- Updated docs:
  - `docs/HARNESS_AND_DOCS_RULES.md` now classifies provider outbound HTTP proxy/runtime wiring as H2 contract coverage and records the focused harness command;
  - `docs/ARCHITECTURE.md` now records provider outbound HTTP runtime ownership under connector modules;
  - `docs/SECURITY_PRIVACY.md` now records proxy credential redaction rules and disallows sending proxy configuration to browser, postMessage, MCP, or manifest/launch outputs;
  - `docs/IMPLEMENTATION_PLAN.md` now records the provider proxy harness.
- Verification:
  - `npm run harness:provider-proxy` passed: 3 test files / 10 tests;
  - `npm run check` passed: build plus 12 test files / 26 tests.

## UI Account Quick Switcher - 2026-06-02

- Added a first-level account quick switcher above the message list in the web UI:
  - users can switch Gmail, Qifan/AliMail, and Outlook/Hotmail accounts without opening the folder navigation drawer;
  - the folder drawer account list reuses the same `selectAccount` path to avoid state divergence;
  - switching accounts clears search/detail state and closes mobile drawers before loading the new account folders.
- Updated styling:
  - horizontal scroll account switcher with stable height;
  - long account labels and email addresses truncate inside the button;
  - dark mode uses black/white/gray contrast, not green accents.
- Added UI harness:
  - `tests/ui-account-switcher.test.tsx`;
  - Vitest now includes `tests/**/*.test.tsx`;
  - test verifies the first-level quick switcher renders account choices and clicking an account requests that account's folder list.
- Verification:
  - `npx vitest run tests/ui-account-switcher.test.tsx` passed: 1 test;
  - `npm run check` passed: build plus 13 test files / 27 tests;
  - Chrome smoke passed on `http://127.0.0.1:5175/`:
    - desktop 1365x820: quick switcher visible, account click switched the active account, no horizontal overflow, no console errors;
    - mobile 390x820: 3 quick account buttons visible, no horizontal overflow, no console errors.

## UI Account Quick Switcher Fit Refinement - 2026-06-02

- Adjusted the first-level account quick switcher so the current 3 accounts fit on one screen without horizontal scrolling:
  - quick account buttons use a three-slot basis `calc((100% - 16px) / 3)`;
  - mobile button layout uses a smaller avatar and font sizing while preserving truncation;
  - additional accounts beyond 3 may still overflow horizontally.
- Extended UI harness:
  - `tests/ui-account-switcher.test.tsx` now asserts the three-slot CSS guard;
  - `.codegraph/.gitignore` now ignores local `*.pid` runtime files.
- Verification:
  - `npx vitest run tests/ui-account-switcher.test.tsx` passed: 2 tests;
  - `npm run check` passed: build plus 13 test files / 28 tests;
  - Chrome smoke passed on `http://127.0.0.1:5175/`:
    - desktop 1365x820: 3 account buttons visible, switcher width 439, scrollWidth 439, no switcher scroll, no page overflow;
    - mobile 390x820: 3 account buttons visible at 118px each, switcher width 390, scrollWidth 390, no switcher scroll, no page overflow.

## UI Account Quick Switcher Label Refinement - 2026-06-02

- Refined the first-level quick switcher labels:
  - quick account buttons now display mailbox type labels only: `Gmail`, `起凡邮箱`, `Hotmail`;
  - full email addresses are no longer rendered inside the quick switcher text;
  - full addresses remain available in button `title` attributes and in the folder-pane account list.
- Removed the quick-switcher avatar letter so labels do not visually duplicate as `G Gmail` or `H Hotmail`.
- Verification:
  - `npx vitest run tests/ui-account-switcher.test.tsx` passed: 2 tests;
  - `npm run check` passed: build plus 13 test files / 28 tests;
  - Chrome smoke passed on `http://127.0.0.1:5175/`:
    - desktop 1365x820: quick switcher text is `Gmail起凡邮箱Hotmail`, no `@`, no switcher scroll, no page overflow;
    - mobile 390x820: quick switcher text is `Gmail起凡邮箱Hotmail`, no `@`, no switcher scroll, no page overflow.

## UI Version Refresh And Message Pagination - 2026-06-02

- Added app version refresh prompt:
  - new service module `service/app-version-service.ts` derives a bounded build version from static asset metadata or `EMAIL_PLUGIN_BUILD_VERSION`;
  - HTTP endpoint `GET /api/app-version` returns `{ version, checkedAt }` with no token, path, or mailbox data;
  - frontend records the initial version, checks every 60 seconds, and shows a refresh banner when the served version changes;
  - refresh banner and account quick switcher are wrapped in a stable toolbar stack so the message list remains the final `minmax(0, 1fr)` grid row.
- Added message-list paging:
  - `/api/messages` default `limit` is now 50;
  - API accepts `offset` and returns `hasMore` plus `nextOffset`;
  - store repository methods support `LIMIT ? OFFSET ?`;
  - frontend initial mailbox/search view loads 50 messages and scrolling to the bottom appends the next 50.
- Added/updated harness:
  - `tests/app-version-service.test.ts`;
  - `tests/store.test.ts` pagination coverage;
  - `tests/authorization-service.test.ts` bounded mailbox pagination coverage;
  - `tests/ui-account-switcher.test.tsx` now covers version-change refresh prompt and message request limit.
- Verification:
  - `npx vitest run tests/app-version-service.test.ts tests/store.test.ts tests/authorization-service.test.ts tests/ui-account-switcher.test.tsx` passed: 4 test files / 11 tests;
  - `npm run check` passed: build plus 14 test files / 33 tests;
  - temporary current-build Chrome smoke passed on `http://127.0.0.1:5186/`:
    - `/api/app-version` returned a bounded version string;
    - initial Gmail message request used `limit=50&offset=0` and rendered 50 rows;
    - scrolling message list to the bottom requested `limit=50&offset=50` and appended to 100 rows;
    - no console errors.

## Mobile Home-Screen Entry Harness - 2026-06-02

- Added a browser-installable app manifest for the local Email UI:
  - `web/public/manifest.webmanifest`;
  - `web/public/icons/email-icon.svg`;
  - `web/index.html` links the manifest, icon, and black/white theme metadata.
- Purpose:
  - ADB phone UI checks should use the Email home-screen icon / standalone entry
    where available, not a normal browser tab with address-bar and tab state.
- Harness docs updated:
  - `docs/HARNESS_AND_DOCS_RULES.md` now records the connected ADB e-ink phone
    pagination smoke flow and required bounded evidence.
- Privacy note:
  - the manifest and icon contain no account labels, tokens, paths, message data,
    or runtime state.
- Mobile pagination refinement:
  - the bottom pagination control now includes a visible `Load 50 more messages`
    button in addition to automatic scroll-trigger loading;
  - the scroll trigger starts earlier near the bottom so e-ink browser viewport
    behavior does not require hitting the exact final pixel;
  - this reuses the existing bounded `/api/messages?limit=50&offset=...` API and
    does not change provider sync, local storage, or mailbox credentials.

## NAS Deployment Script - 2026-06-03

- Added reusable NAS deployment script:
  - `scripts/powershell/deploy-email-nas.ps1`.
- Added `.dockerignore` so NAS-side `node_modules`, runtime data, `.git`, and
  local build outputs are not copied into Docker build context.
- Script defaults:
  - NAS host: `192.168.10.99`;
  - SSH port: `2222`;
  - SSH user: `xuxinxp`;
  - SSH key: `C:\Users\xuxin\.ssh\synology_codex_admin_192_168_10_99_20260507_ed25519`;
  - sudo password file path only: `C:\Users\xuxin\OneDrive\Desktop\nas.txt`;
  - remote root: `/volume1/docker/email-plugin`.
- Script behavior:
  - deploys committed `HEAD` only and warns if the working tree is dirty;
  - uploads a git archive over SSH using base64 + remote Python because NAS
    `scp` subsystem is unavailable;
  - backs up the previous source tree;
  - preserves `/volume1/docker/email-plugin/runtime`;
  - runs NAS-side validation inside `node:22-bookworm-slim` with
    `npm ci --include=dev` and `npm run check` because the NAS host Node/npm can
    be older than the project runtime requirements;
  - rebuilds `email-plugin:local`, replaces the `email-plugin` container, and
    performs bounded `/api/app-version`, manifest, account-count, and
    message-count smoke checks.
- Privacy note:
  - the script does not print sudo password, mailbox credentials, OAuth tokens,
    message bodies, attachments, or provider logs.

## NAS Production Deployment - 2026-06-03

- Deployed Email plugin to NAS production with reusable script:
  - command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\powershell\deploy-email-nas.ps1`;
  - deployed committed `HEAD`: `71b5d1f`;
  - NAS host: `192.168.10.99:2222`;
  - remote source: `/volume1/docker/email-plugin/source`;
  - runtime preserved: `/volume1/docker/email-plugin/runtime:/data`.
- Deployment fixes made before successful run:
  - NAS `scp` subsystem is unavailable, so script uploads a base64 git archive
    over SSH and decodes it with remote Python;
  - old `source/node_modules` may be root-owned, so source cleanup uses sudo and
    refuses to clear any path other than `/volume1/docker/email-plugin/source`;
  - NAS host Node/npm can be Node 20, so validation now runs inside
    `node:22-bookworm-slim`;
  - Dockerfile now builds `dist/web` inside the Node 22 image instead of relying
    on a prebuilt local `dist`.
- Validation:
  - local `npm run check` passed: 14 test files / 34 tests;
  - NAS Docker Node 22 validation passed: 14 test files / 34 tests;
  - Docker image rebuild completed and container `email-plugin` was replaced;
  - runtime smoke passed:
    - `/api/app-version` returned bounded version `v-73eba5e6`;
    - `/manifest.webmanifest` returned successfully;
    - `/api/accounts` bounded count: 3;
    - `/api/messages?folderId=gmail-folder-INBOX&limit=5` bounded count: 5.
- Backup:
  - previous source backup:
    `/volume1/docker/email-plugin/backups/71b5d1f-20260603-172900/source-before.tar.gz`.
- Current container check after deployment:
  - `email-plugin email-plugin:local Up`;
  - service version remained `v-73eba5e6`.

## MCP Interface For Hermes Mobile - 2026-06-04

- Added a real stdio MCP entrypoint for Hermes Mobile:
  - command: `npm --silent run mcp:stdio`;
  - entrypoint: `mcp/stdio-server.ts`;
  - protocol helper: `mcp/stdio-protocol.ts`.
- Added service-first MCP read layer:
  - `service/email-mcp-service.ts`;
  - delegates mailbox reads to `MailboxReadService`;
  - reuses `AuthorizationService` launch-session contexts;
  - filters all account/folder/message reads by `allowedAccountIds`.
- Added neutral runtime DB path helper:
  - `store/runtime-paths.ts`;
  - MCP reads `EMAIL_PLUGIN_DB` first, then `EMAIL_PLUGIN_RUNTIME_DIR`, then `runtime/data/mail.sqlite`.
- Hermes-facing MCP tools now use dotted names:
  - `email.list_accounts`;
  - `email.list_mailboxes`;
  - `email.search_messages`;
  - `email.get_message`;
  - `email.get_digest`;
  - `email.list_attachments`;
  - `email.sync_account`;
  - `email.apply_mail_action`.
- Legacy underscore aliases remain accepted for older harness compatibility:
  - `email_list_accounts`;
  - `email_auth_status`;
  - `email_list_folders`;
  - `email_search_messages`;
  - `email_list_recent_messages`;
  - `email_get_message_summary`;
  - `email_list_attachments`.
- Privacy behavior:
  - MCP detail returns bounded sanitized excerpt and attachment metadata only;
  - MCP detail does not return raw MIME, attachment content, local paths, provider tokens, provider passwords, or the full local body field;
  - `email.apply_mail_action` supports only `delete_local`, writes a local tombstone and audit row, and returns `remoteApplied=false`;
  - `email.sync_account` is a read-only compatibility diagnostic for V1. Provider sync remains owned by the Email scheduler/service and explicit local scripts.
- Authorization behavior:
  - Hermes should pass the short-lived Email launch session via `EMAIL_MCP_SESSION_TOKEN` for the spawned MCP process, or as optional `sessionToken` per tool call if the host requires per-call context;
  - without a session token, MCP read tools fail closed with `email_mcp_session_denied`.
- Manifest MCP metadata now includes:
  - `email.list_accounts` in required tools;
  - `command: npm --silent run mcp:stdio`.
- Added focused MCP harness:
  - `tests/email-mcp-service.test.ts`;
  - verifies dotted tool names, session account filtering, bounded detail output, attachment metadata-only output, and stdio JSON-RPC initialize/tools/list/tools/call.
- Updated docs:
  - `docs/MCP_CONTRACT.md`;
  - `docs/IMPLEMENTATION_PLAN.md`;
  - `docs/ARCHITECTURE.md`;
  - `docs/SECURITY_PRIVACY.md`;
  - `docs/HARNESS_AND_DOCS_RULES.md`.
- Verification:
  - `npm exec vitest run tests/email-mcp-service.test.ts tests/architecture-boundary.test.ts` passed: 2 test files / 8 tests.

## MCP Fail-Closed Session Update - 2026-06-04

- Updated MCP authorization so missing `EMAIL_MCP_SESSION_TOKEN` and missing per-call `sessionToken` no longer fall back to `local-admin`.
- No-token MCP tool calls now return bounded error `email_mcp_session_denied`.
- `local-admin` bootstrap remains available for HTTP/UI standalone administration paths where explicitly used, but not for MCP.
- Updated MCP docs and harness rules to require session context for MCP reads.
- Verification:
  - `npm exec vitest run tests/email-mcp-service.test.ts tests/architecture-boundary.test.ts` passed: 2 test files / 9 tests;
  - `npm run check` passed: 15 test files / 40 tests;
  - actual stdio no-token smoke returned `isError=true` with bounded error `email_mcp_session_denied`.

## MCP Local Delete Action - 2026-06-04

- Added MCP local delete capability through `email.apply_mail_action`.
- V1 supported action:
  - `delete_local`.
- Behavior:
  - requires `EMAIL_MCP_SESSION_TOKEN` or per-call `sessionToken`;
  - verifies the message is visible to the current launch-session allowed accounts;
  - marks the local message as deleted/tombstoned;
  - writes a `mail_actions` audit row with `local_delete_tombstone`;
  - returns bounded status with `remoteApplied=false` and `localOnly=true`;
  - does not call Outlook, Gmail, AliMail, IMAP, or SMTP remote delete APIs.
- Unsupported actions such as `remote_delete` fail with `email_mcp_action_not_supported`.
- Verification:
  - `npm exec vitest run tests/email-mcp-service.test.ts tests/mailbox-action-service.test.ts tests/architecture-boundary.test.ts` passed: 3 test files / 12 tests;
  - `npm run check` passed: 15 test files / 42 tests.

## Default Mailbox Ordering - 2026-06-05

- Updated the web UI account ordering so Qifan/AliMail is the default mailbox when present.
- The quick account switcher and folder-pane account stack share the same sorted account list.
- Other accounts keep their original relative order after Qifan/AliMail.
- Verification:
  - `npm exec vitest run tests/ui-account-switcher.test.tsx` passed: 1 test file / 5 tests.

## Not Yet Done

- Git repository has not been initialized in this workspace.
- Runtime foundation has been selected as Node/TypeScript + React/Vite. Node `node:sqlite` is used for the initial SQLite harness and is experimental in Node 24.
- Initial local database schema has been implemented, but cursor/deletion/action workflows still need broader service coverage.
- Existing Microsoft app `client_id` was reused from old Hermes-side config and stored in excluded `runtime/config/outlook-graph.json`. Token state is Email-plugin-owned under excluded `runtime/secrets/outlook-graph/token.json`.
- Gmail connector scaffold is implemented and Gmail OAuth/sync has completed for `xuxinxp@gmail.com`.
- Qifan/AliMail and Gmail provider rules have been documented.
- Outlook Graph connector still needs refactoring from direct MCP client into provider + sync-service shape.
- No Hermes Mobile plugin manifest or launch endpoint exists yet.
- Hermes Mobile plugin host cooperation rules are now documented, including manifest, launch, same-origin proxy, `postMessage` navigation/back, refresh-required events, and theme/font inheritance.

## Next Steps

1. Decide whether to request Outlook `Mail.ReadWrite` for remote mark-read/delete/archive, or keep these actions local-only.
2. Add local bounded notification projection for Hermes Mobile after delta sync.
3. Add UI loading/error states and folder/message pagination beyond the first 100 rows.
4. Investigate the `已删除邮件` folder count discrepancy: remote folder metadata says 24, Graph messages endpoint returned 22.
5. Add folder/message pagination beyond the first 100 rows so all AliMail remote messages can be browsed from UI.
6. Monitor Gmail `history.list` incremental polling on NAS after the provider proxy deployment.
7. Improve provider polling serialization or SQLite busy handling so manual sync does not conflict with the background service.
8. Add Hermes Mobile plugin manifest/launch integration; follow `docs/HERMES_PLUGIN_HOST_CONTRACT.md`.
9. Add user-facing account binding/reconnect/disable flows and admin bounded health view.
10. Wire MCP tools to the same authorization context.
11. Add stricter postMessage origin allowlist once Hermes Mobile provides the final host/proxy origins.

## Operational Constraints

- Do not store raw secrets or full email content in handoff/docs/logs.
- Write operations such as delete, archive, move, mark read, send, or reply must be explicit, audited, and idempotent.
- Sending or replying should not be part of V1 unless separately approved.
- Hermes Mobile integration should use MCP and embedded plugin UI. Hermes Mobile should not directly own mailbox credentials or sync logic.

## 2026-06-06 Home AI Platform Contract Pointer

- Added `docs/HOME_AI_PLATFORM_CONTRACT.md`.
- Contract version: `20260606-v1`.
- Scope: Email is treated as a standard inserted Home AI plugin for the
  cross-workspace platform contract rollout.
- This was a documentation-only update. No Email code, local service, Mac
  production files, Gateway workers, mailbox data, OAuth tokens, cookies, or
  credentials were changed.
- Next steps:
  - implement Reference Contract V1 methods for Email messages, threads,
    attachments, and accounts;
  - document the exact Mac production deploy command once stabilized;
  - add Appium/iOS Simulator evidence for embedded UI and account switching.

## 2026-06-06 Home AI Platform Contract Checker Closure

- Home AI main workspace added and ran:
  `node scripts\plugin-workspace-platform-contract-check.js --plugin email --json`.
- Mac read-only platform probe passed through `homeai-mac`:
  - source path `/Users/hermes-host/HermesMobile/plugins/email` exists;
  - runtime/data root `/Users/hermes-host/HermesMobile/plugins/email/runtime`
    exists;
  - launchd `com.hermesmobile.plugin.email` is loaded;
  - manifest `http://127.0.0.1:5175/api/v1/hermes/plugin/manifest` returned
    HTTP 200.
- No Email code, service, production data, Gateway worker, mailbox data, OAuth
  token, cookie, or credential material was changed by this checker closure.

## 2026-06-07 Message Detail Cache Notice Removal

- Removed the `Local mailbox cache` notice block from the message detail pane.
- Removed the now-unused `ShieldAlert` icon import.
- This is a UI-only display change; local read/unread/delete behavior and MCP
  local delete semantics were not changed.
- Verification:
  - `npm exec vitest run tests/ui-account-switcher.test.tsx` passed: 1 test file / 5 tests;
  - `npm run build` passed.

## 2026-06-07 Mac Production MCP Deployment

- Email plugin source was deployed to Mac production path
  `/Users/hermes-host/HermesMobile/plugins/email` with `runtime` preserved.
- Production backup was written under
  `/Users/hermes-host/HermesMobile/backups/plugins/email/`.
- Restarted `system/com.hermesmobile.plugin.email`.
- Production validation:
  - manifest HTTP 200;
  - `/api/app-version` HTTP 200;
  - manifest MCP command is `npm --silent run mcp:stdio`;
  - direct production MCP `tools/list` includes `email.apply_mail_action`;
  - direct no-token MCP call returns bounded error `email_mcp_session_denied`;
  - production UI asset no longer contains `Local mailbox cache`.
- Home AI main app Gateway closure was also updated and deployed:
  - `adapters/gateway-run-instruction-service.js` now includes Email callable
    hints including `mcp_email_apply_mail_action`;
  - `mobile-server-runtime.js` schema epoch is
    `20260607-email-local-delete-mcp-v1`;
  - selected Mac Gateway worker `hm-owner-openai-1` schema smoke passed with
    `mcp_email_apply_mail_action`;
  - `system/com.hermesmobile.listener` was restarted.

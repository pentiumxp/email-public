# Hermes Plugin Host Contract

This document records the Email plugin's expected cooperation contract with Hermes Mobile. It is derived from the current Hermes Mobile embedded-app plugin pattern. The Email plugin must own its own UI, API, database, OAuth, sync, and MCP wrapper. Hermes Mobile owns the host shell, manifest normalization, launch exchange, same-origin proxy, workspace authorization, and outer navigation.

## Required Manifest

The Email plugin should expose:

```text
GET /api/v1/hermes/plugin/manifest
```

The manifest must expose only non-secret metadata:

- `id`, recommended `email`;
- `title`, recommended `邮箱`;
- `kind` or `type`, value `embedded_app` / `embedded-app`;
- `entry.url` for embedded UI;
- `program_api.base_url`;
- `program_api.plugin_launch`, usually `/api/v1/hermes/plugin/launch`;
- required MCP/toolset metadata;
- optional navigation/refresh event metadata.

The manifest must not expose raw access keys, bearer tokens, OAuth tokens, launch-token secrets, database paths, local secret paths, mailbox contents, attachment paths, push endpoints, cookies, or private inventories.

Recommended navigation metadata:

```json
{
  "navigation": {
    "state_event": "email.plugin.navigation",
    "back_event": "hermes.plugin.back",
    "back_result_event": "email.plugin.back_result",
    "refresh_required_event": "email.plugin.refresh_required",
    "preserve_iframe_state": true
  }
}
```

## Launch Contract

The plugin should expose:

```text
POST /api/v1/hermes/plugin/launch
```

Hermes Mobile calls this server-side with a workspace-bound plugin key or equivalent server-side credential. The browser must never receive a long-lived plugin key.

Launch response should return only a short-lived relative entry path, for example:

```json
{
  "entry_path": "/?embed=hermes&launch=<short-lived-token>"
}
```

The iframe must not fall back to username/password login after a valid Hermes launch.

Launch requests must carry a host-verified authorization context, for example:

```json
{
  "workspace_id": "workspace-id",
  "user_id": "hermes-user-id",
  "role": "owner|admin|member",
  "allowed_account_ids": ["mail-account-id"]
}
```

Rules:

- The browser must not be allowed to forge `user_id`, `role`, or `allowed_account_ids`.
- The Email plugin should store the launch context server-side behind a short-lived launch/session token.
- The iframe should only receive the short-lived launch token or relative entry path.
- All `/api/accounts`, `/api/folders`, `/api/messages`, and future MCP calls must filter by the server-side session's allowed account ids.
- Admin/owner launch may expose operational account status, but cross-user message-body access must require a separate delegated-access model.

Current Email-side implementation:

- `GET /api/v1/hermes/plugin/manifest` returns non-secret plugin metadata.
- `POST /api/v1/hermes/plugin/workspaces` verifies the Email owner key, creates or reuses an Email workspace record, writes workspace-local `.hermes-email/config.json` and `.hermes-email/access-key.txt`, and returns bounded metadata only.
- `POST /api/v1/hermes/plugin/launch` verifies the workspace key, creates a short-lived Email plugin session, and returns only launch metadata and a short-lived entry path.
- The iframe stores the launch token in an `HttpOnly` `email_session` cookie when loaded with `?launch=...`.
- Standalone local use falls back to an explicit `local-admin` bootstrap context.
- Owner key default path: `runtime/secrets/hermes/owner-key.txt`.
- Workspace raw access keys are written only under the requested workspace root in `.hermes-email/access-key.txt`.
- Launch supports `appearance.theme` and `appearance.fontSize` by appending `pluginTheme` and `pluginFontSize` to the short-lived entry path.
- The iframe accepts `pluginTheme` and `pluginFontSize`, applies them to root DOM attributes, emits `email.plugin.navigation`, and handles `hermes.plugin.back`.

Still pending before production:

- Email must add a user-facing account binding/reconnect flow for non-admin users.
- MCP calls must use the same session context.

## Same-Origin Proxy And HTTPS

For local development, the Email plugin may run on localhost or LAN HTTP. When Hermes Mobile is served over HTTPS or installed as a PWA, Hermes should expose the browser-facing iframe URL through a same-origin proxy:

```text
/api/hermes-plugins/email/proxy/...
```

The Email plugin should not assume that the browser will see the plugin's raw upstream origin. It should support relative URLs and proxy-safe resource paths.

Requirements:

- no plugin-owned page should open in a separate browser window;
- internal links should stay inside the iframe;
- static assets, images, attachments, and API calls used by the iframe should work under the proxy path;
- upload forms must work in an iframe and not depend on blocked browser features;
- if external HTTPS deployment is used later, `entry.url` and `program_api.base_url` should use that deployment-owned HTTPS base.

## Appearance Sync

Hermes Mobile sends sanitized appearance metadata during launch:

```json
{
  "appearance": {
    "theme": "dark|light",
    "fontSize": "small|default|large|xlarge|xxlarge"
  }
}
```

The plugin should also accept safe query parameters on the iframe entry URL:

```text
pluginTheme=<theme>
pluginFontSize=<fontSize>
```

Rules:

- Treat host appearance as session context, not a command to overwrite standalone plugin preferences.
- Apply theme and font before showing the first frame to avoid white flash or wrong font-size flash.
- Use `default` as the normal font size name; Hermes may map its own `standard` to `default`.
- Support at least light/dark and default/large.
- Do not store full Hermes settings dumps or private user data in appearance metadata.

## postMessage Navigation Contract

The Email plugin should emit navigation state messages to the parent:

```json
{
  "type": "email.plugin.navigation",
  "version": 1,
  "canGoBack": true,
  "route": {
    "name": "message",
    "messageId": "local-message-id"
  }
}
```

The plugin must validate parent/child origins according to the chosen deployment mode. In local same-origin proxy mode, use Hermes-provided embed context and do not trust arbitrary windows.

Use bounded route metadata only. Do not post full message bodies, OAuth tokens, mailbox passwords, attachment content, cookies, or raw local paths through `postMessage`.

## Back Handling

Hermes Mobile sends:

```json
{
  "type": "hermes.plugin.back",
  "version": 1
}
```

The plugin should handle iframe-internal back first:

- close modal/lightbox/drawer/search overlay;
- exit compose/edit selection state;
- return from message detail to message list;
- return from folder detail to account/folder overview.

Then it should emit:

```json
{
  "type": "email.plugin.back_result",
  "version": 1,
  "handled": true,
  "canGoBack": false,
  "route": {
    "name": "inbox"
  }
}
```

If the plugin cannot handle back because it is already at root, emit `handled=false`. Hermes Mobile then owns the outer return to the previous Hermes screen.

## Host Refresh Contract

The plugin may notify Hermes Mobile that its iframe session is stale:

```json
{
  "type": "email.plugin.refresh_required",
  "version": 1,
  "reason": "session_expired",
  "route": {
    "name": "message",
    "messageId": "local-message-id"
  }
}
```

Expected reasons:

- `session_expired`;
- `server_version_changed`;
- `auth_state_changed`;
- `account_reconnected`;
- `unrecoverable_401`;
- `manifest_changed`.

Rules:

- Do not include launch tokens, cookies, access tokens, mailbox passwords, message bodies, or long error logs in refresh messages.
- Hermes Mobile should fetch a fresh manifest/launch entry and swap the iframe once.
- The plugin should not force reload itself on every `visibilitychange`, `focus`, or tab switch.
- Switching away from the plugin and back should preserve iframe state when the existing session is still valid.

## Notification Boundary

Email plugin backend notifications should go through Hermes Mobile's plugin notification path later, not directly through browser push from inside the iframe.

Notification payloads should be bounded:

- account id;
- provider;
- local message id;
- subject snippet;
- sender display/bounded address;
- timestamp;
- importance/category;
- route hint.

Do not send full bodies, attachments, OAuth tokens, push endpoints, cookies, or raw provider payloads.

## UI Requirements Inside Hermes

Hermes Design Read for this plugin:

`Reading this as: mailbox operations and email evidence review for Owner/current workspace, with a calm Hermes control-panel language, optimizing for sync status, message triage, and safe actions.`

UI posture:

- density: standard;
- motion: micro-feedback only;
- statusCriticality: medium to high.

Rules:

- mobile-first;
- no decorative dashboard/marketing layout;
- stable account/folder/message list dimensions;
- visible sync/auth/error state;
- clear destructive action confirmation;
- mixed Chinese/English subject and sender text must not overflow controls;
- no raw local paths or secret values in UI;
- host theme/font should be inherited on launch.

## Plugin-Side Harness

Before Hermes Mobile treats Email as production-ready, the Email project should test:

- manifest shape and non-secret fields;
- launch returns short-lived relative entry path;
- launch request handles `appearance`;
- iframe entry honors `pluginTheme` and `pluginFontSize`;
- navigation `postMessage`;
- `hermes.plugin.back` handling and `email.plugin.back_result`;
- `email.plugin.refresh_required` without token/body leakage;
- same-window internal navigation;
- same-origin proxy resource loading;
- no browser new-window handoff;
- mobile PWA layout smoke when available.

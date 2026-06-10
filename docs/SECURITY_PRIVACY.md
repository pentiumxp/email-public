# Security And Privacy

## Data Sensitivity

Email is high-sensitivity personal and business data. Treat mailbox content, sender/recipient lists, attachments, OAuth tokens, and provider headers as private.

## Secret Storage

Allowed secret locations should be local runtime paths excluded from Git, for example:

- `secrets/`
- `runtime/secrets/`
- provider token folders under a configured data dir.

Do not commit:

- OAuth access tokens;
- OAuth refresh tokens;
- app passwords;
- mailbox passwords;
- client secret JSON;
- `.env` files;
- provider session cookies.

## Local Data Storage

Use local runtime folders excluded from Git:

- `data/`
- `runtime/`
- `logs/`
- `tmp/`

Do not store full raw email bodies in docs, handoff, tests, or model prompts. Runtime database may store body content only if the user explicitly wants local mail cache behavior and the database path is excluded from Git.

## Logging

Logs may include:

- provider;
- account id;
- folder id/name;
- counts;
- status;
- bounded error code;
- timestamps.

Logs must not include:

- tokens;
- passwords;
- full message body;
- full attachment content;
- raw private reports;
- long provider response dumps.

## Provider Proxy Privacy

Provider proxy configuration is operational metadata, not mailbox content, but it can still contain credentials.

Allowed in docs/logs:

- proxy environment variable names;
- proxy host/port when no credential is embedded;
- redacted proxy labels such as `http://***:***@proxy.local:7890/`;
- bounded error codes such as `UNSUPPORTED_PROXY_PROTOCOL`.

Not allowed:

- proxy username/password;
- full proxy URLs containing credentials;
- provider request headers;
- OAuth tokens or refresh tokens observed while debugging provider connectivity.

Provider proxy setup must remain server-side. It must not be sent to the browser, iframe postMessage payloads, MCP responses, or Hermes Mobile plugin manifest/launch responses.

## MCP Privacy

MCP outputs should default to summaries and metadata. Full body access, attachment extraction, and send/reply operations require separate capability and audit design.

Current MCP detail output returns bounded sanitized excerpts plus attachment metadata only. It does not return raw MIME, attachment content, provider tokens, provider passwords, local file paths, or the full local body field.

The V1 MCP local delete actions only write local tombstones and audit rows. They must not call remote mailbox providers or imply that provider-side mail was deleted.

Bulk MCP local delete tools must default to `dry_run=true`. They may return counts, bounded message metadata samples, skip reasons, and sender breakdowns, but must not return full message bodies, raw MIME, attachments, local paths, provider tokens, provider passwords, or provider logs. Search-based bulk deletion must support `exclude_keywords` so callers can skip receipts, invoices, orders, verification/security messages, school messages, and business-report mail before any tombstone is written.

## Hermes Mobile Privacy Boundary

Hermes Mobile should receive:

- plugin status;
- bounded message summaries;
- notification metadata;
- MCP tool outputs requested for analysis.

Hermes Mobile should not receive:

- provider tokens;
- mailbox sync cursors unless necessary and bounded;
- full raw mail store;
- attachment cache;
- raw local paths.

## Multi-User Access Control

The Email plugin must treat mailbox accounts as user-owned resources. The owner/admin account is not the same as an ordinary mailbox user.

Before multi-user production use:

- every mailbox account must be bound to a plugin user id;
- every Hermes launch must create a short-lived server-side session with user id, workspace id, role, and allowed account ids;
- HTTP and MCP tools must require that session context and reject account ids outside the allowed set;
- read tools may return only bounded metadata unless the current user owns or is explicitly delegated access to the message;
- admin views may show provider/account health, sync status, counts, and bounded errors, but not other users' full message bodies or attachment contents by default;
- all account binding, reconnect, disable, delegation, and write-action changes must be auditable.

Current implementation status:

- The local standalone UI uses an explicit `local-admin` bootstrap context that can see current local accounts.
- Hermes launch sessions are stored in `plugin_sessions` and carry server-side allowed account ids.
- `/api/accounts`, `/api/folders`, `/api/messages`, message detail, and local read/delete actions now enforce the server-side allowed account set.
- Workspace registration requires the local Email owner key. The owner key default location is `runtime/secrets/hermes/owner-key.txt`.
- Workspace launch requires the workspace-local key written to `.hermes-email/access-key.txt` under the registered workspace root.
- Workspace registration and launch responses do not return raw owner/workspace keys.
- MCP read tools now use the same launch-session authorization service. Hermes Mobile should pass the short-lived session through host-controlled MCP process environment or per-call context, never through browser-visible long-lived keys. Missing or invalid MCP session context must fail closed.

Forbidden shortcuts:

- do not trust account id, email address, or role passed directly from browser JavaScript;
- do not let Hermes Mobile client-side state decide which mailbox accounts are visible;
- do not expose all local accounts to every launched iframe;
- do not share one provider token across unrelated plugin users unless a future delegated/shared-mailbox feature explicitly models and audits that relationship.

## Write Safety

Remote mailbox mutations must follow this order:

1. validate local permission/capability;
2. write pending local action audit;
3. call remote provider;
4. on provider success, update local message state;
5. on provider failure, keep local state recoverable and show bounded error.

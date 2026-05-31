# Provider Configuration Rules

This document records known provider-specific setup facts and migration rules for the Email plugin. It is intentionally metadata-only. Do not place passwords, OAuth tokens, app passwords, `.env` contents, mailbox bodies, attachments, or long provider logs here.

## Qifan Work Mail / AliMail

Known legacy context:

- Qifan mail was previously handled through Hermes automation jobs that generated incremental and daily reports.
- The account class is Aliyun / AliMail enterprise mail.
- Historical provider endpoints used by Hermes Mobile automation:
  - IMAP host: `imap.qiye.aliyun.com`
  - IMAP SSL port: `993`
  - SMTP host: `smtp.qiye.aliyun.com`
  - SMTP SSL port: `465`
- Existing Hermes Mobile integration detection used these environment variable names:
  - `EMAIL_IMAP_HOST`
  - `EMAIL_SMTP_HOST`
  - `EMAIL_HOME_ADDRESS`
  - `EMAIL_HOME_CHANNEL`
  - `EMAIL_PASSWORD`
  - `EMAIL_SMTP_SSL`
- Historical work mail identity included the Qifan domain `7fgame.com`. Treat concrete mailbox addresses as account configuration, not public docs content.

Important historical finding:

- A previous credential/security-code refresh attempt still returned IMAP `LOGIN failed` and SMTP authentication failure for the configured Qifan work mailbox.
- Alternate AliMail hostnames and full/short username variants were tried historically and also failed.
- Therefore, a new Email plugin implementation must not assume the old Hermes env password/security code is valid.
- The first Qifan connector milestone should be an explicit account-auth diagnostic: host, port, TLS mode, username form, provider auth result, and bounded error code.

Implementation rules:

- Model Qifan as a generic IMAP/SMTP provider profile named `alimail` or `qifan-alimail`.
- Keep credentials in the Email plugin's own excluded secret store, not Hermes Mobile env files.
- Do not copy existing Hermes `.env`, token, password, app-password, or backup files into this workspace.
- Do not enable send/reply in V1. Start with read-only sync.
- If SMTP is added later, require explicit user approval and an action audit.
- Use synthetic fixtures in tests. Do not use real Qifan message bodies or attachments.

Suggested initial account config fields:

```json
{
  "provider": "alimail",
  "accountLabel": "Qifan work mail",
  "imap": {
    "host": "imap.qiye.aliyun.com",
    "port": 993,
    "tls": true
  },
  "smtp": {
    "host": "smtp.qiye.aliyun.com",
    "port": 465,
    "tls": true,
    "enabled": false
  }
}
```

The real username and credential must be supplied through local setup UI or excluded secret files.

## Gmail / Google Workspace

Known legacy Hermes Mobile rules:

- Google OAuth app is production.
- Legacy Hermes token path:
  - `/home/xuxin/.hermes/google_token.json`
- Legacy Hermes client secret path:
  - `/home/xuxin/.hermes/google_client_secret.json`
- Authorized legacy scopes included Gmail read/send/modify, Calendar, Drive readonly, Contacts readonly, Sheets, Docs readonly, and YouTube readonly.
- Access tokens expire in about one hour; a valid refresh token should avoid short testing-mode expiry unless revoked by Google or account policy.
- Hermes Mobile exposed Google/Gmail as connector profiles `google` and `gmail`, with toolset `google_workspace`.

Email plugin rules:

- The Email plugin should manage its own OAuth client configuration and token store.
- Do not copy the legacy Hermes token/client-secret files into this workspace.
- Reusing the same Microsoft/Google OAuth app registration is acceptable when the app is production-ready and supports the needed redirect/device-code flow. Reuse the app `client_id`, not the old token files.
- If reusing the same Google OAuth app is desired, record only the configured client-secret path, never the JSON content.
- V1 Gmail should request the narrowest practical Gmail scopes for local mailbox sync.
- Current Gmail scaffold uses Google OAuth device flow and only needs `clientId` when the OAuth client is created as a TV / limited-input device client.
- Configure that client id in excluded local config `runtime/config/gmail.json` or shell env `EMAIL_GOOGLE_CLIENT_ID`.
- The Gmail token store is excluded local state at `runtime/secrets/gmail/token.json`.
- Desktop OAuth clients may require a client secret during the authorization-code token exchange. If needed, store it only in excluded local state at `runtime/secrets/gmail/client-secret.json` or current shell env `EMAIL_GOOGLE_CLIENT_SECRET`.
- Prefer read-only or modify-only scope split by capability:
  - read/list/search/get: read-only scope where possible;
  - mark read/archive/delete: modify scope, gated;
  - send/reply: out of V1 unless explicitly approved.
- Store Gmail account status and token refresh errors as bounded metadata.
- Do not write full Gmail message bodies into docs, handoffs, logs, or tests.

Suggested connector profile mapping:

```json
{
  "provider": "gmail",
  "connectorProfiles": ["google", "gmail"],
  "defaultMode": "read-only",
  "writeCapabilities": {
    "markRead": "gated",
    "archive": "gated",
    "delete": "gated",
    "send": "disabled-v1"
  }
}
```

## Same-Account Boundary

Hermes Mobile's current rule is useful for this plugin:

- same-account mail connectors may be available inside that account's ordinary low-permission boundary;
- cross-account mailbox data must not be exposed by default;
- developer/tooling capabilities such as shell/code/product maintenance are separate from mail connector access.

Apply the same principle here:

- each account gets its own provider credentials and local account id;
- MCP queries must require explicit `accountId` or use the caller's authorized account set;
- Hermes Mobile should receive only the accounts and messages that the current workspace is allowed to access.

# Email Plugin Project Context

This workspace is for the independent Hermes Email / Mailbox plugin project.

Workspace path: `C:\Users\xuxin\Documents\email`

## Purpose

Build a local email application and service that can connect to user-approved mailboxes, sync new mail into a local store, expose a human UI, and provide a bounded MCP interface for Hermes Mobile analysis workflows.

The project should stay independent from Hermes Mobile. Hermes Mobile should embed or call this project as a plugin, not absorb its mailbox authentication, sync, storage, or mail-management business logic.

## Startup Rule

Before substantial work, read:

1. `.agent-context/PROJECT_CONTEXT.md`
2. `.agent-context/HANDOFF.md`
3. `docs/REQUIREMENTS.md`
4. `docs/ARCHITECTURE.md`
5. the smallest relevant implementation or contract document under `docs/`

## Architecture Rules

- Use service-first architecture.
- Keep business behavior out of large entrypoint files.
- Put mailbox connection logic in connector modules.
- Put durable sync, deduplication, conflict handling, and local persistence in services.
- Put HTTP routes or MCP tools behind thin boundary modules that delegate to services.
- Treat Hermes Mobile integration as an adapter boundary.

Recommended structure:

- `connectors/<provider>/`
- `service/`
- `store/`
- `mcp/`
- `web/`
- `tests/`
- `docs/`

## Reused Assets From Hermes Mobile

The initial Outlook / Hotmail Graph MCP connector seed was copied from:

- `C:\Users\xuxin\Documents\Agent\scripts\python\outlook_graph_mcp.py`

Destination:

- `connectors/outlook-graph/outlook_graph_mcp.py`

This copied file is code only. Do not copy token files, `.env`, OAuth client secrets, mailbox contents, runtime state, logs, or cached attachments from Hermes Mobile.

## Documentation Discipline

When behavior changes materially, update the matching document:

- requirements: `docs/REQUIREMENTS.md`
- architecture and boundaries: `docs/ARCHITECTURE.md`
- implementation steps: `docs/IMPLEMENTATION_PLAN.md`
- MCP tools: `docs/MCP_CONTRACT.md`
- security/privacy: `docs/SECURITY_PRIVACY.md`
- provider-specific configuration: `docs/PROVIDER_CONFIG_RULES.md`
- Hermes plugin host contract: `docs/HERMES_PLUGIN_HOST_CONTRACT.md`
- tests and harness rules: `docs/HARNESS_AND_DOCS_RULES.md`

Update `.agent-context/HANDOFF.md` before ending substantial work.

## Harness Rules

New behavior is not done until it has focused coverage:

- connector contract tests for provider clients;
- local store migration and idempotency tests;
- sync workflow harness for polling, cursor, duplicate, deletion, move, and retry behavior;
- MCP contract tests for tool schemas and privacy-bounded outputs;
- UI tests for mailbox list, message list, details, account status, error states, and mobile layout;
- architecture boundary tests that prevent entrypoint/service collapse.

## Git And GitHub Rules

- Default rule: local commits only.
- Do not push to GitHub unless the user explicitly asks.
- Do not commit raw secrets, OAuth tokens, app passwords, message bodies, attachment contents, local runtime state, or large logs.
- Use detailed Chinese commit messages when committing in this user workspace.
- Public or shared release must come from a privacy-scanned clean export, not from runtime folders.

## Privacy Rules

Never write the following to docs, handoff, logs, tests, or prompt fixtures:

- OAuth access/refresh tokens;
- app passwords;
- mailbox passwords;
- full raw email bodies;
- full attachments;
- private reports;
- raw model prompts/responses containing email content;
- push endpoints;
- session cookies.

Use bounded metadata: account id, provider, folder id/name, message id/hash, subject snippet, sender domain or bounded address when needed, timestamps, sizes, sync status, error code, and counts.

## Provider Rules

- Qifan work mail is treated as an AliMail-compatible IMAP/SMTP profile. See `docs/PROVIDER_CONFIG_RULES.md`.
- Gmail is treated as a Google OAuth / Gmail API profile. See `docs/PROVIDER_CONFIG_RULES.md`.
- Do not copy legacy Hermes token, client-secret, `.env`, mailbox password, security code, mail body, attachment, or runtime state into this workspace.

## Hermes Plugin Host Rules

- Follow `docs/HERMES_PLUGIN_HOST_CONTRACT.md` before implementing Hermes Mobile embedding.
- Required cooperation points include manifest, launch, same-origin proxy safety, `postMessage` navigation/back, `email.plugin.refresh_required`, and theme/font inheritance.
- Plugin host messages must carry bounded route/status metadata only, never tokens, cookies, full message bodies, attachments, or raw local paths.

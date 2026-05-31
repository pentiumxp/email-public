# Docs Index

Read this index after `.agent-context/PROJECT_CONTEXT.md` and `.agent-context/HANDOFF.md`.

## Product And Scope

- `docs/REQUIREMENTS.md`
  - Product goal, user problems, V1 scope, provider priority, functional requirements, and non-goals.

## Architecture

- `docs/ARCHITECTURE.md`
  - Service-first architecture, connector/store/MCP/UI boundaries, Hermes Mobile integration boundary, and runtime stack decision.

- `docs/HERMES_PLUGIN_HOST_CONTRACT.md`
  - Hermes Mobile embedded-plugin cooperation contract: manifest, launch, same-origin proxy, postMessage navigation/back, refresh-required events, theme/font inheritance, notification boundary, UI posture, and plugin-side harness.

## Implementation

- `docs/IMPLEMENTATION_PLAN.md`
  - Phased delivery plan from local store to provider connectors, sync service, MCP, UI, Hermes integration, Gmail, and IMAP.

## MCP

- `docs/MCP_CONTRACT.md`
  - MCP tool list, privacy-bounded response contract, read/write tool split, and future write-action rules.

## Security And Privacy

- `docs/SECURITY_PRIVACY.md`
  - Secret storage, local data storage, logging rules, MCP privacy, Hermes boundary, and write safety.

## Provider Configuration

- `docs/PROVIDER_CONFIG_RULES.md`
  - Qifan/AliMail and Gmail/Google Workspace setup facts, migration rules, provider-specific constraints, and same-account boundary rules.

## Harness And Documentation Rules

- `docs/HARNESS_AND_DOCS_RULES.md`
  - H1/H2/H3 classification, test expectations, architecture guardrails, documentation update rule, and Git/GitHub constraints.

## Workspace Context

- `.agent-context/PROJECT_CONTEXT.md`
  - Durable workspace facts and startup rules.
- `.agent-context/HANDOFF.md`
  - Current status, next steps, and operational constraints.

# Workspace Agent Instructions

回答保持中性、客观、科学、证据导向，不迎合，不提供情绪价值，不夸张，不主观拔高。

## Required Startup Behavior

Before substantial work in this workspace, read:

1. `.agent-context/PROJECT_CONTEXT.md`
2. `.agent-context/HANDOFF.md`
3. `docs/DOCS_INDEX.md`
4. the smallest relevant document listed in the index

Do not rely on thread-local assumptions from Hermes Mobile or older Codex sessions.

## Project Boundary

This workspace is an independent Email / Mailbox plugin project.

- Do not move mailbox authentication, sync, storage, or provider connector logic into Hermes Mobile.
- Hermes Mobile integration should happen through plugin launch/iframe contracts and MCP tools.
- Do not copy runtime secrets, OAuth tokens, mailbox data, attachment cache, logs, or `.env` files from Hermes Mobile.

## Service-First Architecture

New product behavior must be implemented through services/providers first.

- Provider-specific remote calls belong in `connectors/<provider>/`.
- Sync, deduplication, conflict handling, local actions, and privacy projection belong in `service/`.
- Database access belongs in `store/`.
- MCP/HTTP/UI entrypoints should remain glue.
- Add focused tests for service behavior before route or UI-only validation.

## Documentation Discipline

When behavior changes materially, update the relevant docs under `docs/` and update `.agent-context/HANDOFF.md` before ending substantial work.

## Harness Discipline

Use `docs/HARNESS_AND_DOCS_RULES.md` to classify work:

- H1 workflow changes need workflow/service harness coverage.
- H2 projection or contract changes need contract tests.
- H3 small UI/doc-only changes may use focused checks.

## Git And GitHub

- Default to local commits only.
- Do not push to GitHub unless the user explicitly asks.
- Use detailed Chinese commit messages when committing.
- Do not commit secrets, tokens, `.env`, local mail store, attachments, runtime folders, logs, or full mailbox fixtures.

## Privacy

Do not print or store raw OAuth tokens, mailbox passwords, app passwords, full email bodies, full attachments, private reports, push endpoints, session cookies, raw model prompts/responses containing email content, or long provider logs.

Use bounded metadata in docs, tests, handoff, and logs.


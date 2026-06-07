# Harness And Documentation Rules

## Rule

Every behavior-changing implementation must update both tests and docs. The plugin handles sensitive data and external provider state, so unchecked manual testing is not enough.

## Harness Classification

### H1: Workflow Harness Required

These changes require workflow/service harness coverage before completion:

- account authentication lifecycle;
- OAuth token refresh;
- incremental sync;
- sync cursor migration;
- duplicate message handling;
- deletion/archive/move reconciliation;
- local store migrations;
- MCP write tools;
- Hermes Mobile Inbox/Web Push notification projection;
- attachment caching/extraction;
- send/reply behavior.

### H2: Contract Coverage Required

These changes require contract/projection tests:

- MCP read tool schemas;
- provider message normalization;
- plugin manifest/launch payloads;
- embedded plugin `postMessage` navigation/back contract;
- embedded plugin refresh-required events;
- host theme/font inheritance;
- account/folder/message projection into UI;
- privacy-bounded output projection;
- provider error normalization.
- provider outbound HTTP proxy/runtime wiring.

### H3: Focused Tests Usually Enough

These changes may use focused unit/UI checks:

- small copy changes;
- non-contract CSS tweaks;
- documentation-only clarifications;
- local developer script help text.

## Required Test Types

- connector tests;
- store/migration tests;
- service workflow tests;
- MCP contract tests;
- UI render tests;
- architecture boundary tests;
- privacy scan or equivalent secret-pattern check.

## Focused Harness Commands

Mobile UI behavior that depends on real viewport scrolling should be verified on
the connected ADB e-ink phone through the installed Email home-screen icon when
available. Use the LAN service URL, install it with the browser's add-to-home
screen flow, then validate the standalone page rather than a normal browser tab.

ADB mobile pagination smoke:

```powershell
adb devices -l
adb -s <device-id> shell wm size
adb -s <device-id> shell am start -a android.intent.action.VIEW -d "http://<lan-ip>:5175/?adbSmoke=1" org.chromium.chrome
adb -s <device-id> forward tcp:9222 localabstract:chrome_devtools_remote
```

Expected evidence:

- first message request uses `limit=50&offset=0`;
- physical scrolling near the bottom of the message list requests
  `limit=50&offset=50`, or the visible `Load 50 more messages` fallback button
  does so when device scroll events are unreliable;
- the rendered message row count grows from 50 to 100 without a blank list state;
- no OAuth token, app password, mailbox password, full body, attachment content,
  or long provider log is captured in screenshots, docs, or handoff.

Provider outbound proxy changes must run:

```powershell
npm run harness:provider-proxy
```

This command covers:

- proxy environment precedence and redacted status output;
- unsupported proxy protocol rejection;
- Gmail and Outlook provider clients wiring through `connectors/http/provider-fetch-proxy.ts`;
- boundary checks that UI, MCP, HTTP routes, and Hermes plugin glue do not import provider proxy runtime directly.

MCP read-contract changes must run:

```powershell
npm exec vitest run tests/email-mcp-service.test.ts tests/architecture-boundary.test.ts
```

This command covers:

- Hermes-facing dotted MCP tool names;
- launch-session account filtering;
- missing MCP session context fails closed;
- bounded message detail output without raw full body fields;
- attachment metadata only;
- local-only delete tombstone writes an audit row, removes the message from normal reads, and reports `remoteApplied=false`;
- stdio JSON-RPC initialize, tools/list, and tools/call smoke;
- boundary checks that the stdio entrypoint stays protocol glue.

When running an actual MCP stdio smoke, use `npm --silent run mcp:stdio` so stdout contains only JSON-RPC responses.

Full completion still requires:

```powershell
npm run check
```

NAS production deployment should use the reusable script instead of ad hoc SSH
steps:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\powershell\deploy-email-nas.ps1
```

The script deploys committed `HEAD` only, uploads through SSH with a base64
archive stream because NAS `scp` is not available, preserves
`/volume1/docker/email-plugin/runtime`, backs up the previous source tree, runs
NAS-side validation inside `node:22-bookworm-slim` with
`npm ci --include=dev` and `npm run check`, rebuilds the Docker image, replaces
the `email-plugin` container, and performs bounded runtime smoke checks. Do not
use the NAS host Node/npm for validation; it may be older than the project
runtime requirements.

## Architecture Boundary Guard

Add tests that assert:

- entrypoints stay small;
- services own business logic;
- MCP tools delegate to services;
- HTTP routes delegate to services;
- connector code does not import UI or Hermes Mobile host code;
- Hermes integration does not import provider secret/token modules.
- plugin host bridge code does not import mailbox provider credentials or local mail store internals directly.
- provider outbound proxy setup stays in provider connector/runtime modules, not UI, MCP, HTTP routes, or Hermes plugin glue.

## Documentation Update Rule

Update:

- `docs/REQUIREMENTS.md` when product scope changes;
- `docs/ARCHITECTURE.md` when module boundaries change;
- `docs/IMPLEMENTATION_PLAN.md` when phase status changes;
- `docs/MCP_CONTRACT.md` when tools or response schemas change;
- `docs/SECURITY_PRIVACY.md` when secret/data handling changes;
- `.agent-context/HANDOFF.md` before ending substantial work.

## Git And GitHub

- Default to local commits only.
- Do not push without explicit user request.
- Do not commit runtime data.
- Do not commit secrets.
- Do not commit full mailbox fixtures.
- Use synthetic fixtures for tests.
- Use detailed Chinese commit messages in this workspace.

# Home AI Platform Contract Pointer

Last updated: 2026-06-07.
Home AI platform contract version: `20260606-v1`.

## Scope

Email is a standard inserted Home AI plugin. It owns mailbox credentials,
sync, local mail storage, mailbox UI, and bounded MCP mail tools. This file
records only Email-local facts and points back to the canonical Home AI
platform contract.

## Canonical Home AI Docs

Read these Home AI docs before changing deployment, MCP tools, mobile visual
behavior, or cross-plugin reference behavior:

- `C:\Users\xuxin\Documents\Agent\docs\PLATFORM_CONTRACTS\plugin-workspace-platform-contract.md`
- `C:\Users\xuxin\Documents\Agent\docs\PLATFORM_CONTRACTS\plugin-mobile-ui-visual-contract.md`
- `C:\Users\xuxin\Documents\Agent\docs\RUNBOOKS\macos-production-access.md`
- `C:\Users\xuxin\Documents\Agent\docs\RUNBOOKS\mcp-tool-upgrade-closure.md`
- `C:\Users\xuxin\Documents\Agent\docs\RUNBOOKS\macos-ios-simulator-appium.md`
- `C:\Users\xuxin\Documents\Agent\docs\IMPLEMENTATION_NOTES\reference-memory-graph-v1.md`
- `C:\Users\xuxin\Documents\Agent\docs\IMPLEMENTATION_NOTES\reference-memory-graph-harness-plan.md`

## Plugin-Local Facts

| Field | Value |
| --- | --- |
| `plugin_id` | `email` |
| `workspace_path_windows` | `C:\Users\xuxin\Documents\email` |
| `current_branch_snapshot` | `main` at `75a1ea0` when this pointer was added |
| `production_source_path_macos` | `/Users/hermes-host/HermesMobile/plugins/email` |
| `production_data_root_macos` | `/Users/hermes-host/HermesMobile/plugins/email/runtime` |
| `windows_dev_base_url` | `http://127.0.0.1:5175` |
| `macos_production_base_url` | `http://127.0.0.1:5175` |
| `launchd_label` | `system/com.hermesmobile.plugin.email` |
| `manifest_url` | `http://127.0.0.1:5175/api/v1/hermes/plugin/manifest` |
| `mcp_command` | `npm --silent run mcp:stdio` |
| `mcp_schema_endpoint` | MCP `tools/list` through the stdio wrapper and plugin manifest through HTTP |
| `dev_runtime_prerequisites` | Mac DEV must expose Node and npm through `/Users/xuxin/Developer/HomeAIDev/bin`; run `node --version` and `npm --version` before classifying MCP/service test failures. |
| `deploy_command` | Use the Home AI Mac access runbook; sync source to `/Users/hermes-host/HermesMobile/plugins/email`, preserve `runtime`, run local checks, restart `system/com.hermesmobile.plugin.email`, then run platform checker, direct MCP fail-close/tools smokes, and Home AI Gateway schema closure for changed MCP callables. |
| `credential_locations` | Provider OAuth/client/token config paths only by reference. Do not record raw OAuth tokens, client secrets, cookies, or mailbox contents here. |
| `reference_contract_status` | `planned`; Email should later expose Reference Contract methods for mail messages, threads, attachments, and mailbox accounts with permission-trimmed summaries. |
| `mobile_visual_harness_status` | Local UI and service tests exist; Home AI Appium/iOS Simulator evidence is required for embedded mobile UI, account switching, safe-area, or PWA differences. |
| `ios_live_debug_available` | `yes`; use Home AI `npm run ios:pwa:debug` for interactive embedded iOS PWA reproduction, with one Simulator/live-debug-port/WDA-port/MJPEG-port lane per concurrent plugin debug session. |
| `ios_visual_harness_command` | `cd /Users/hermes-dev/HermesMobileDev/app && npm run ios:pwa:visual -- --scenario embedded-plugin-shell --plugin-id email --debug-url http://127.0.0.1:19073/` |

## Required Local Validation

Run the smallest focused set for the changed surface:

```powershell
npm run check
npm test
```

For MCP changes:

```powershell
npm exec vitest run tests/email-mcp-service.test.ts tests/architecture-boundary.test.ts
```

For provider proxy changes:

```powershell
npm run harness:provider-proxy
```

From the Home AI main workspace, run the cross-workspace platform contract
checker after changing this pointer or any Email deployment/MCP/mobile
contract:

```powershell
node scripts\plugin-workspace-platform-contract-check.js --plugin email --json
```

## Required Production Validation

Use the Home AI Mac access runbook. Do not print passwords, keys, OAuth tokens,
cookies, mailbox message bodies, attachments, launch tokens, or long logs.

Minimum closure for Email production changes:

1. verify Mac launchd `system/com.hermesmobile.plugin.email` is running;
2. verify Mac loopback plugin manifest and bounded health/version endpoint if
   available;
3. verify direct MCP `tools/list` includes expected Email tools;
4. when MCP tools changed, run the Home AI MCP tool upgrade closure harness so
   the selected Gateway profile and selected worker expose the callable
   `mcp_email_*` tool names;
5. for mailbox sync or write-action changes, perform a bounded readback smoke
   with metadata-only output.

## Latest Production Evidence

2026-06-07 Mac production deployment:

- Email plugin source was synced to
  `/Users/hermes-host/HermesMobile/plugins/email` with `runtime` preserved.
- Email production backup was written under
  `/Users/hermes-host/HermesMobile/backups/plugins/email/`.
- `system/com.hermesmobile.plugin.email` was restarted.
- Production manifest returned HTTP 200 and reports
  `npm --silent run mcp:stdio`.
- Direct production MCP `tools/list` includes `email.apply_mail_action`.
- Direct production no-token MCP smoke fails closed with
  `email_mcp_session_denied`.
- Home AI Gateway schema was updated to epoch
  `20260607-email-local-delete-mcp-v1`; selected Mac worker
  `hm-owner-openai-1` exposes `mcp_email_apply_mail_action`.

## Open Gaps

- Implement the Reference Contract V1 methods for stable Email object refs.
- Add Email-specific Appium/iOS Simulator coverage for embedded UI and account
  switching.
- Document the exact Mac production deploy command once the production deploy
  script is stabilized.
